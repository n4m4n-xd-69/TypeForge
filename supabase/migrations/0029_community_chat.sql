-- Community Live Chat, Phase 1: channels, messages, mutes, a first-visit
-- profile-prompt flag, a working /ai bot identity, and chat image storage.
--
-- See docs/superpowers/specs/2026-09-05-community-chat-phase1-design.md.
--
-- Follows community_posts' exact shape (0025): a table with soft-delete,
-- SECURITY DEFINER RPCs that own every write, and admin_can('content.moderate')
-- as the one moderation gate this whole app already uses. The one deliberate
-- departure: there is no client-facing insert policy on chat_messages at all.
-- community_posts has one that duplicates the RPC's "active account" check as
-- defense in depth (see its own comment), but that duplication doesn't cover
-- the RPC's rate limit or mute check — a client could insert directly via
-- PostgREST and skip both. For a new table there's a stronger option: no
-- policy, so chat_send_message (and, for the bot, the service role) are
-- structurally the only ways in.

/* ══ 1. channels ═════════════════════════════════════════════════════════ */

create table if not exists public.chat_channels (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.chat_channels enable row level security;

drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels
  for select to authenticated using (true);

-- Fixed, admin-curated list for Phase 1 — channel creation is a later phase.
insert into public.chat_channels (slug, name, description, sort_order) values
  ('general', '#general', 'Say hello, share a Battlefield code, ask anything.', 0),
  ('help',    '#help',    'Stuck on something? Ask here.', 1)
on conflict (slug) do nothing;

/* ══ 2. messages ═════════════════════════════════════════════════════════ */

create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.chat_channels on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  body         text check (body is null or length(btrim(body)) between 1 and 2000),
  image_url    text,
  -- Snapshotted at post time, not joined live. Keeps the realtime INSERT
  -- payload self-sufficient (no per-message round trip to resolve an
  -- author) at the cost of an old message not relabeling itself if someone
  -- renames later — a deliberate trade-off, see the spec §2.
  display_name text,
  avatar       text,
  photo_url    text,
  is_bot       boolean not null default false,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint chat_messages_content_check check (body is not null or image_url is not null)
);

create index if not exists chat_messages_channel_feed_idx
  on public.chat_messages (channel_id, created_at desc) where deleted_at is null;

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to authenticated using (deleted_at is null);

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for update to authenticated
  using (user_id = auth.uid() or public.admin_can('content.moderate'))
  with check (user_id = auth.uid() or public.admin_can('content.moderate'));

/* ══ 3. mutes ════════════════════════════════════════════════════════════ */

create table if not exists public.chat_mutes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  -- null = muted everywhere, not just one channel.
  channel_id  uuid references public.chat_channels on delete cascade,
  reason      text,
  muted_by    uuid not null references auth.users,
  muted_until timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Not a partial index on `muted_until > now()` — a partial index predicate
-- must be immutable, and now() is not. chat_send_message's own lookup filters
-- on muted_until at query time instead, same lazy-expiry stance battle_reap
-- takes elsewhere: nothing has to clean up an expired mute for it to stop
-- applying.
create index if not exists chat_mutes_user_channel_idx
  on public.chat_mutes (user_id, channel_id, muted_until);

alter table public.chat_mutes enable row level security;

-- Only the admin console reads this table directly (to list active mutes);
-- every write goes through the two admin_*_chat_user RPCs below.
drop policy if exists chat_mutes_admin_read on public.chat_mutes;
create policy chat_mutes_admin_read on public.chat_mutes
  for select to authenticated using (public.admin_can('content.moderate'));

/* ══ 4. profile flag ═════════════════════════════════════════════════════ */

alter table public.profiles
  add column if not exists community_intro_seen boolean not null default false;

/* ══ 5. the reserved "TypeForge AI" bot identity ════════════════════════ */
-- A fixed-UUID row so /ai replies are ordinary chat_messages authored by a
-- real profile, not a special case the client has to know about. See this
-- plan's "flagged for verification" note above the task list — this insert
-- is the standard minimal-columns pattern for seeding a Supabase service
-- user, unverified against this project's exact auth.users constraints.

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated', 'authenticated', 'chat-ai@typeforge.internal',
  crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
  now(), now(),
  '{"provider":"internal","providers":["internal"]}'::jsonb, '{}'::jsonb,
  false, '', ''
)
on conflict (id) do nothing;

