-- Battlefield hardening: the freeze, capacity, and realtime as a migration.
--
-- ── 1. The freeze ─────────────────────────────────────────────────────────
--
-- `battle_maybe_settle` (0009) settles a room only when every player who has
-- not left holds a result row:
--
--     if outstanding = 0 then perform public.battle_settle(p_room); end if;
--
-- That is correct for every player who *tells us* they are done. It is wrong
-- for the one who closes the tab: no `battle_finish`, no `battle_leave`, so
-- `outstanding` never reaches zero and the room stays `active` forever. Every
-- player who did finish sits on "waiting for the others" with no way out. That
-- is the reported freeze, and it needs no unusual timing to reproduce — one
-- person closing a tab mid-race is enough.
--
-- The deadline is the answer, and it already exists: `battle_start` writes
-- `deadline_at` inside Postgres, so it is server-owned and not reachable from a
-- browser. Once it passes, the match is over by definition and a missing result
-- is a forfeit rather than something to keep waiting on. So settle when EITHER
-- everyone has reported OR the deadline has passed.
--
-- `battle_reap` had the mirror of the same bug: it flipped expired rooms to
-- `finished` without ranking them, so the escape hatch produced a results
-- screen with every rank null. It now routes through `battle_settle`, which
-- does both.
--
-- ── 2. Who calls it ───────────────────────────────────────────────────────
--
-- Nothing runs on a schedule (pg_cron is not enabled on this project), so a
-- room with nobody left to press a button would still hang. `battle_sweep` is
-- the member-callable version: any player in the room can ask the server to
-- re-evaluate it, and the server decides. The client polls this while it waits
-- on results. The authority stays in Postgres — the client can only ask.

/* ── settle when the deadline says the match is over ─────────────────────── */

