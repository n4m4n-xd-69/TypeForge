-- Admin room removal, and the conversation that has to follow it.
--
-- An operator who can see a live room needs to be able to close one, and the
-- part that is easy to skip is what the people inside it are told. A room that
-- simply vanishes is indistinguishable from a crash — which is the worst
-- reading, because it is the one where the player blames the product rather
-- than learning what happened.
--
-- So removal is three things, not one:
--
--   1. A terminal room state carrying WHO removed it and WHY, durable, so a
--      player who reconnects an hour later still gets the explanation.
--   2. A message the affected players can send back.
--   3. A reply the operator can send, which those players — and only those
--      players — can read.
--
-- That is deliberately not a chat system. There is exactly one thread per
-- (room, player), it exists only because a room was removed, and neither side
-- can start one any other way.

/* ══ 1. the removed state ════════════════════════════════════════════════ */

alter table public.battle_rooms
  add column if not exists removed_by     uuid references auth.users on delete set null,
  add column if not exists removed_reason text,
  add column if not exists removed_at     timestamptz;

-- `removed` is distinct from `aborted`. Aborted is the host closing their own
-- room, which needs no explanation; removed is moderation, which always does.
-- Keeping them apart is what lets the client show a different screen for each
-- without inspecting who happened to trigger it.
alter table public.battle_rooms drop constraint if exists battle_rooms_status_check;
alter table public.battle_rooms
  add constraint battle_rooms_status_check
  check (status in ('lobby','countdown','active','finished','aborted','expired','removed'));

/* ══ 2. appeals ══════════════════════════════════════════════════════════ */

create table if not exists public.battle_room_appeals (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.battle_rooms on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  message     text not null check (length(btrim(message)) between 1 and 1000),
  admin_reply text check (admin_reply is null or length(btrim(admin_reply)) between 1 and 2000),
  replied_by  uuid references auth.users on delete set null,
  replied_at  timestamptz,
  created_at  timestamptz not null default now(),

  -- One thread per person per room. A player with a further question adds to
  -- the same thread rather than opening a second one, which is what keeps this
  -- from becoming an inbox.
  unique (room_id, user_id)
);

create index if not exists battle_room_appeals_open_idx
  on public.battle_room_appeals (created_at desc) where admin_reply is null;

alter table public.battle_room_appeals enable row level security;

-- A player reads and writes exactly their own thread, and only for a room they
-- were actually in. Both halves matter: without the membership test, anyone
-- could appeal against any room id they could guess and thereby learn that it
-- exists.
drop policy if exists appeals_own_read on public.battle_room_appeals;
create policy appeals_own_read on public.battle_room_appeals
  for select using (user_id = auth.uid() or public.admin_can('content.moderate'));

drop policy if exists appeals_own_write on public.battle_room_appeals;
create policy appeals_own_write on public.battle_room_appeals
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.battle_players p
       where p.room_id = battle_room_appeals.room_id and p.user_id = auth.uid()
    )
  );

-- Deliberately no player UPDATE policy. The reply is written by an operator
-- through a definer function; letting a player update the row would let them
-- write their own `admin_reply`.
drop policy if exists appeals_own_update on public.battle_room_appeals;
create policy appeals_own_update on public.battle_room_appeals
  for update using (user_id = auth.uid() and admin_reply is null)
  with check (user_id = auth.uid() and admin_reply is null);

/* ══ 3. removing a room ══════════════════════════════════════════════════ */

create or replace function public.admin_remove_battle_room(
  p_room   uuid,
  p_reason text
) returns public.battle_rooms
language plpgsql security definer set search_path = '' as $$
declare
  r      public.battle_rooms;
  before jsonb;
begin
  perform public.admin_require('content.moderate');

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to remove a room' using errcode = '22023';
  end if;

  select * into r from public.battle_rooms where id = p_room for update;
  if not found then
    raise exception 'No such Battlefield' using errcode = 'BF001';
  end if;
  before := jsonb_build_object('status', r.status, 'pin', r.pin);

  -- Settle first, so a match that was genuinely finishing keeps its results
  -- and its ranks. Removing a room should end it, not erase what happened in
  -- it — the players still earned those numbers.
  if r.status in ('countdown','active') then
    perform public.battle_settle(p_room);
  end if;

  update public.battle_rooms
     set status         = 'removed',
         removed_by     = auth.uid(),
         removed_reason = btrim(p_reason),
         removed_at     = now(),
         updated_at     = now()
   where id = p_room
  returning * into r;

  -- Everyone still in the room is marked out. Without this the roster keeps
  -- reporting live players for a room nobody can enter, and `battle_create`'s
  -- "three open rooms" count never comes back down.
  update public.battle_players
     set left_at = coalesce(left_at, now())
   where room_id = p_room and left_at is null;

  perform public.admin_audit(
    'battle.room.remove',
    format('Removed Battlefield %s', r.pin),
    'battle_room', p_room::text,
    before, jsonb_build_object('status', 'removed'),
    btrim(p_reason)
  );

  return r;
end; $$;

