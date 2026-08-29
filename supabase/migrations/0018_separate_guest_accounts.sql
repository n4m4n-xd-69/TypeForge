-- Guest sessions are not users.
--
-- TypeForge signs people in anonymously so the product works before anyone
-- commits to an account (`signInAnonymously` in src/lib/supabase.js). Each of
-- those is a real `auth.users` row, so any count of "users" that does not
-- exclude them reports session churn as growth. On the project this was found
-- on the console read seven users when one person had actually registered.
--
-- That is the kind of wrong number an admin panel must not produce: it is
-- plausible, it trends in the flattering direction, and nothing about the
-- screen invites you to doubt it.
--
-- `auth.users.is_anonymous` is the discriminator. It is exposed through the
-- overview so the console can filter on it, and `admin_kpis` now reports the
-- two populations separately rather than summing them.

/* ── overview: carry the account type and the lifecycle status ──────────── */
-- The return type changes, and CREATE OR REPLACE cannot alter OUT parameters,
-- so this drops first. Safe: the function is only ever called by the console.
drop function if exists public.admin_user_overview();

create or replace function public.admin_user_overview()
returns table (
  id uuid,
  display_name text,
  email text,
  signed_up timestamptz,
  last_seen timestamptz,
  xp int,
  streak_count int,
  streak_best int,
  sessions bigint,
  total_seconds bigint,
  ai_calls bigint,
  ai_tokens bigint,
  is_guest boolean,
  status text
)
language sql security definer stable set search_path = '' as $$
  select
    p.id,
    p.display_name,
    u.email,
    u.created_at                          as signed_up,
    u.last_sign_in_at                     as last_seen,
    p.xp, p.streak_count, p.streak_best,
    coalesce(s.session_count, 0)          as sessions,
    coalesce(s.total_seconds, 0)          as total_seconds,
    coalesce(a.ai_calls, 0)               as ai_calls,
    coalesce(a.ai_tokens, 0)              as ai_tokens,
    coalesce(u.is_anonymous, false)       as is_guest,
    p.status
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select count(*) session_count, sum(duration_sec)::int total_seconds
    from public.sessions where user_id = p.id
  ) s on true
  left join lateral (
    select count(*) ai_calls,
           sum(coalesce(prompt_tokens, 0) + coalesce(output_tokens, 0)) ai_tokens
    from public.ai_usage where user_id = p.id
  ) a on true
  where public.is_admin();
$$;

revoke all on function public.admin_user_overview() from public, anon;
grant execute on function public.admin_user_overview() to authenticated;

/* ── KPIs: registered and guest counted separately ──────────────────────── */
create or replace function public.admin_kpis(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
) returns jsonb
language sql security definer stable set search_path = ''
as $$
  with span as (
    select p_from as f, p_to as t,
           p_from - (p_to - p_from) as pf,
           p_from as pt
  ),
  u as (
    -- `total_users` means REGISTERED accounts. Guests are reported beside it,
    -- never folded into it.
    select
      count(*) filter (where not coalesce(au.is_anonymous, false)
                         and p.created_at < (select t from span))                as total_users,
      count(*) filter (where coalesce(au.is_anonymous, false))                   as guest_users,
      count(*) filter (where not coalesce(au.is_anonymous, false)
                         and p.created_at between (select f from span) and (select t from span)) as new_users,
      count(*) filter (where not coalesce(au.is_anonymous, false)
                         and p.created_at between (select pf from span) and (select pt from span)) as prev_new_users,
      count(*) filter (where p.status = 'suspended')                             as suspended,
      count(*) filter (where p.status = 'deleted')                               as removed
    from public.profiles p
    join auth.users au on au.id = p.id
  ),
  s as (
    select
      count(*)                          as sessions,
      count(distinct user_id)           as active_users,
      coalesce(sum(duration_sec), 0)    as seconds,
      coalesce(sum(xp), 0)              as xp_earned,
      coalesce(avg(wpm), 0)             as avg_wpm,
      coalesce(avg(accuracy), 0)        as avg_accuracy,
      count(*) filter (where kind = 'code') as coding_sessions,
      count(*) filter (where kind <> 'code') as typing_sessions
    from public.sessions
    where ts between (select f from span) and (select t from span)
  ),
  sp as (
    select count(*) as sessions, count(distinct user_id) as active_users
    from public.sessions
    where ts between (select pf from span) and (select pt from span)
  ),
  a as (
    select
      count(*)                                        as ai_calls,
      count(*) filter (where not ok)                  as ai_failures,
      coalesce(sum(coalesce(prompt_tokens,0) + coalesce(output_tokens,0)), 0) as ai_tokens,
      coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)  as ai_p50,
      coalesce(percentile_cont(0.95) within group (order by latency_ms), 0) as ai_p95
    from public.ai_usage
    where created_at between (select f from span) and (select t from span)
  ),
  g as (
    select
      (select count(*) from public.battle_results br
        join public.battle_rooms brm on brm.id = br.room_id
        where brm.created_at between (select f from span) and (select t from span)) as battle_finishes,
      (select count(*) from public.shadow_results sr
        where sr.created_at between (select f from span) and (select t from span))  as shadow_results,
      (select count(*) from public.battle_rooms
        where status in ('lobby','countdown','active'))                              as live_battle_rooms,
      (select count(*) from public.shadow_rooms
        where status in ('lobby','countdown','active','round_end','paused'))         as live_shadow_rooms,
      (select count(*) from public.shadow_queue where matched_room_id is null)        as queue_depth
  ),
  x as (
    select coalesce(sum(delta), 0) as xp_granted
    from public.xp_adjustments
    where created_at between (select f from span) and (select t from span)
  )
  select to_jsonb(k) from (
    select
      u.total_users, u.guest_users, u.new_users, u.prev_new_users,
      u.suspended, u.removed,
      s.sessions, s.active_users, s.seconds, s.xp_earned,
      round(s.avg_wpm::numeric, 1)      as avg_wpm,
      round(s.avg_accuracy::numeric, 2) as avg_accuracy,
      s.typing_sessions, s.coding_sessions,
      sp.sessions      as prev_sessions,
      sp.active_users  as prev_active_users,
      a.ai_calls, a.ai_failures, a.ai_tokens,
      round(a.ai_p50::numeric)  as ai_p50_ms,
      round(a.ai_p95::numeric)  as ai_p95_ms,
      g.battle_finishes, g.shadow_results,
      g.live_battle_rooms, g.live_shadow_rooms, g.queue_depth,
      x.xp_granted,
      -- Still not instrumented: TypeForge has no billing system.
      null::numeric as revenue
    from u, s, sp, a, g, x
  ) k
  where public.admin_can('analytics.read');
$$;

revoke all on function public.admin_kpis(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_kpis(timestamptz, timestamptz) to authenticated;
