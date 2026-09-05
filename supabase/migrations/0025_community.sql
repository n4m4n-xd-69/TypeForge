-- Community: a shared feed, the profile fields it shows, and photo storage.
--
-- The design constraint that shapes everything below is §24: a community
-- profile is a *different, smaller* object than an account. Members see a name,
-- a face, and where someone studies. They do not see an email, a provider, an
-- XP total, a suspension status, or any of the account plumbing that happens to
-- live in the same row.
--
-- Postgres enforces that rather than the client remembering to. `profiles` is
-- never read directly by the community surface; `community_profiles` is a view
-- that selects exactly the public columns, and that view is what the client is
-- granted. A field added to `profiles` later is private by default, which is
-- the direction a mistake should fall.

/* ══ 1. the profile fields the community needs ═══════════════════════════ */

alter table public.profiles
  add column if not exists photo_url   text,
  add column if not exists course      text,
  add column if not exists branch      text,
  add column if not exists study_year  int,
  add column if not exists bio         text;

alter table public.profiles drop constraint if exists profiles_study_year_check;
alter table public.profiles
  add constraint profiles_study_year_check
  check (study_year is null or study_year between 1 and 8);

-- Bounded so a paste cannot become a wall. Enforced here and not only in the
-- form, because the form is not the only writer — `pushProfile` in sync.js
-- upserts this row directly from whatever local state holds.
alter table public.profiles drop constraint if exists profiles_text_bounds_check;
alter table public.profiles
  add constraint profiles_text_bounds_check
  check (
    (course is null or length(course) <= 80)
    and (branch is null or length(branch) <= 80)
    and (bio    is null or length(bio)    <= 280)
  );

/* ══ 2. the public projection ════════════════════════════════════════════ */
-- Deliberately NOT `security_invoker`. A view defined the invoker way runs
-- under the reader's own RLS, which would mean granting every member a SELECT
-- policy on `profiles` itself to make the view readable — and RLS policies are
-- OR'd, so that one broad policy would hand every authenticated user every
-- column of every row: `settings`, `xp`, `status`, the lot. The column list in
-- the view would stop being a boundary the moment anyone wrote
-- `select * from profiles` directly.
--
-- With definer semantics (the default) the view runs as its owner, the reader
-- needs no policy on `profiles` at all, and the SELECT list below is the only
-- way across. That is what makes this a projection rather than a suggestion.

create or replace view public.community_profiles as
  select
    p.id            as user_id,
    p.display_name,
    p.avatar,
    p.photo_url,
    p.course,
    p.branch,
    p.study_year,
    p.bio,
    p.created_at    as member_since
  from public.profiles p
  where coalesce(p.status, 'active') = 'active';

revoke all on public.community_profiles from public, anon;
grant select on public.community_profiles to authenticated;

-- No new policy on `profiles`. The view above reaches the rows; a policy here
-- would reach the columns too, which is precisely what must not happen. Dropped
-- rather than merely omitted so re-running an earlier draft of this migration
-- cannot leave the broad policy behind.
drop policy if exists profiles_community_read on public.profiles;

/* ══ 3. posts ════════════════════════════════════════════════════════════ */

create table if not exists public.community_posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 1000),

  -- A shared Battlefield code, extracted and stored as a column rather than
  -- left in the prose. Storing it separately is what lets the feed render a
  -- real join button, and what stops the client parsing user text for
  -- something it will then turn into a link.
  battle_pin text check (battle_pin is null or battle_pin ~ '^[A-Z0-9]{6}$'),

  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists community_posts_feed_idx
  on public.community_posts (created_at desc) where deleted_at is null;

alter table public.community_posts enable row level security;

drop policy if exists community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts
  for select to authenticated using (deleted_at is null);

-- A suspended account may still read the feed and may not add to it. Checking
-- standing here rather than in the UI is the difference between a rule and a
-- suggestion.
drop policy if exists community_posts_write on public.community_posts;
create policy community_posts_write on public.community_posts
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists community_posts_delete on public.community_posts;
create policy community_posts_delete on public.community_posts
  for update to authenticated
  using (user_id = auth.uid() or public.admin_can('content.moderate'))
  with check (user_id = auth.uid() or public.admin_can('content.moderate'));