revoke execute on function public.admin_remove_battle_room(uuid, text) from public, anon;
grant  execute on function public.admin_remove_battle_room(uuid, text) to authenticated;

/* ══ 4. the player's side ════════════════════════════════════════════════ */

-- Why this is a function and not a plain select on battle_rooms: the room's own
-- RLS is member-scoped through `in_battle`, and a removed room has no live
-- members left (§3 marks them all out), so the player who most needs to read
-- the reason is precisely the one who can no longer see the row. This returns
-- the explanation and nothing else — no passage, no roster, no ids.
create or replace function public.battle_removal_notice(p_room uuid)
returns jsonb
language sql security definer stable set search_path = '' as $$
  select jsonb_build_object(
    'pin',        r.pin,
    'reason',     r.removed_reason,
    'removed_at', r.removed_at,
    'appeal',     (select to_jsonb(a) from (
                     select id, message, admin_reply, replied_at, created_at
                       from public.battle_room_appeals
                      where room_id = p_room and user_id = auth.uid()) a)
  )
  from public.battle_rooms r
  where r.id = p_room
    and r.status = 'removed'
    -- Membership at any point, including after being marked out, which is the
    -- whole reason this reads battle_players directly rather than `in_battle`.
    and exists (
      select 1 from public.battle_players p
       where p.room_id = r.id and p.user_id = auth.uid()
    );
$$;

revoke execute on function public.battle_removal_notice(uuid) from public, anon;
grant  execute on function public.battle_removal_notice(uuid) to authenticated;

/* Ask about it. Upserts, so "send" twice is an edit, not a second thread. */
create or replace function public.battle_appeal_removal(
  p_room    uuid,
  p_message text
) returns public.battle_room_appeals
language plpgsql security definer set search_path = '' as $$
declare a public.battle_room_appeals;
begin
  if coalesce(btrim(p_message), '') = '' then
    raise exception 'a message is required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.battle_players p
     where p.room_id = p_room and p.user_id = auth.uid()
  ) then
    raise exception 'You are not in that Battlefield' using errcode = 'BF015';
  end if;

  insert into public.battle_room_appeals (room_id, user_id, message)
  values (p_room, auth.uid(), btrim(p_message))
  on conflict (room_id, user_id) do update
    -- An answered thread is not editable: letting a player rewrite the question
    -- after it was answered would leave a reply attached to text nobody wrote.
    set message = case
                    when public.battle_room_appeals.admin_reply is null
                    then excluded.message
                    else public.battle_room_appeals.message
                  end
  returning * into a;

  return a;
end; $$;

revoke execute on function public.battle_appeal_removal(uuid, text) from public, anon;
grant  execute on function public.battle_appeal_removal(uuid, text) to authenticated;

/* ══ 5. the operator's side ══════════════════════════════════════════════ */

create or replace function public.admin_list_appeals(p_open_only boolean default false)
returns table (
  id uuid, room_id uuid, pin text, user_id uuid, display_name text,
  message text, admin_reply text, replied_at timestamptz, created_at timestamptz,
  removed_reason text
)
language sql security definer stable set search_path = '' as $$
  select a.id, a.room_id, r.pin, a.user_id, p.display_name,
         a.message, a.admin_reply, a.replied_at, a.created_at, r.removed_reason
    from public.battle_room_appeals a
    join public.battle_rooms r on r.id = a.room_id
    left join public.profiles p on p.id = a.user_id
   where public.admin_can('content.moderate')
     and (not p_open_only or a.admin_reply is null)
   order by a.created_at desc;
$$;

revoke execute on function public.admin_list_appeals(boolean) from public, anon;
grant  execute on function public.admin_list_appeals(boolean) to authenticated;

create or replace function public.admin_reply_to_appeal(
  p_appeal uuid,
  p_reply  text
) returns public.battle_room_appeals
language plpgsql security definer set search_path = '' as $$
declare a public.battle_room_appeals;
begin
  perform public.admin_require('content.moderate');
  if coalesce(btrim(p_reply), '') = '' then
    raise exception 'a reply is required' using errcode = '22023';
  end if;

  update public.battle_room_appeals
     set admin_reply = btrim(p_reply), replied_by = auth.uid(), replied_at = now()
   where id = p_appeal
  returning * into a;

  if not found then
    raise exception 'no such appeal' using errcode = 'BF001';
  end if;

  perform public.admin_audit(
    'battle.appeal.reply', 'Replied to a room removal appeal',
    'battle_appeal', p_appeal::text, null, null, null
  );

  return a;
end; $$;

revoke execute on function public.admin_reply_to_appeal(uuid, text) from public, anon;
grant  execute on function public.admin_reply_to_appeal(uuid, text) to authenticated;

/* ══ 6. realtime ═════════════════════════════════════════════════════════ */
-- The removal has to reach a player who is mid-race, and the reply has to reach
-- one who is sitting on the removal screen. Both arrive as row changes.

do $$
declare t text;
begin
  foreach t in array array['battle_room_appeals'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not present — skipping';
end $$;
