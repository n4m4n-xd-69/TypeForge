-- Notices: an operator message delivered to one person or to everyone.
--
-- Builds on 0014's `announcements` rather than adding a second table, because
-- "a message with an audience and a live window" is exactly what that already
-- was. What it lacked was the two things that make it usable:
--
--   frequency  — show every time, or once and never again
--   target     — one named account, not only a broad audience
--
-- "Once" needs per-person state, so `announcement_reads` records who has seen
-- what. That table is also what makes a dismissal durable across devices: a
-- notice dismissed on a laptop stays dismissed on a phone, which localStorage
-- could not do.

alter table public.announcements
  add column if not exists frequency text not null default 'once'
    check (frequency in ('once', 'every_time')),
  add column if not exists target_user_id uuid references auth.users on delete cascade,
  add column if not exists dismissible boolean not null default true;

comment on column public.announcements.frequency is
  'once = shown until the person dismisses it, then never again. '
  'every_time = shown on every visit while the notice is live.';

comment on column public.announcements.target_user_id is
  'When set, only this account sees the notice and `audience` is ignored. '
  'A targeted notice is how an operator explains a decision to one person.';

create index if not exists announcements_target_idx
  on public.announcements (target_user_id) where target_user_id is not null;

/* ── per-person read state ────────────────────────────────────────────────
   Written by the reader, about themselves, and by nobody else. There is no
   update policy: seeing something twice is not a state worth editing, and
   `seen_count` is maintained through the insert's own conflict clause. */

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  dismissed_at    timestamptz,
  seen_count      int not null default 1,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.announcement_reads enable row level security;

drop policy if exists "own reads" on public.announcement_reads;
create policy "own reads" on public.announcement_reads
  for select using (auth.uid() = user_id or public.admin_can('config.write'));

drop policy if exists "insert own reads" on public.announcement_reads;
create policy "insert own reads" on public.announcement_reads
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own reads" on public.announcement_reads;
create policy "update own reads" on public.announcement_reads
  for update using (auth.uid() = user_id);

/* ── what the current person should be shown ──────────────────────────────
   One round trip on app load. Ordered so a critical notice outranks an
   informational one regardless of when each was published — an outage note
   published yesterday should not sit behind a feature announcement from
   today. */

create or replace function public.my_notices()
returns table (
  id uuid, title text, body text, tone text, frequency text,
  dismissible boolean, targeted boolean, starts_at timestamptz, ends_at timestamptz
)
language sql security definer stable set search_path = ''
as $$
  select a.id, a.title, a.body, a.tone, a.frequency,
         a.dismissible, a.target_user_id is not null, a.starts_at, a.ends_at
  from public.announcements a
  left join public.announcement_reads r
    on r.announcement_id = a.id and r.user_id = auth.uid()
  where auth.uid() is not null
    and a.published
    and a.starts_at <= now()
    and (a.ends_at is null or a.ends_at > now())
    and (
      -- A targeted notice ignores `audience` entirely: it was written for one
      -- person, and widening it by accident is the failure that matters here.
      case when a.target_user_id is not null
           then a.target_user_id = auth.uid()
           else a.audience = 'all'
                or (a.audience = 'admins' and public.is_admin())
                or (a.audience = 'beta'   and public.is_admin())
      end
    )
    -- 'every_time' ignores read state by design; 'once' stops at dismissal,
    -- not at first sight, so closing the tab does not lose the message.
    and (a.frequency = 'every_time' or r.dismissed_at is null)
  order by
    case a.tone when 'critical' then 0 when 'warn' then 1 when 'success' then 2 else 3 end,
    a.starts_at desc;
$$;

/* Records a viewing. Advisory — a failure here must never stop the notice
   from rendering, so the client fires it and ignores the result. */
create or replace function public.mark_notice_seen(p_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.announcement_reads (announcement_id, user_id)
  select p_id, auth.uid()
  where auth.uid() is not null
  on conflict (announcement_id, user_id) do update
    set seen_count = public.announcement_reads.seen_count + 1,
        last_seen_at = now();
$$;

create or replace function public.dismiss_notice(p_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.announcement_reads (announcement_id, user_id, dismissed_at)
  select p_id, auth.uid(), now()
  where auth.uid() is not null
  on conflict (announcement_id, user_id) do update
    set dismissed_at = now(), last_seen_at = now();
$$;

/* ── operator side ──────────────────────────────────────────────────────── */

-- Replaces 0014's version: same shape plus frequency, target and dismissible.
create or replace function public.admin_upsert_announcement(
  p_id          uuid,
  p_title       text,
  p_body        text,
  p_tone        text default 'info',
  p_audience    text default 'all',
  p_published   boolean default false,
  p_starts_at   timestamptz default now(),
  p_ends_at     timestamptz default null,
  p_frequency   text default 'once',
  p_target_user uuid default null,
  p_dismissible boolean default true
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_before jsonb;
begin
  perform public.admin_require('config.write');
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'a notice needs a title and a body';
  end if;
  if p_frequency not in ('once', 'every_time') then
    raise exception 'unknown frequency %', p_frequency;
  end if;
  -- A notice nobody can close and that returns on every visit is a trap, not
  -- a message. One of the two has to give.
  if p_frequency = 'every_time' and not p_dismissible then
    raise exception 'a notice shown every time must be dismissible';
  end if;

  if p_id is null then
    insert into public.announcements
      (title, body, tone, audience, published, starts_at, ends_at,
       frequency, target_user_id, dismissible, created_by)
    values (p_title, p_body, p_tone, p_audience, p_published, p_starts_at, p_ends_at,
            p_frequency, p_target_user, p_dismissible, auth.uid())
    returning id into v_id;
  else
    select to_jsonb(x) into v_before from (
      select title, published, tone, audience, frequency, target_user_id
      from public.announcements where id = p_id) x;
    update public.announcements
       set title = p_title, body = p_body, tone = p_tone, audience = p_audience,
           published = p_published, starts_at = p_starts_at, ends_at = p_ends_at,
           frequency = p_frequency, target_user_id = p_target_user,
           dismissible = p_dismissible, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'no such notice'; end if;
  end if;

  perform public.admin_audit(
    case when p_id is null then 'notice.create' else 'notice.update' end,
    format('%s "%s" (%s, %s)',
           case when p_published then 'Published' else 'Saved draft' end,
           p_title, p_frequency,
           case when p_target_user is not null then 'one account' else p_audience end),
    'announcement', v_id::text, v_before,
    jsonb_build_object('title', p_title, 'published', p_published,
                       'frequency', p_frequency, 'targeted', p_target_user is not null),
    null);

  return v_id;
end;
$$;

/* Delivery stats, so an operator can see whether a notice actually landed
   rather than assuming it did. */
create or replace function public.admin_notice_stats()
returns table (id uuid, seen_by bigint, dismissed_by bigint)
language sql security definer stable set search_path = ''
as $$
  select a.id,
         count(r.user_id) filter (where r.user_id is not null),
         count(r.user_id) filter (where r.dismissed_at is not null)
  from public.announcements a
  left join public.announcement_reads r on r.announcement_id = a.id
  where public.admin_can('config.write')
  group by a.id;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'my_notices()', 'mark_notice_seen(uuid)', 'dismiss_notice(uuid)',
    'admin_notice_stats()',
    'admin_upsert_announcement(uuid,text,text,text,text,boolean,timestamptz,timestamptz,text,uuid,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- 0014's eight-argument signature is superseded; dropping it stops PostgREST
-- resolving a call to the older, target-less version by argument count.
drop function if exists public.admin_upsert_announcement(
  uuid, text, text, text, text, boolean, timestamptz, timestamptz);