/**
 * The feed, joined to the public projection in one round trip.
 *
 * A view rather than a client-side join because the alternative is fetching
 * posts, collecting author ids, and fetching profiles — which is two requests
 * that can disagree, and a second query whose column list nobody is watching.
 */
-- Definer, for the same reason as `community_profiles` above: this joins that
-- projection and peeks at one `battle_rooms` column, and it must do so without
-- every member holding a direct read policy on either table.
create or replace view public.community_feed as
  select
    c.id, c.body, c.battle_pin, c.created_at,
    c.user_id,
    cp.display_name, cp.avatar, cp.photo_url, cp.course, cp.branch, cp.study_year,
    -- Whether the shared room is still worth showing a join button for.
    (select r.status from public.battle_rooms r
      where r.pin = c.battle_pin
        and r.status in ('lobby','countdown','active')
      limit 1) as battle_status
  from public.community_posts c
  left join public.community_profiles cp on cp.user_id = c.user_id
  where c.deleted_at is null;

revoke all on public.community_feed from public, anon;
grant select on public.community_feed to authenticated;

/* Posting goes through a function so the pin is validated against a room that
   actually exists — a feed full of dead codes is worse than one with none. */
create or replace function public.community_post(
  p_body text,
  p_pin  text default null
) returns public.community_posts
language plpgsql security definer set search_path = '' as $$
declare
  post public.community_posts;
  pin  text := nullif(btrim(upper(coalesce(p_pin, ''))), '');
  recent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to post' using errcode = 'BF000';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'a message is required' using errcode = '22023';
  end if;

  -- Repeated from the RLS policy on purpose. This function is SECURITY DEFINER,
  -- so it bypasses that policy entirely — and since this is the path the client
  -- actually uses, the policy alone would let a suspended account post through
  -- the only door anyone walks through.
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and coalesce(status, 'active') = 'active'
  ) then
    raise exception 'Your account cannot post right now' using errcode = '42501';
  end if;

  -- Rate limit in the database, where it cannot be skipped by not using the UI.
  select count(*) into recent from public.community_posts
   where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if recent >= 5 then
    raise exception 'Slow down a moment — five posts a minute is the limit'
      using errcode = 'CM001';
  end if;

  if pin is not null and not exists (
    select 1 from public.battle_rooms
     where battle_rooms.pin = pin and status in ('lobby','countdown','active')
  ) then
    raise exception 'That Battlefield code is not open' using errcode = 'BF001';
  end if;

  insert into public.community_posts (user_id, body, battle_pin)
  values (auth.uid(), btrim(p_body), pin)
  returning * into post;

  return post;
end; $$;

revoke execute on function public.community_post(text, text) from public, anon;
grant  execute on function public.community_post(text, text) to authenticated;

create or replace function public.community_delete_post(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.community_posts
     set deleted_at = now()
   where id = p_id
     and deleted_at is null
     and (user_id = auth.uid() or public.admin_can('content.moderate'));

  if not found then
    raise exception 'not your post' using errcode = '42501';
  end if;
end; $$;

revoke execute on function public.community_delete_post(uuid) from public, anon;
grant  execute on function public.community_delete_post(uuid) to authenticated;

/* ══ 4. profile photo storage ════════════════════════════════════════════ */
-- The bucket is public-read: these photos are shown in a feed to every member,
-- so signed URLs would buy nothing and cost a round trip per avatar per render.
-- Writes are the part that must be constrained, and they are: an object's first
-- path segment must be the uploader's own user id, so nobody can write into
-- anybody else's folder or overwrite their photo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_own_insert on storage.objects;
create policy avatars_own_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

/* ══ 5. realtime ═════════════════════════════════════════════════════════ */

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'community_posts'
  ) then
    alter publication supabase_realtime add table public.community_posts;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not present — skipping';
end $$;
