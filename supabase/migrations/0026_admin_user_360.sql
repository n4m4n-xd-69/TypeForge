-- The user drill-down, completed.
--
-- `admin_user_detail` (0014) was written before Battlefield (0009 → 0023) and
-- Community (0025) existed, so the one screen whose job is "everything we know
-- about this account" answers with practice, Shadow and AI only. An operator
-- looking at a person who plays nothing but Battlefield sees an empty sheet and
-- concludes the account is idle. That is the same class of error as the roster
-- showing one user: the data was there, the view did not ask for it.
--
-- Three additions, no removals — the existing keys keep their exact shape so
-- the panel that reads them does not care that this ran:
--
--   profile.*   identity the sheet could not show: avatar, uploaded photo, the
--               community fields, the auth provider, and whether this is a
--               guest. Provider comes from `raw_app_meta_data` rather than from
--               `auth_events`, because an account that signed in once before we
--               started logging events still has a provider.
--   battle      participation: rooms opened, rooms joined, matches, wins, and
--               the recent history behind those numbers.
--   community   activity *counts and links*, not post bodies. The sheet ends
--               with a standing promise that it shows metadata only, and the
--               moderation surface for post text is ContentView, which exists
--               and is scope-gated for it. Two places to read the same content
--               is two places to get the privacy boundary wrong.
--
-- CREATE OR REPLACE keeps the existing grants and the `admin_can('users.read')`
-- gate at the bottom, which is what stops this being readable by anyone else.