-- `do update`, not `do nothing`: 0001's on_auth_user_created trigger already
-- fired on the insert above and created a bare profiles row (display_name
-- '', since raw_user_meta_data carries no full_name) before this statement
-- runs. `do nothing` here would leave that bare row in place forever and the
-- bot would post under an empty name. Same race 0004_seed_admin.sql hits
-- seeding the first admin — and the same fix: overwrite what the trigger left.
insert into public.profiles (id, display_name, status, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', 'TypeForge AI', 'active', now(), now())
on conflict (id) do update
  set display_name = excluded.display_name,
      status       = excluded.status,
      updated_at   = now();

/* ══ 6. writes ═══════════════════════════════════════════════════════════ */

create or replace function public.chat_send_message(
  p_channel   uuid,
  p_body      text default null,
  p_image_url text default null
) returns public.chat_messages
language plpgsql security definer set search_path = '' as $$
declare
  msg    public.chat_messages;
  uid    uuid := auth.uid();
  prof   record;
  recent int;
begin
  if uid is null then
    raise exception 'Sign in to chat' using errcode = 'CH000';
  end if;

  if coalesce(btrim(p_body), '') = '' and p_image_url is null then
    raise exception 'a message needs text or an image' using errcode = 'CH004';
  end if;

  if not exists (select 1 from public.chat_channels where id = p_channel) then
    raise exception 'No such channel' using errcode = 'CH007';
  end if;

  select display_name, avatar, photo_url, coalesce(status, 'active') as status
    into prof
    from public.profiles where id = uid;

  if prof.status is distinct from 'active' then
    raise exception 'Your account cannot post right now' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.chat_mutes
     where user_id = uid
       and (channel_id = p_channel or channel_id is null)
       and muted_until > now()
  ) then
    raise exception 'You are muted here right now' using errcode = 'CH003';
  end if;

  -- Rate limit in the database, same reasoning community_post's own comment
  -- gives: it cannot be skipped by not using the UI.
  select count(*) into recent from public.chat_messages
   where user_id = uid and created_at > now() - interval '1 minute';
  if recent >= 20 then
    raise exception 'Slow down a moment — twenty messages a minute is the limit'
      using errcode = 'CH001';
  end if;

  insert into public.chat_messages (
    channel_id, user_id, body, image_url, display_name, avatar, photo_url
  ) values (
    p_channel, uid, nullif(btrim(p_body), ''), p_image_url,
    prof.display_name, prof.avatar, prof.photo_url
  ) returning * into msg;

  return msg;
end; $$;

revoke execute on function public.chat_send_message(uuid, text, text) from public, anon;
grant  execute on function public.chat_send_message(uuid, text, text) to authenticated;

create or replace function public.chat_delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_messages
     set deleted_at = now()
   where id = p_id
     and deleted_at is null
     and (user_id = auth.uid() or public.admin_can('content.moderate'));

  if not found then
    raise exception 'not your message' using errcode = 'CH005';
  end if;
end; $$;

revoke execute on function public.chat_delete_message(uuid) from public, anon;
grant  execute on function public.chat_delete_message(uuid) to authenticated;

/* ══ 7. moderation ═══════════════════════════════════════════════════════ */

create or replace function public.admin_mute_chat_user(
  p_user    uuid,
  p_channel uuid default null,
  p_minutes int default 60,
  p_reason  text default null
) returns public.chat_mutes
language plpgsql security definer set search_path = '' as $$
declare
  m public.chat_mutes;
begin
  perform public.admin_require('content.moderate');

  if p_minutes <= 0 or p_minutes > 10080 then -- 7 days
    raise exception 'mute duration must be between 1 minute and 7 days' using errcode = '22023';
  end if;

  insert into public.chat_mutes (user_id, channel_id, reason, muted_by, muted_until)
  values (
    p_user, p_channel, nullif(btrim(coalesce(p_reason, '')), ''),
    auth.uid(), now() + make_interval(mins => p_minutes)
  ) returning * into m;

  perform public.admin_audit(
    'chat.user.mute',
    format('Muted a chat member for %s minute(s)', p_minutes),
    'chat_user', p_user::text,
    null, jsonb_build_object('channel_id', p_channel, 'muted_until', m.muted_until),
    coalesce(p_reason, '')
  );

  return m;
end; $$;

revoke execute on function public.admin_mute_chat_user(uuid, uuid, int, text) from public, anon;
grant  execute on function public.admin_mute_chat_user(uuid, uuid, int, text) to authenticated;

create or replace function public.admin_unmute_chat_user(
  p_user    uuid,
  p_channel uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require('content.moderate');

  update public.chat_mutes
     set muted_until = now()
   where user_id = p_user
     and muted_until > now()
     and channel_id is not distinct from p_channel;

  perform public.admin_audit(
    'chat.user.unmute',
    'Lifted a chat mute',
    'chat_user', p_user::text,
    null, jsonb_build_object('channel_id', p_channel),
    null
  );
end; $$;

revoke execute on function public.admin_unmute_chat_user(uuid, uuid) from public, anon;
grant  execute on function public.admin_unmute_chat_user(uuid, uuid) to authenticated;

/* ══ 8. chat image storage ═══════════════════════════════════════════════ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images', 'chat-images', true, 5242880,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists chat_images_public_read on storage.objects;
create policy chat_images_public_read on storage.objects
  for select using (bucket_id = 'chat-images');

drop policy if exists chat_images_own_insert on storage.objects;
create policy chat_images_own_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists chat_images_own_delete on storage.objects;
create policy chat_images_own_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text
  );

/* ══ 9. realtime ═════════════════════════════════════════════════════════ */

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not present — skipping';
end $$;