create or replace function public.battle_maybe_settle(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  outstanding int;
  r           public.battle_rooms;
begin
  select * into r from public.battle_rooms where id = p_room;
  if not found then return; end if;
  if r.status not in ('countdown','active') then return; end if;

  select count(*) into outstanding
    from public.battle_players p
   where p.room_id = p_room
     and p.left_at is null
     and not exists (
       select 1 from public.battle_results res
        where res.room_id = p_room and res.user_id = p.user_id
     );

  -- Everyone reported, or the clock ran out. Either way the match is over.
  if outstanding = 0 or (r.deadline_at is not null and r.deadline_at <= now()) then
    -- A player who never reported forfeits with whatever the last durable
    -- checkpoint recorded, so the leaderboard shows them rather than dropping
    -- them silently. `battle_players` carries progress_chars/wpm/accuracy from
    -- publishCheckpoint, which is why the checkpoint exists.
    insert into public.battle_results (
      room_id, user_id, display_name, avatar, correct_chars, typed_chars,
      mistakes, accuracy, consistency, wpm, client_wpm, finished, finished_at,
      duration_sec, flags
    )
    select
      p.room_id, p.user_id, p.display_name, p.avatar,
      coalesce(p.progress_chars, 0), coalesce(p.progress_chars, 0),
      coalesce(p.mistakes, 0), coalesce(p.accuracy, 0), null,
      coalesce(p.wpm, 0), coalesce(p.wpm, 0), false, null,
      greatest(0, extract(epoch from (now() - coalesce(r.starts_at, now())))),
      array['timeout']::text[]
      from public.battle_players p
     where p.room_id = p_room
       and p.left_at is null
       and not exists (
         select 1 from public.battle_results res
          where res.room_id = p_room and res.user_id = p.user_id
       )
    on conflict (room_id, user_id) do nothing;

    update public.battle_players
       set status = 'forfeit'
     where room_id = p_room and left_at is null and status = 'racing';

    perform public.battle_settle(p_room);
  end if;
end; $$;

/* ── the janitor now ranks what it finishes ──────────────────────────────── */

create or replace function public.battle_reap() returns void
language plpgsql security definer set search_path = '' as $$
declare
  stale uuid;
begin
  update public.battle_rooms
     set status = 'expired', updated_at = now()
   where status = 'lobby' and expires_at < now();

  update public.battle_rooms
     set status = 'aborted', updated_at = now()
   where status = 'countdown' and starts_at < now() - interval '60 seconds';

  -- A race whose deadline passed is over, whoever is still connected. Settling
  -- rather than a bare status flip: `battle_settle` writes the ranks, and a
  -- results screen with null ranks is not a finished match.
  for stale in
    select id from public.battle_rooms
     where status = 'active' and deadline_at < now()
  loop
    perform public.battle_maybe_settle(stale);
  end loop;

  delete from public.battle_rooms
   where status in ('finished','aborted','expired')
     and updated_at < now() - interval '7 days';
end; $$;

/* ── a member can ask the server to re-evaluate their own room ───────────── */
-- Read-only in effect: it cannot force an outcome, only ask the same predicate
-- `battle_finish` already runs. Membership-gated so it cannot be used to probe
-- rooms the caller is not in.

create or replace function public.battle_sweep(p_room uuid) returns public.battle_rooms
language plpgsql security definer set search_path = '' as $$
declare
  r public.battle_rooms;
begin
  if not public.in_battle(p_room) then
    raise exception 'You are not in that Battlefield' using errcode = 'BF015';
  end if;

  update public.battle_rooms
     set status = 'active', updated_at = now()
   where id = p_room and status = 'countdown' and starts_at <= now();

  perform public.battle_maybe_settle(p_room);

  select * into r from public.battle_rooms where id = p_room;
  return r;
end; $$;

revoke execute on function public.battle_sweep(uuid) from public, anon;
grant  execute on function public.battle_sweep(uuid) to authenticated;

/* ── 3. capacity: 30 players ─────────────────────────────────────────────── */
-- The schema's own ceiling was 8, so the frontend number was never the binding
-- constraint. Raising it here is what makes 30 real; the checks in
-- `battle_create` and `battle_join` below are the server-side validation.
--
-- Realtime is the thing that actually has to hold at 30. It does, because
-- telemetry never touches Postgres: per-player position goes over Broadcast at
-- 1 Hz with delta suppression (useBattleRoom.js), so a 30-player room is 30
-- messages/second on one channel, and the durable path only carries roster and
-- result changes. What does not scale is the durable checkpoint — at 30 players
-- a 5s checkpoint is 6 writes/second on a table 30 clients subscribe to — so
-- the client now scales its checkpoint interval with room size.

alter table public.battle_rooms drop constraint if exists battle_rooms_max_players_check;
alter table public.battle_rooms
  add constraint battle_rooms_max_players_check check (max_players between 2 and 30);

create or replace function public.battle_create(
  p_passage        text,
  p_passage_meta   text default null,
  p_difficulty     text default 'normal',
  p_max_players    int  default 8,
  p_time_limit_sec int  default 180
) returns public.battle_rooms
language plpgsql security definer set search_path = '' as $$
declare
  r    public.battle_rooms;
  uid  uuid := auth.uid();
  live int;
begin
  if uid is null then
    raise exception 'Sign in to open a Battlefield' using errcode = 'BF000';
  end if;
  if p_passage is null or length(p_passage) < 40 or length(p_passage) > 4000 then
    raise exception 'That passage is not a usable length' using errcode = 'BF008';
  end if;
  if p_max_players < 2 or p_max_players > 30 then
    raise exception 'A Battlefield holds 2 to 30 players' using errcode = 'BF007';
  end if;

  perform public.battle_reap();

  select count(*) into live from public.battle_rooms
   where admin_id = uid and status in ('lobby','countdown','active');
  if live >= 3 then
    raise exception 'You already have 3 Battlefields open' using errcode = 'BF010';
  end if;

  insert into public.battle_rooms (
    pin, admin_id, max_players, passage_chars, passage_meta, difficulty, time_limit_sec
  ) values (
    public.battle_mint_pin(), uid, p_max_players, length(p_passage),
    p_passage_meta, coalesce(p_difficulty, 'normal'), p_time_limit_sec
  ) returning * into r;

  insert into public.battle_passages (room_id, passage) values (r.id, p_passage);

  insert into public.battle_players (room_id, user_id, display_name, avatar, is_admin)
  select r.id, uid, p.display_name, p.avatar, true
    from public.profiles p where p.id = uid;

  if not found then
    insert into public.battle_players (room_id, user_id, display_name, is_admin)
    values (r.id, uid, 'Player', true);
  end if;

  return r;
end; $$;

revoke execute on function public.battle_create(text, text, text, int, int) from public, anon;
grant  execute on function public.battle_create(text, text, text, int, int) to authenticated;

/* ── 4. realtime membership, as a migration ──────────────────────────────── */
-- This lived in scripts/configure-realtime.mjs, run by hand against a database
-- URL with a password in it. Every `postgres_changes` subscription in the app
-- is inert unless it has been run, and nothing about a fresh deploy says so —
-- the room simply never updates and the admin roster never grows. A hand-run
-- script is not a deployment step you can forget once; it is one you forget
-- every time. It belongs here.
--
-- REPLICA IDENTITY FULL is required for `battle_rooms`: useBattleRoom reads
-- `payload.new` for the whole row on UPDATE, and the default (primary key only)
-- would deliver an id and nulls.

do $$
declare
  t text;
begin
  foreach t in array array[
    'battle_rooms', 'battle_players', 'battle_results', 'profiles'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;

  foreach t in array array['battle_rooms', 'battle_players', 'battle_results'] loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
exception
  -- A self-hosted database without the Supabase realtime publication should not
  -- fail the migration; the app degrades to polling, which it already handles.
  when undefined_object then
    raise notice 'supabase_realtime publication not present — skipping';
end $$;

/* ── 5. indexes the settle path leans on ─────────────────────────────────── */
-- `battle_maybe_settle` runs a NOT EXISTS against battle_results per player on
-- every finish. At 30 players that is 30 probes per report and 900 per match.

create index if not exists battle_results_room_user_idx
  on public.battle_results (room_id, user_id);

create index if not exists battle_players_room_live_idx
  on public.battle_players (room_id) where left_at is null;

create index if not exists battle_rooms_live_idx
  on public.battle_rooms (status, deadline_at) where status in ('lobby','countdown','active');