create or replace function public.admin_user_detail(p_user uuid)
returns jsonb
language sql security definer stable set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select to_jsonb(x) from (
        select p.id, p.display_name, u.email, p.xp, p.streak_count, p.streak_best,
               p.status, p.status_reason, p.status_changed_at, p.goal_minutes,
               p.created_at as signed_up, u.last_sign_in_at as last_seen,
               r.role, r.admin_tier,
               -- identity, so the sheet can show a face and say how they got in
               p.avatar, p.photo_url, p.course, p.branch, p.study_year, p.bio,
               coalesce(u.raw_app_meta_data ->> 'provider',
                        case when u.is_anonymous then 'anonymous' end) as provider,
               coalesce(u.is_anonymous, false) as is_guest,
               u.created_at as auth_created_at
        from public.profiles p
        join auth.users u on u.id = p.id
        left join public.user_roles r on r.user_id = p.id
        where p.id = p_user
      ) x
    ),
    'totals', (
      select to_jsonb(x) from (
        select count(*) sessions, coalesce(sum(duration_sec),0)::bigint seconds,
               coalesce(round(avg(wpm)::numeric,1),0) avg_wpm,
               coalesce(round(avg(accuracy)::numeric,2),0) avg_accuracy,
               coalesce(round(max(wpm)::numeric,1),0) best_wpm,
               coalesce(sum(errors),0)::bigint errors
        from public.sessions where user_id = p_user
      ) x
    ),
    'recent_sessions', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, ts, kind, mode, language, difficulty,
               round(wpm::numeric,1) wpm, round(accuracy::numeric,2) accuracy,
               duration_sec, errors, xp
        from public.sessions where user_id = p_user order by ts desc limit 50
      ) x
    ),
    'daily', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select day, seconds, sessions, xp from public.daily_stats
        where user_id = p_user order by day desc limit 180
      ) x
    ),
    'key_stats', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select key, total, wrong from public.key_stats where user_id = p_user
      ) x
    ),
    'problems', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select problem_id, status, attempts, language, solved_at
        from public.problem_progress where user_id = p_user order by updated_at desc limit 100
      ) x
    ),
    'achievements', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select achievement, unlocked_at from public.achievements
        where user_id = p_user order by unlocked_at desc
      ) x
    ),
    'shadow', (
      select to_jsonb(x) from (
        select fr, peak_fr, matches, wins, losses, draws, streak, best_streak,
               round(avg_wpm::numeric,1) avg_wpm, round(avg_accuracy::numeric,2) avg_accuracy
        from public.shadow_ratings where user_id = p_user
      ) x
    ),
    'opponents', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select coalesce(op.display_name, 'unknown') as opponent, count(*) meetings,
               count(*) filter (where me.outcome = 'win') wins
        from public.shadow_results me
        join public.shadow_results them
          on them.room_id = me.room_id and them.user_id <> me.user_id
        left join public.profiles op on op.id = them.user_id
        where me.user_id = p_user
        group by 1 order by 2 desc limit 10
      ) x
    ),

    /* ── Battlefield ──────────────────────────────────────────────────────
       `rooms_joined` counts battle_players rows, which includes the rooms
       this account opened — someone who hosts is also a participant, and a
       host count that did not appear in the join count would read as two
       separate populations. `hosted` is the subset, reported next to it. */
    'battle', (
      select to_jsonb(x) from (
        select
          (select count(*)::int from public.battle_rooms rr where rr.admin_id = p_user)                     as rooms_created,
          (select count(*)::int from public.battle_players bp where bp.user_id = p_user)                    as rooms_joined,
          (select count(*)::int from public.battle_players bp
            where bp.user_id = p_user and bp.left_at is not null)                                          as rooms_left,
          count(*)::int                                                                                    as matches,
          count(*) filter (where res.rank = 1)::int                                                        as wins,
          count(*) filter (where res.rank = 2 or res.rank = 3)::int                                         as podium,
          count(*) filter (where not res.finished)::int                                                    as unfinished,
          coalesce(round(avg(res.wpm)::numeric, 1), 0)                                                     as avg_wpm,
          coalesce(round(max(res.wpm)::numeric, 1), 0)                                                     as best_wpm,
          coalesce(round(avg(res.accuracy)::numeric, 2), 0)                                                as avg_accuracy,
          max(res.created_at)                                                                              as last_match
        from public.battle_results res
        where res.user_id = p_user
      ) x
    ),
    'battle_history', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select rm.pin, rm.status, rm.difficulty, rm.max_players,
               (rm.admin_id = p_user)                          as hosted,
               round(res.wpm::numeric, 1)                      as wpm,
               round(res.accuracy::numeric, 2)                 as accuracy,
               res.rank, res.finished, res.flags,
               round(res.duration_sec::numeric, 1)             as duration_sec,
               res.created_at
        from public.battle_results res
        join public.battle_rooms rm on rm.id = res.room_id
        where res.user_id = p_user
        order by res.created_at desc
        limit 25
      ) x
    ),

    /* ── Community ────────────────────────────────────────────────────────
       Deliberately without `body`. See the header: post text is moderated in
       ContentView under content.moderate, and the drill-down's own footer
       promises metadata only. What an operator needs here is "is this person
       active in the community, and are they spraying room links", which is
       exactly what these counts answer. */
    'community', (
      select to_jsonb(x) from (
        select count(*)::int                                              as posts,
               count(*) filter (where c.deleted_at is not null)::int       as removed,
               count(*) filter (where c.battle_pin is not null)::int       as shared_rooms,
               count(*) filter (where c.created_at > now() - interval '7 days')::int as posts_7d,
               max(c.created_at)                                           as last_post
        from public.community_posts c
        where c.user_id = p_user
      ) x
    ),
    'community_posts', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select c.id, c.battle_pin, c.created_at, c.deleted_at,
               length(c.body) as body_length
        from public.community_posts c
        where c.user_id = p_user
        order by c.created_at desc
        limit 25
      ) x
    ),

    'ai', (
      select to_jsonb(x) from (
        select count(*) calls, count(*) filter (where not ok) failures,
               coalesce(sum(coalesce(prompt_tokens,0)+coalesce(output_tokens,0)),0)::bigint tokens,
               coalesce(round(avg(latency_ms)::numeric),0) avg_latency
        from public.ai_usage where user_id = p_user
      ) x
    ),
    'generations', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select g.id, g.kind, g.category, g.title, g.word_count, g.flagged,
               g.published, g.created_at
        from public.forge_generations g
        where g.created_by = p_user order by g.created_at desc limit 25
      ) x
    ),
    'xp_adjustments', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select delta, reason, created_at from public.xp_adjustments
        where user_id = p_user order by created_at desc limit 25
      ) x
    ),
    'auth_events', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select event, provider, created_at from public.auth_events
        where user_id = p_user order by created_at desc limit 25
      ) x
    ),

    /* Room-removal appeals this person filed (0024). An operator answering an
       appeal in the Arena view should be able to see, from the account, that
       it was not their first. */
    'appeals', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select a.id, a.created_at, a.replied_at,
               (a.admin_reply is not null) as answered,
               rm.pin, rm.removed_reason
        from public.battle_room_appeals a
        left join public.battle_rooms rm on rm.id = a.room_id
        where a.user_id = p_user
        order by a.created_at desc
        limit 25
      ) x
    )
  )
  where public.admin_can('users.read');
$$;

/* The roster row gains the identity fields too, so the table can show a face
   and an operator can tell a Google account from a guest without opening the
   sheet. This is 0018's function with three columns added and nothing else
   changed — same lateral aggregates, same `is_admin()` gate, same
   guest/registered semantics that 0018 was written to get right.

   The return type changes, so it must be dropped rather than replaced, which
   drops the grants with it. They are restored below; leaving that out would
   make the roster fail for every operator. */

drop function if exists public.admin_user_overview();

create or replace function public.admin_user_overview()
returns table (
  id uuid,
  display_name text,
  email text,
  avatar text,
  photo_url text,
  provider text,
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
    p.avatar,
    p.photo_url,
    -- The provider the account actually signed in with. `raw_app_meta_data` is
    -- written by GoTrue at sign-in, so it is right even for an account that
    -- predates our own auth_events logging.
    coalesce(u.raw_app_meta_data ->> 'provider',
             case when u.is_anonymous then 'anonymous' end) as provider,
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
