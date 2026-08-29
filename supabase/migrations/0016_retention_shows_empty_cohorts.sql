-- Fixes admin_retention so a cohort with no return activity still appears.
--
-- Found by running the function against real data. TypeForge syncs a user's
-- locally-stored session history when they sign up, so `sessions.ts` routinely
-- predates `profiles.created_at` — on the project this was found on, the
-- earliest session is a month older than the earliest profile.
--
-- Excluding pre-signup sessions is correct: you cannot retain someone before
-- they joined. But 0014 used an inner join, so a cohort whose members had
-- *only* pre-signup activity produced no rows at all, and the console rendered
-- its "not enough history for cohorts" empty state. That is a different claim
-- from the true one, which is "these cohorts exist, they are this big, and
-- nobody has come back yet" — and it is the more alarming of the two to get
-- wrong, because an operator reads it as missing instrumentation rather than
-- as a retention problem.
--
-- A left join makes every cohort in the window show up with its real size,
-- reporting zero retention as zero rather than as absence.

create or replace function public.admin_retention(p_weeks int default 12)
returns table (cohort date, cohort_size bigint, week_offset int, retained bigint)
language sql security definer stable set search_path = ''
as $$
  with c as (
    select p.id, date_trunc('week', p.created_at)::date as cohort
    from public.profiles p
    where p.created_at >= date_trunc('week', now()) - (p_weeks || ' weeks')::interval
  ),
  sz as (select cohort, count(*) n from c group by 1),
  act as (
    select distinct c.cohort, c.id,
           -- date minus date is an integer count of DAYS in Postgres, not an
           -- interval, so this divides by 7 rather than reaching for
           -- extract(epoch ...), which cannot take an integer.
           ((date_trunc('week', s.ts)::date - c.cohort) / 7)::int as week_offset
    from c join public.sessions s on s.user_id = c.id
    where date_trunc('week', s.ts)::date >= c.cohort
  )
  select sz.cohort,
         sz.n,
         coalesce(a.week_offset, 0) as week_offset,
         count(distinct a.id)       as retained
  from sz
  left join act a on a.cohort = sz.cohort
  where public.admin_can('analytics.read')
  group by sz.cohort, sz.n, a.week_offset
  order by sz.cohort desc, 3;
$$;

revoke all on function public.admin_retention(int) from public, anon;
grant execute on function public.admin_retention(int) to authenticated;
