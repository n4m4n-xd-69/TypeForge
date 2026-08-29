-- TypeForge — Admin Console (operator command centre).
--
-- Depends on 0001 (profiles/sessions/daily_stats), 0002 (user_roles, is_admin,
-- ai_usage, auth_events), 0009 (battlefield), 0010 (shadow), 0011 (forge).
--
-- Three things about the shape of this file, all load-bearing:
--
-- 1. Permission is a *scope*, not a role. `is_admin()` from 0002 stays exactly
--    as it was — every policy written against it keeps working — and a second,
--    finer gate (`admin_can('users.write')`) sits on top for the operations
--    that mutate. Roles are how an operator is described; scopes are what the
--    database actually checks.
--
-- 2. No secret ever lands in a table the browser can read. `ai_providers`
--    stores the *name of the secret* (`secret_ref`), a masked tail, and whether
--    the runtime reports it present. The value itself lives in Supabase
--    Function secrets and is only ever read inside an Edge Function.
--
-- 3. Every mutation RPC writes an `admin_audit_log` row in the same
--    transaction as the change it describes. If the audit insert fails the
--    change rolls back. An action that cannot be recorded does not happen.


/* ══ 1. scoped permissions ════════════════════════════════════════════════
   The 0002 enum (`app_role` = user | admin) is left untouched. Adding values
   to a live enum is a migration hazard for no gain here: the thing that
   actually needs granularity is *what an operator may do*, and that is better
   expressed as a scope set than as a wider enum.

   `admin_tier` null on an existing admin row means 'admin', so every operator
   promoted before this migration keeps precisely the access they had. */

alter table public.user_roles
  add column if not exists admin_tier text
    check (admin_tier in ('owner', 'admin', 'analyst', 'support')),
  add column if not exists scopes text[],
  add column if not exists granted_by uuid references auth.users on delete set null,
  add column if not exists granted_at timestamptz not null default now(),
  add column if not exists note text;

comment on column public.user_roles.scopes is
  'Explicit scope override. NULL means "derive from admin_tier", which is the '
  'normal case — an override exists for the rare operator who needs one extra '
  'capability without being promoted a whole tier.';

-- The scope vocabulary, in one place so the UI and the database cannot drift.
create or replace function public.admin_tier_scopes(p_tier text)
returns text[]
language sql immutable
as $$
  select case coalesce(p_tier, 'admin')
    when 'owner' then array[
      'analytics.read','users.read','users.write','users.delete',
      'ai.read','ai.write','content.read','content.moderate',
      'config.write','audit.read','roles.write']
    when 'admin' then array[
      'analytics.read','users.read','users.write','users.delete',
      'ai.read','ai.write','content.read','content.moderate',
      'config.write','audit.read']
    -- Read everything, change nothing. The tier a data analyst gets.
    when 'analyst' then array[
      'analytics.read','users.read','ai.read','content.read','audit.read']
    -- Can act on a user (suspend a spammer, correct an XP bug) but cannot
    -- touch model routing, API keys, feature flags or roles.
    when 'support' then array[
      'analytics.read','users.read','users.write','content.read','content.moderate']
    else array[]::text[]
  end;
$$;

create or replace function public.admin_scopes()
returns text[]
language sql security definer stable set search_path = ''
as $$
  select coalesce(r.scopes, public.admin_tier_scopes(r.admin_tier))
  from public.user_roles r
  where r.user_id = auth.uid() and r.role = 'admin';
$$;

create or replace function public.admin_can(p_scope text)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select coalesce(p_scope = any (public.admin_scopes()), false);
$$;

-- Fails loudly rather than returning an empty set. A *read* that a caller is
-- not entitled to should look like "no data" (0002's convention); a *write*
-- must never look like it silently succeeded.
create or replace function public.admin_require(p_scope text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.admin_can(p_scope) then
    raise exception 'forbidden: % required', p_scope
      using errcode = '42501';
  end if;
end;
$$;


/* ══ 2. audit log ═════════════════════════════════════════════════════════
   Append-only from every angle: no update policy, no delete policy, and the
   only insert path is `admin_audit()` running as definer inside another RPC.
   `before` / `after` are jsonb snapshots of just the fields that changed —
   enough to answer "what did this look like before someone touched it"
   without copying whole rows into the log forever. */

create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users on delete set null,
  actor_email text,                    -- denormalised: the actor may be deleted later
  action      text not null,           -- e.g. user.xp_adjust, ai.model_disable
  target_type text,                    -- user | generation | model | flag | config
  target_id   text,
  summary     text not null,           -- one line, already human-readable
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_actor_idx   on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_target_idx  on public.admin_audit_log (target_type, target_id, created_at desc);
create index if not exists admin_audit_action_idx  on public.admin_audit_log (action, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "audit readers" on public.admin_audit_log;
create policy "audit readers" on public.admin_audit_log
  for select using (public.admin_can('audit.read'));
-- Deliberately no insert/update/delete policy: writes go through admin_audit()
-- as SECURITY DEFINER, which is the only way a row gets in here.

create or replace function public.admin_audit(
  p_action      text,
  p_summary     text,
  p_target_type text default null,
  p_target_id   text default null,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_reason      text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.admin_audit_log
    (actor_id, actor_email, action, target_type, target_id, summary, before, after, reason)
  select auth.uid(), u.email, p_action, p_target_type, p_target_id,
         p_summary, p_before, p_after, p_reason
  from auth.users u where u.id = auth.uid();
end;
$$;


/* ══ 3. account lifecycle ═════════════════════════════════════════════════
   Suspension is a profile-level flag, not an auth.users ban. Two reasons: an
   Edge Function holding the service role is the only thing that can ban in
   GoTrue, and a flag here is readable by the app's own RLS policies, so a
   suspended account can be shown a clear explanation instead of a login that
   mysteriously stops working. The Edge Function path is still available for a
   hard ban; this is the reversible, auditable, in-product one. */

alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended', 'deleted')),
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references auth.users on delete set null;

create index if not exists profiles_status_idx on public.profiles (status)
  where status <> 'active';

-- Manual XP corrections. Kept apart from `sessions` so the XP economy charts
-- can separate earned XP from granted XP — mixing them would make the economy
-- analytics quietly untrue.
create table if not exists public.xp_adjustments (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  delta      int not null check (delta <> 0),
  reason     text not null,
  actor_id   uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists xp_adjustments_user_idx on public.xp_adjustments (user_id, created_at desc);

alter table public.xp_adjustments enable row level security;
drop policy if exists "admins read all" on public.xp_adjustments;
create policy "admins read all" on public.xp_adjustments
  for select using (public.admin_can('users.read'));


/* ══ 4. platform configuration ════════════════════════════════════════════
   One key/value table rather than a column per setting. New knobs (a game
   mode's time limit, a new XP rule, a rate cap) then ship without a migration,
   which is the whole point of the module being called "configuration".

   `value` is jsonb and `schema` describes how the console should render the
   editor for it — so the settings UI is generated from the row rather than
   hand-built once per setting. */

create table if not exists public.platform_config (
  key         text primary key,
  value       jsonb not null,
  category    text not null default 'general',
  label       text not null,
  description text,
  schema      jsonb not null default '{"type":"number"}'::jsonb,
  updated_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.platform_config enable row level security;

-- Config is not secret — the client already needs XP rules and limits to
-- render honestly — so any signed-in user may read it. Writing is scoped.
drop policy if exists "read config" on public.platform_config;
create policy "read config" on public.platform_config
  for select using (auth.role() = 'authenticated');

insert into public.platform_config (key, value, category, label, description, schema) values
  ('xp.per_session',        '10'::jsonb,  'xp',     'XP per completed session',    'Base award for finishing any typed session.',        '{"type":"number","min":0,"max":500}'::jsonb),
  ('xp.wpm_bonus_divisor',  '5'::jsonb,   'xp',     'WPM bonus divisor',           'WPM is divided by this and added to the award.',     '{"type":"number","min":1,"max":50}'::jsonb),
  ('xp.accuracy_floor',     '90'::jsonb,  'xp',     'Accuracy floor for bonus',    'Below this accuracy the WPM bonus is not granted.',  '{"type":"number","min":0,"max":100}'::jsonb),
  ('xp.streak_multiplier',  '1.5'::jsonb, 'xp',     'Streak multiplier cap',       'Highest multiplier a streak can reach.',             '{"type":"number","min":1,"max":5,"step":0.1}'::jsonb),
  ('limits.ai_per_day',     '50'::jsonb,  'limits', 'AI generations per user/day', 'Hard cap enforced by the forge Edge Functions.',     '{"type":"number","min":0,"max":10000}'::jsonb),
  ('limits.battle_players', '8'::jsonb,   'limits', 'Max players per battle room', 'Upper bound on a Battlefield lobby.',                '{"type":"number","min":2,"max":16}'::jsonb),
  ('limits.session_rate',   '120'::jsonb, 'limits', 'Sessions per user/hour',      'Anything above this is flagged as anomalous.',       '{"type":"number","min":1,"max":1000}'::jsonb),
  ('game.shadow_rounds',    '5'::jsonb,   'game',   'Shadow rounds per match',     'Best-of count for a rated Shadow match.',            '{"type":"number","min":1,"max":9}'::jsonb),
  ('game.battle_time_sec',  '180'::jsonb, 'game',   'Battle time limit (s)',       'Default Battlefield race duration.',                 '{"type":"number","min":30,"max":900}'::jsonb)
on conflict (key) do nothing;


/* ══ 5. feature flags ═════════════════════════════════════════════════════
   `rollout` is a percentage bucket, not a user list: the client hashes its own
   user id into 0-99 and compares. That keeps the rollout decision on the
   client (no round trip per flag) while the policy stays here. `audience`
   narrows it further for the cases where a percentage is the wrong tool. */

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  rollout     int not null default 100 check (rollout between 0 and 100),
  audience    text not null default 'all' check (audience in ('all', 'admins', 'beta')),
  label       text not null,
  description text,
  updated_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
drop policy if exists "read flags" on public.feature_flags;
create policy "read flags" on public.feature_flags
  for select using (auth.role() = 'authenticated');

insert into public.feature_flags (key, label, description, enabled) values
  ('forge.speculative_generation', 'Speculative generation', 'Pre-generate passages ahead of demand.',       true),
  ('shadow.ranked',                'Shadow ranked matches',  'Rated Shadow play affecting Forge Rating.',    true),
  ('battle.public_rooms',          'Public battle rooms',    'Let Battlefield rooms be discoverable.',       false),
  ('chat.attachments',             'Chat attachments',       'Allow files in the AI chat surface.',          false)
on conflict (key) do nothing;


/* ══ 6. announcements ═════════════════════════════════════════════════════ */

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  tone       text not null default 'info' check (tone in ('info', 'success', 'warn', 'critical')),
  audience   text not null default 'all' check (audience in ('all', 'admins', 'beta')),
  published  boolean not null default false,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_live_idx on public.announcements (starts_at desc)
  where published;

alter table public.announcements enable row level security;

drop policy if exists "read live announcements" on public.announcements;
create policy "read live announcements" on public.announcements
  for select using (
    public.admin_can('config.write')
    or (published and starts_at <= now() and (ends_at is null or ends_at > now()))
  );


/* ══ 7. AI provider and model registry ════════════════════════════════════
   The console's model control centre reads and writes THIS, never a key.

   `secret_ref` names an Edge Function secret (`supabase secrets set`). The
   value is never in Postgres, never in a PostgREST response, and never in the
   bundle — `scripts/check-bundle-secrets.mjs` already fails the build if a
   key-shaped string reaches dist/. What the console shows instead is
   `key_tail` (last four characters, written by the Edge Function that can
   actually see the key) and `key_present`. That is enough to answer "is this
   provider configured, and is it the key I think it is" without ever
   transporting the secret. */

create table if not exists public.ai_providers (
  id            text primary key,               -- 'openrouter', 'hcnsec'
  label         text not null,
  base_url      text,
  secret_ref    text not null,                  -- name of the Edge Function secret
  key_present   boolean not null default false, -- reported by the runtime, not user-set
  key_tail      text,                           -- last 4 chars, written server-side
  key_rotated_at timestamptz,
  enabled       boolean not null default true,
  priority      int not null default 100,       -- lower wins during routing
  day_limit     int,                            -- requests/day; null = uncapped
  notes         text,
  updated_by    uuid references auth.users on delete set null,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- Belt and braces against a future column that should not be public: the
-- console reads providers through `admin_ai_providers()` (below), which
-- selects an explicit column list. This policy gates the table itself.
alter table public.ai_providers enable row level security;
drop policy if exists "ai readers" on public.ai_providers;
create policy "ai readers" on public.ai_providers
  for select using (public.admin_can('ai.read'));

create table if not exists public.ai_models (
  id             text primary key,              -- 'openrouter:openai/gpt-oss-20b:free'
  provider_id    text not null references public.ai_providers on delete cascade,
  model          text not null,                 -- the provider's own id
  label          text not null,
  lane           text not null default 'general'
                   check (lane in ('general', 'chat', 'passage', 'snippet', 'insight', 'embed')),
  enabled        boolean not null default true,
  priority       int not null default 100,      -- lower is tried first within a lane
  fallback_id    text references public.ai_models on delete set null,
  max_tokens     int,
  temperature    real check (temperature between 0 and 2),
  top_p          real check (top_p between 0 and 1),
  -- Cost in dollars per 1000 tokens. NULL is meaningful and is NOT zero:
  -- src/modules/admin/costs.js already refuses to invent a rate, and the
  -- console reports unrated calls as unrated. Keep that contract here.
  input_cost_per_1k  numeric(12, 6),
  output_cost_per_1k numeric(12, 6),
  context_window int,
  notes          text,
  updated_by     uuid references auth.users on delete set null,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists ai_models_lane_idx on public.ai_models (lane, priority) where enabled;

alter table public.ai_models enable row level security;
drop policy if exists "ai readers" on public.ai_models;
create policy "ai readers" on public.ai_models
  for select using (public.admin_can('ai.read'));

-- Seeded from the rate table the app already ships, so the console starts with
-- the same view of the world the runtime has. Only genuinely free models get a
-- real 0; everything else stays NULL and reads as "rate not configured".
insert into public.ai_providers (id, label, secret_ref, base_url, priority) values
  ('openrouter', 'OpenRouter', 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1', 10),
  ('hcnsec',     'HCN Sec',    'HCNSEC_API_KEY',     null,                            20)
on conflict (id) do nothing;

insert into public.ai_models (id, provider_id, model, label, lane, input_cost_per_1k, output_cost_per_1k) values
  ('openrouter:openai/gpt-oss-20b:free',        'openrouter', 'openai/gpt-oss-20b:free',        'GPT-OSS 20B (free)',   'general', 0, 0),
  ('openrouter:cohere/north-mini-code:free',    'openrouter', 'cohere/north-mini-code:free',    'North Mini Code (free)','snippet', 0, 0),
  ('openrouter:inclusionai/ling-3.0-flash:free','openrouter', 'inclusionai/ling-3.0-flash:free','Ling 3.0 Flash (free)', 'chat',    0, 0),
  ('openrouter:google/gemma-4-26b-a4b-it:free', 'openrouter', 'google/gemma-4-26b-a4b-it:free', 'Gemma 4 26B (free)',    'passage', 0, 0)
on conflict (id) do nothing;


/* ══ 8. admin read access on the surfaces added since 0002 ════════════════
   Additive `for select` policies, exactly as 0002 did: a user's own-row policy
   is untouched and Postgres ORs same-command policies together. Gated on
   analytics.read / content.read rather than is_admin() so an analyst tier is
   possible at all. */

do $$
declare t text;
begin
  foreach t in array array[
    'battle_rooms','battle_players','battle_results',
    'shadow_rooms','shadow_players','shadow_events','shadow_rounds',
    'shadow_results','shadow_ratings','shadow_queue',
    'forge_generation_serves','forge_model_health','forge_budget','forge_request_log'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "console reads all" on public.%I', t);
      execute format(
        'create policy "console reads all" on public.%I for select using (public.admin_can(%L))',
        t, 'analytics.read');
    end if;
  end loop;

  -- The library is content, not telemetry, so it answers to content.read.
  if to_regclass('public.forge_generations') is not null then
    execute 'drop policy if exists "console reads all" on public.forge_generations';
    execute 'create policy "console reads all" on public.forge_generations '
         || 'for select using (public.admin_can(''content.read''))';
  end if;

  -- battle_passages stays deliberately unexposed: 0009 keeps the passage text
  -- out of reach until the countdown for a reason, and an admin read policy on
  -- it would be a live-race information leak through a second door.
end $$;


/* ══ 9. analytics ═════════════════════════════════════════════════════════
   Every function here is SECURITY DEFINER with an `admin_can('analytics.read')`
   guard in its WHERE clause rather than a raised exception, which keeps 0002's
   convention: an unauthorised *read* returns nothing, it does not error.

   They are aggregate-shaped on purpose. The console asking "give me 90 days of
   platform numbers" as one round trip beats it pulling 200k session rows into
   a browser and reducing them in JavaScript, which is what the current
   overview tab does. */

create or replace function public.admin_kpis(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
) returns jsonb
language sql security definer stable set search_path = ''
as $$
  with span as (
    select p_from as f, p_to as t,
           p_from - (p_to - p_from) as pf,   -- the immediately preceding window,
           p_from as pt                       -- for period-over-period deltas
  ),
  u as (
    select
      count(*) filter (where p.created_at < (select t from span))                                as total_users,
      count(*) filter (where p.created_at between (select f from span) and (select t from span)) as new_users,
      count(*) filter (where p.created_at between (select pf from span) and (select pt from span)) as prev_new_users,
      count(*) filter (where p.status = 'suspended')                                             as suspended
    from public.profiles p
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
      u.total_users, u.new_users, u.prev_new_users, u.suspended,
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
      -- Revenue is not instrumented: TypeForge has no billing system, so there
      -- is no honest number to put here. The console renders this as
      -- "not instrumented", never as $0.
      null::numeric as revenue
    from u, s, sp, a, g, x
  ) k
  where public.admin_can('analytics.read');
$$;

-- One row per day across every axis the console charts. Days with no activity
-- are present with zeroes (generate_series), because a gap in a line chart and
-- a zero mean very different things to an operator.
create or replace function public.admin_timeseries(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
) returns table (
  day date, dau bigint, new_users bigint, sessions bigint, seconds bigint,
  xp bigint, avg_wpm numeric, avg_accuracy numeric,
  ai_calls bigint, ai_tokens bigint, ai_failures bigint,
  matches bigint
)
language sql security definer stable set search_path = ''
as $$
  select
    d.day::date,
    coalesce(s.dau, 0), coalesce(n.new_users, 0), coalesce(s.sessions, 0),
    coalesce(s.seconds, 0), coalesce(s.xp, 0),
    coalesce(round(s.avg_wpm::numeric, 1), 0),
    coalesce(round(s.avg_accuracy::numeric, 2), 0),
    coalesce(a.ai_calls, 0), coalesce(a.ai_tokens, 0), coalesce(a.ai_failures, 0),
    coalesce(m.matches, 0)
  from generate_series(p_from::date, p_to::date, interval '1 day') d(day)
  left join (
    select ts::date as day, count(distinct user_id) dau, count(*) sessions,
           sum(duration_sec)::bigint seconds, sum(xp)::bigint xp,
           avg(wpm) avg_wpm, avg(accuracy) avg_accuracy
    from public.sessions where ts >= p_from and ts <= p_to group by 1
  ) s on s.day = d.day::date
  left join (
    select created_at::date as day, count(*) new_users
    from public.profiles where created_at >= p_from and created_at <= p_to group by 1
  ) n on n.day = d.day::date
  left join (
    select created_at::date as day, count(*) ai_calls,
           sum(coalesce(prompt_tokens,0) + coalesce(output_tokens,0))::bigint ai_tokens,
           count(*) filter (where not ok) ai_failures
    from public.ai_usage where created_at >= p_from and created_at <= p_to group by 1
  ) a on a.day = d.day::date
  left join (
    select created_at::date as day, count(*) matches
    from public.shadow_results where created_at >= p_from and created_at <= p_to group by 1
  ) m on m.day = d.day::date
  where public.admin_can('analytics.read')
  order by 1;
$$;

-- Weekly signup cohorts x weeks-since-signup. The classic retention triangle;
-- "retained" means the cohort member had at least one session that week.
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
           -- extract(epoch ...) — which cannot take an integer and would make
           -- this function fail the moment it was called.
           ((date_trunc('week', s.ts)::date - c.cohort) / 7)::int as week_offset
    from c join public.sessions s on s.user_id = c.id
    where date_trunc('week', s.ts)::date >= c.cohort
  )
  select sz.cohort, sz.n, a.week_offset, count(distinct a.id)
  from sz join act a on a.cohort = sz.cohort
  where public.admin_can('analytics.read')
  group by sz.cohort, sz.n, a.week_offset
  order by sz.cohort desc, a.week_offset;
$$;

-- p_dim picks the grouping axis so the console gets language / difficulty /
-- mode breakdowns from one function instead of three near-identical ones.
create or replace function public.admin_typing_analytics(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now(),
  p_dim  text default 'language'
) returns table (
  bucket text, sessions bigint, users bigint, avg_wpm numeric, p90_wpm numeric,
  avg_accuracy numeric, avg_consistency numeric, errors bigint, seconds bigint
)
language sql security definer stable set search_path = ''
as $$
  select
    coalesce(case p_dim
      when 'language'   then language
      when 'difficulty' then difficulty
      when 'mode'       then mode
      else kind
    end, 'unspecified') as bucket,
    count(*), count(distinct user_id),
    round(avg(wpm)::numeric, 1),
    round(coalesce(percentile_cont(0.9) within group (order by wpm), 0)::numeric, 1),
    round(avg(accuracy)::numeric, 2),
    round(coalesce(avg(consistency), 0)::numeric, 2),
    coalesce(sum(errors), 0)::bigint,
    coalesce(sum(duration_sec), 0)::bigint
  from public.sessions
  where ts between p_from and p_to
    and (p_dim <> 'language' or kind <> 'code')
    and public.admin_can('analytics.read')
  group by 1
  having count(*) > 0
  order by 2 desc;
$$;

create or replace function public.admin_coding_analytics(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
) returns table (
  language text, attempts bigint, solved bigint, solvers bigint,
  success_rate numeric, avg_attempts numeric, sessions bigint, avg_wpm numeric
)
language sql security definer stable set search_path = ''
as $$
  select
    coalesce(pp.language, 'unspecified') as language,
    count(*)::bigint                                          as attempts,
    count(*) filter (where pp.status = 'solved')::bigint       as solved,
    count(distinct pp.user_id)::bigint                         as solvers,
    round(100.0 * count(*) filter (where pp.status = 'solved') / nullif(count(*), 0), 1) as success_rate,
    round(avg(pp.attempts)::numeric, 2)                        as avg_attempts,
    coalesce(cs.sessions, 0)                                   as sessions,
    coalesce(cs.avg_wpm, 0)                                    as avg_wpm
  from public.problem_progress pp
  left join lateral (
    select count(*) sessions, round(avg(wpm)::numeric, 1) avg_wpm
    from public.sessions s
    where s.kind = 'code' and s.language = pp.language and s.ts between p_from and p_to
  ) cs on true
  where pp.updated_at between p_from and p_to
    and public.admin_can('analytics.read')
  group by 1, cs.sessions, cs.avg_wpm
  order by 2 desc;
$$;

-- The live pulse. A union of the four event streams an operator actually
-- watches, newest first, cheap enough to poll or to seed a realtime view.
create or replace function public.admin_activity_feed(p_limit int default 50)
returns table (
  at timestamptz, stream text, actor text, actor_id uuid, summary text, tone text
)
language sql security definer stable set search_path = ''
as $$
  -- The scope guard wraps the whole union. Attaching it to a branch would gate
  -- only that branch, which is the easy and very quiet way to write a leak.
  select f.* from (
    select * from (
    select s.ts, 'session',
           coalesce(p.display_name, 'anon'), s.user_id,
           format('%s · %s wpm · %s%%', coalesce(s.language, s.kind),
                  round(s.wpm), round(s.accuracy)),
           'neutral'
    from public.sessions s left join public.profiles p on p.id = s.user_id
    order by s.ts desc limit p_limit
  ) a
  union all select * from (
    select e.created_at, 'auth',
           coalesce(p.display_name, 'anon'), e.user_id, e.event,
           case when e.event = 'failed' then 'bad' else 'neutral' end
    from public.auth_events e left join public.profiles p on p.id = e.user_id
    order by e.created_at desc limit p_limit
  ) b
  union all select * from (
    select u.created_at, 'ai',
           coalesce(p.display_name, 'anon'), u.user_id,
           format('%s · %s · %sms', u.surface, u.model, coalesce(u.latency_ms, 0)),
           case when u.ok then 'neutral' else 'bad' end
    from public.ai_usage u left join public.profiles p on p.id = u.user_id
    order by u.created_at desc limit p_limit
  ) c
  union all select * from (
    select r.created_at, 'match',
           coalesce(p.display_name, 'anon'), r.user_id,
           format('shadow %s · %s fr', r.outcome, r.fr_after),
           case r.outcome when 'win' then 'good' when 'loss' then 'neutral' else 'warn' end
    from public.shadow_results r left join public.profiles p on p.id = r.user_id
    order by r.created_at desc limit p_limit
  ) d
  ) f (at, stream, actor, actor_id, summary, tone)
  where public.admin_can('analytics.read')
  order by f.at desc
  limit p_limit;
$$;

-- Everything the user drill-down needs, in one round trip. Deliberately does
-- NOT include typed content or chat transcripts — 0002's PRD 05 §7.3 line, and
-- an admin console is exactly where that rule matters most.
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
               r.role, r.admin_tier
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
    )
  )
  where public.admin_can('users.read');
$$;

-- Live match board. Battlefield and Shadow normalised into one shape so the
-- arena view is a single table, not two that happen to sit near each other.
create or replace function public.admin_live_matches()
returns table (
  room_id uuid, game text, pin text, status text, band text,
  players int, capacity int, started_at timestamptz, deadline_at timestamptz,
  score text, roster jsonb, created_at timestamptz
)
language sql security definer stable set search_path = ''
as $$
  select r.id, 'battle', r.pin, r.status, r.difficulty,
         (select count(*)::int from public.battle_players bp where bp.room_id = r.id and bp.left_at is null),
         r.max_players, r.starts_at, r.deadline_at, null::text,
         (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', bp.user_id, 'name', bp.display_name, 'wpm', round(bp.wpm::numeric,1),
            'accuracy', round(bp.accuracy::numeric,1), 'progress',
            round(100.0 * bp.progress_chars / nullif(r.passage_chars,0), 1),
            'status', bp.status) order by bp.progress_chars desc), '[]'::jsonb)
          from public.battle_players bp where bp.room_id = r.id),
         r.created_at
  from public.battle_rooms r
  where r.status in ('lobby','countdown','active') and public.admin_can('analytics.read')
  union all
  select s.id, 'shadow', s.pin, s.status, s.band,
         (select count(*)::int from public.shadow_players sp where sp.room_id = s.id and sp.left_at is null),
         2, s.starts_at, s.round_deadline_at,
         format('%s - %s', s.score_p0, s.score_p1),
         (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', sp.user_id, 'name', sp.display_name, 'seat', sp.seat,
            'fighter', sp.fighter_id, 'connection', sp.connection,
            'ready', sp.ready) order by sp.seat), '[]'::jsonb)
          from public.shadow_players sp where sp.room_id = s.id),
         s.created_at
  from public.shadow_rooms s
  where s.status in ('lobby','countdown','active','round_end','paused')
    and public.admin_can('analytics.read')
  order by 12 desc;
$$;

-- The replay. Shadow keeps a per-keystroke-batch event log (0010), so a
-- finished match can be reconstructed beat by beat rather than summarised.
create or replace function public.admin_match_detail(p_room uuid)
returns jsonb
language sql security definer stable set search_path = ''
as $$
  select case
    when exists (select 1 from public.shadow_rooms where id = p_room) then jsonb_build_object(
      'game', 'shadow',
      'room', (select to_jsonb(x) from (
        select id, pin, status, band, rated, seed, current_round, score_p0, score_p1,
               starts_at, round_starts_at, created_at, updated_at
        from public.shadow_rooms where id = p_room) x),
      'players', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select sp.user_id, sp.seat, sp.display_name, sp.fighter_id, sp.connection,
               sp.joined_at, sp.left_at
        from public.shadow_players sp where sp.room_id = p_room order by sp.seat) x),
      'rounds', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select round, winner_seat, hp_p0, hp_p1, reason, duration_ms, settled_at
        from public.shadow_rounds where room_id = p_room order by round) x),
      'events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select seat, seq, round, card_index, lane, outcome, t_start, t_end,
               keystrokes, errors, round(iki_mean::numeric,1) iki_mean,
               round(iki_stdev::numeric,1) iki_stdev
        from public.shadow_events where room_id = p_room order by round, t_start limit 2000) x),
      'results', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select user_id, seat, outcome, rounds_won, rounds_lost, damage_dealt,
               damage_taken, best_chain, round(wpm::numeric,1) wpm,
               round(accuracy::numeric,2) accuracy, fr_before, fr_after, fr_delta,
               opponent_kind, flags
        from public.shadow_results where room_id = p_room) x)
    )
    else jsonb_build_object(
      'game', 'battle',
      'room', (select to_jsonb(x) from (
        select id, pin, status, difficulty, passage_chars, passage_meta,
               time_limit_sec, starts_at, deadline_at, created_at
        from public.battle_rooms where id = p_room) x),
      'players', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select user_id, display_name, progress_chars, round(wpm::numeric,1) wpm,
               round(accuracy::numeric,2) accuracy, mistakes, status, joined_at
        from public.battle_players where room_id = p_room order by progress_chars desc) x),
      'results', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select user_id, display_name, correct_chars, typed_chars, mistakes,
               round(accuracy::numeric,2) accuracy, round(wpm::numeric,1) wpm, client_wpm
        from public.battle_results where room_id = p_room) x)
    )
  end
  where public.admin_can('analytics.read');
$$;

-- Model scoreboard: usage joined to the health/circuit-breaker state the forge
-- router maintains, plus cost derived from the registry's own rates. A model
-- with no configured rate reports cost NULL and unrated_calls > 0 — it is
-- never silently counted as free.
create or replace function public.admin_model_stats(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
) returns table (
  provider text, model text, label text, enabled boolean, lane text,
  calls bigint, failures bigint, tokens bigint, prompt_tokens bigint,
  output_tokens bigint, p50_ms numeric, p95_ms numeric,
  est_cost numeric, unrated_calls bigint,
  consecutive_fail int, open_until timestamptz, last_reason text
)
language sql security definer stable set search_path = ''
as $$
  select
    u.provider, u.model, m.label, coalesce(m.enabled, true), coalesce(m.lane, 'general'),
    count(*)::bigint, count(*) filter (where not u.ok)::bigint,
    coalesce(sum(coalesce(u.prompt_tokens,0) + coalesce(u.output_tokens,0)), 0)::bigint,
    coalesce(sum(u.prompt_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    round(coalesce(percentile_cont(0.5)  within group (order by u.latency_ms), 0)::numeric),
    round(coalesce(percentile_cont(0.95) within group (order by u.latency_ms), 0)::numeric),
    case when m.input_cost_per_1k is null and m.output_cost_per_1k is null then null
         else round((coalesce(sum(u.prompt_tokens),0) / 1000.0) * coalesce(m.input_cost_per_1k, 0)
                  + (coalesce(sum(u.output_tokens),0) / 1000.0) * coalesce(m.output_cost_per_1k, 0), 4)
    end,
    count(*) filter (where m.input_cost_per_1k is null and m.output_cost_per_1k is null)::bigint,
    coalesce(h.consecutive_fail, 0), h.open_until, h.last_reason
  from public.ai_usage u
  left join public.ai_models m on m.provider_id = u.provider and m.model = u.model
  left join public.forge_model_health h on h.provider = u.provider and h.model = u.model
  where u.created_at between p_from and p_to and public.admin_can('ai.read')
  group by u.provider, u.model, m.label, m.enabled, m.lane,
           m.input_cost_per_1k, m.output_cost_per_1k,
           h.consecutive_fail, h.open_until, h.last_reason
  order by 6 desc;
$$;

-- Gameplay anomaly sweep. Each row is a *signal*, explicitly not a verdict:
-- the console labels them "review", never "cheater". Thresholds are the ones
-- the platform's own physics make implausible, not guesses.
create or replace function public.admin_anomalies(
  p_from timestamptz default now() - interval '7 days',
  p_to   timestamptz default now()
) returns table (
  user_id uuid, display_name text, signal text, detail text,
  severity text, observed numeric, occurred_at timestamptz
)
language sql security definer stable set search_path = ''
as $$
  -- Guard wraps the union, not one branch of it.
  select a.* from (
  -- 1. A typed session above 250 wpm at full accuracy is beyond the record.
  select s.user_id, p.display_name, 'implausible_wpm',
         format('%s wpm at %s%% over %ss', round(s.wpm), round(s.accuracy), round(s.duration_sec)),
         'high', round(s.wpm::numeric, 1), s.ts
  from public.sessions s left join public.profiles p on p.id = s.user_id
  where s.ts between p_from and p_to and s.wpm > 250 and s.accuracy > 99
  union all
  -- 2. Client-claimed WPM diverging from the server's recomputation by >20%.
  select br.user_id, p.display_name, 'wpm_divergence',
         format('client %s vs server %s', round(br.client_wpm), round(br.wpm)),
         'high', round(abs(br.client_wpm - br.wpm)::numeric, 1), brm.created_at
  from public.battle_results br
  join public.battle_rooms brm on brm.id = br.room_id
  left join public.profiles p on p.id = br.user_id
  where brm.created_at between p_from and p_to
    and br.client_wpm is not null and br.wpm > 0
    and abs(br.client_wpm - br.wpm) / br.wpm > 0.2
  union all
  -- 3. Shadow already writes its own flags during settlement; surface them.
  select sr.user_id, p.display_name, 'shadow_flag',
         array_to_string(sr.flags, ', '), 'medium', array_length(sr.flags, 1)::numeric, sr.created_at
  from public.shadow_results sr left join public.profiles p on p.id = sr.user_id
  where sr.created_at between p_from and p_to and array_length(sr.flags, 1) > 0
  union all
  -- 4. Session volume above the configured per-hour ceiling.
  select s.user_id, p.display_name, 'session_flood',
         format('%s sessions in one hour', count(*)), 'medium', count(*)::numeric,
         max(s.ts)
  from public.sessions s left join public.profiles p on p.id = s.user_id
  where s.ts between p_from and p_to
  group by s.user_id, p.display_name, date_trunc('hour', s.ts)
  having count(*) > coalesce(
    (select (value #>> '{}')::int from public.platform_config where key = 'limits.session_rate'), 120)
  ) a (user_id, display_name, signal, detail, severity, observed, occurred_at)
  where public.admin_can('analytics.read')
  order by a.occurred_at desc
  limit 200;
$$;


/* ══ 10. mutations ════════════════════════════════════════════════════════
   Shape shared by every function below:
     1. admin_require(scope)  — raises 42501 if the caller lacks it
     2. capture `before`
     3. apply the change
     4. admin_audit(...)      — same transaction, so no change escapes the log
   A raise anywhere in 1-4 rolls the whole thing back. */

create or replace function public.admin_adjust_xp(
  p_user   uuid,
  p_delta  int,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before int; v_after int;
begin
  perform public.admin_require('users.write');
  if p_delta = 0 then raise exception 'delta must be non-zero'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for a manual XP change';
  end if;

  select xp into v_before from public.profiles where id = p_user for update;
  if not found then raise exception 'no such user'; end if;

  -- XP floors at zero: a negative balance has no meaning anywhere in the
  -- product, and levels are derived from it.
  v_after := greatest(0, v_before + p_delta);

  -- Clamping can absorb the whole adjustment — a -100 against a balance of 0
  -- lands on 0. Without this guard the xp_adjustments insert below would then
  -- violate `check (delta <> 0)` and surface as a constraint error that says
  -- nothing about what actually happened.
  if v_after = v_before then
    raise exception 'that adjustment would not change anything: XP is already %', v_before;
  end if;

  update public.profiles set xp = v_after, updated_at = now() where id = p_user;

  insert into public.xp_adjustments (user_id, delta, reason, actor_id)
  values (p_user, v_after - v_before, p_reason, auth.uid());

  perform public.admin_audit(
    'user.xp_adjust',
    format('XP %s%s (%s to %s)', case when p_delta > 0 then '+' else '' end, p_delta, v_before, v_after),
    'user', p_user::text,
    jsonb_build_object('xp', v_before), jsonb_build_object('xp', v_after), p_reason);

  return jsonb_build_object('before', v_before, 'after', v_after);
end;
$$;

create or replace function public.admin_set_user_status(
  p_user   uuid,
  p_status text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before text;
begin
  if p_status = 'deleted' then
    perform public.admin_require('users.delete');
  else
    perform public.admin_require('users.write');
  end if;
  if p_status not in ('active', 'suspended', 'deleted') then
    raise exception 'unknown status %', p_status;
  end if;
  if p_status <> 'active' and coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to % an account', p_status;
  end if;
  -- An operator cannot lock themselves out; that is an incident, not a task.
  if p_user = auth.uid() and p_status <> 'active' then
    raise exception 'you cannot suspend or delete your own account';
  end if;

  select status into v_before from public.profiles where id = p_user for update;
  if not found then raise exception 'no such user'; end if;

  update public.profiles
     set status = p_status, status_reason = p_reason,
         status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now()
   where id = p_user;

  perform public.admin_audit(
    'user.status_' || p_status,
    format('Account %s → %s', v_before, p_status),
    'user', p_user::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status), p_reason);

  return jsonb_build_object('before', v_before, 'after', p_status);
end;
$$;

-- Role changes are owner-only and self-demotion is blocked, so a project can
-- never end up with zero owners by way of a misclick.
create or replace function public.admin_set_role(
  p_user uuid,
  p_role text,
  p_tier text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('roles.write');
  if p_role not in ('user', 'admin') then raise exception 'unknown role %', p_role; end if;
  if p_tier is not null and p_tier not in ('owner','admin','analyst','support') then
    raise exception 'unknown tier %', p_tier;
  end if;
  if p_user = auth.uid() then
    raise exception 'change another owner''s role, not your own';
  end if;

  select to_jsonb(x) into v_before from (
    select role::text as role, admin_tier from public.user_roles where user_id = p_user
  ) x;

  insert into public.user_roles (user_id, role, admin_tier, granted_by, granted_at, note)
  values (p_user, p_role::public.app_role, p_tier, auth.uid(), now(), p_note)
  on conflict (user_id) do update
    set role = excluded.role, admin_tier = excluded.admin_tier,
        granted_by = excluded.granted_by, granted_at = now(), note = excluded.note;

  perform public.admin_audit(
    'role.set', format('Role → %s%s', p_role, coalesce(' / ' || p_tier, '')),
    'user', p_user::text, v_before,
    jsonb_build_object('role', p_role, 'admin_tier', p_tier), p_note);

  return jsonb_build_object('role', p_role, 'admin_tier', p_tier);
end;
$$;

-- 0002 gave user_roles no write policy at all, deliberately. That stays true:
-- these two functions are SECURITY DEFINER, so the table is still unwritable
-- from a direct PostgREST call by anyone, owner included.
create or replace function public.admin_moderate_generation(
  p_id     uuid,
  p_action text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('content.moderate');
  if p_action not in ('flag', 'unflag', 'unpublish', 'publish', 'delete') then
    raise exception 'unknown action %', p_action;
  end if;
  if p_action in ('flag', 'unpublish', 'delete') and coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to % content', p_action;
  end if;

  select to_jsonb(x) into v_before from (
    select published, flagged, flag_reason from public.forge_generations where id = p_id
  ) x;
  if v_before is null then raise exception 'no such generation'; end if;

  if p_action = 'delete' then
    delete from public.forge_generations where id = p_id;
  else
    update public.forge_generations
       set flagged     = case p_action when 'flag' then true when 'unflag' then false else flagged end,
           flag_reason = case p_action when 'flag' then p_reason when 'unflag' then null else flag_reason end,
           published   = case p_action when 'unpublish' then false when 'publish' then true else published end
     where id = p_id;
  end if;

  perform public.admin_audit(
    'content.' || p_action, format('Generation %s', p_action),
    'generation', p_id::text, v_before,
    (select to_jsonb(x) from (
      select published, flagged, flag_reason from public.forge_generations where id = p_id) x),
    p_reason);

  return jsonb_build_object('action', p_action);
end;
$$;

create or replace function public.admin_set_flag(
  p_key      text,
  p_enabled  boolean,
  p_rollout  int default null,
  p_audience text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('config.write');
  select to_jsonb(x) into v_before from (
    select enabled, rollout, audience from public.feature_flags where key = p_key) x;
  if v_before is null then raise exception 'no such flag %', p_key; end if;

  update public.feature_flags
     set enabled  = p_enabled,
         rollout  = coalesce(p_rollout, rollout),
         audience = coalesce(p_audience, audience),
         updated_by = auth.uid(), updated_at = now()
   where key = p_key;

  perform public.admin_audit(
    'flag.set', format('Flag %s %s', p_key, case when p_enabled then 'on' else 'off' end),
    'flag', p_key, v_before,
    (select to_jsonb(x) from (
      select enabled, rollout, audience from public.feature_flags where key = p_key) x), null);

  return jsonb_build_object('key', p_key, 'enabled', p_enabled);
end;
$$;

create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('config.write');
  select value into v_before from public.platform_config where key = p_key;
  if v_before is null then raise exception 'no such config key %', p_key; end if;

  update public.platform_config
     set value = p_value, updated_by = auth.uid(), updated_at = now()
   where key = p_key;

  perform public.admin_audit(
    'config.set', format('%s: %s → %s', p_key, v_before #>> '{}', p_value #>> '{}'),
    'config', p_key, jsonb_build_object('value', v_before),
    jsonb_build_object('value', p_value), null);

  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;

create or replace function public.admin_upsert_announcement(
  p_id        uuid,
  p_title     text,
  p_body      text,
  p_tone      text default 'info',
  p_audience  text default 'all',
  p_published boolean default false,
  p_starts_at timestamptz default now(),
  p_ends_at   timestamptz default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_before jsonb;
begin
  perform public.admin_require('config.write');
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'an announcement needs a title and a body';
  end if;

  if p_id is null then
    insert into public.announcements (title, body, tone, audience, published, starts_at, ends_at, created_by)
    values (p_title, p_body, p_tone, p_audience, p_published, p_starts_at, p_ends_at, auth.uid())
    returning id into v_id;
  else
    select to_jsonb(x) into v_before from (
      select title, published, tone, audience from public.announcements where id = p_id) x;
    update public.announcements
       set title = p_title, body = p_body, tone = p_tone, audience = p_audience,
           published = p_published, starts_at = p_starts_at, ends_at = p_ends_at,
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'no such announcement'; end if;
  end if;

  perform public.admin_audit(
    case when p_id is null then 'announcement.create' else 'announcement.update' end,
    format('%s "%s"', case when p_published then 'Published' else 'Saved draft' end, p_title),
    'announcement', v_id::text, v_before,
    jsonb_build_object('title', p_title, 'published', p_published), null);

  return v_id;
end;
$$;

create or replace function public.admin_delete_announcement(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_title text;
begin
  perform public.admin_require('config.write');
  delete from public.announcements where id = p_id returning title into v_title;
  if v_title is null then raise exception 'no such announcement'; end if;
  perform public.admin_audit('announcement.delete', format('Deleted "%s"', v_title),
                             'announcement', p_id::text, null, null, null);
end;
$$;

/* ── AI registry writes ───────────────────────────────────────────────────
   Note what is absent: there is no parameter anywhere below that accepts an
   API key. Routing, limits and rates are editable from the console; the secret
   is set with `supabase secrets set` and read only inside an Edge Function,
   which is the one place it can be used without also being transportable. */

create or replace function public.admin_upsert_provider(
  p_id         text,
  p_label      text,
  p_secret_ref text,
  p_base_url   text default null,
  p_enabled    boolean default true,
  p_priority   int default 100,
  p_day_limit  int default null,
  p_notes      text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('ai.write');
  if p_secret_ref !~ '^[A-Z][A-Z0-9_]*$' then
    raise exception 'secret_ref must be an environment variable name, not a key value';
  end if;

  select to_jsonb(x) into v_before from (
    select label, enabled, priority, day_limit, secret_ref
    from public.ai_providers where id = p_id) x;

  insert into public.ai_providers
    (id, label, secret_ref, base_url, enabled, priority, day_limit, notes, updated_by, updated_at)
  values (p_id, p_label, p_secret_ref, p_base_url, p_enabled, p_priority, p_day_limit, p_notes, auth.uid(), now())
  on conflict (id) do update
    set label = excluded.label, secret_ref = excluded.secret_ref, base_url = excluded.base_url,
        enabled = excluded.enabled, priority = excluded.priority,
        day_limit = excluded.day_limit, notes = excluded.notes,
        updated_by = auth.uid(), updated_at = now();

  perform public.admin_audit(
    case when v_before is null then 'ai.provider_create' else 'ai.provider_update' end,
    format('Provider %s %s', p_label, case when p_enabled then 'enabled' else 'disabled' end),
    'provider', p_id, v_before,
    jsonb_build_object('label', p_label, 'enabled', p_enabled, 'priority', p_priority), null);

  return p_id;
end;
$$;

create or replace function public.admin_upsert_model(
  p_id          text,
  p_provider_id text,
  p_model       text,
  p_label       text,
  p_lane        text default 'general',
  p_enabled     boolean default true,
  p_priority    int default 100,
  p_fallback_id text default null,
  p_max_tokens  int default null,
  p_temperature real default null,
  p_top_p       real default null,
  p_input_cost  numeric default null,
  p_output_cost numeric default null,
  p_context     int default null,
  p_notes       text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('ai.write');
  if p_fallback_id = p_id then raise exception 'a model cannot fall back to itself'; end if;

  select to_jsonb(x) into v_before from (
    select label, enabled, lane, priority, fallback_id, input_cost_per_1k, output_cost_per_1k
    from public.ai_models where id = p_id) x;

  insert into public.ai_models
    (id, provider_id, model, label, lane, enabled, priority, fallback_id, max_tokens,
     temperature, top_p, input_cost_per_1k, output_cost_per_1k, context_window, notes,
     updated_by, updated_at)
  values (p_id, p_provider_id, p_model, p_label, p_lane, p_enabled, p_priority, p_fallback_id,
          p_max_tokens, p_temperature, p_top_p, p_input_cost, p_output_cost, p_context, p_notes,
          auth.uid(), now())
  on conflict (id) do update
    set provider_id = excluded.provider_id, model = excluded.model, label = excluded.label,
        lane = excluded.lane, enabled = excluded.enabled, priority = excluded.priority,
        fallback_id = excluded.fallback_id, max_tokens = excluded.max_tokens,
        temperature = excluded.temperature, top_p = excluded.top_p,
        input_cost_per_1k = excluded.input_cost_per_1k,
        output_cost_per_1k = excluded.output_cost_per_1k,
        context_window = excluded.context_window, notes = excluded.notes,
        updated_by = auth.uid(), updated_at = now();

  perform public.admin_audit(
    case when v_before is null then 'ai.model_create' else 'ai.model_update' end,
    format('Model %s %s', p_label, case when p_enabled then 'enabled' else 'disabled' end),
    'model', p_id, v_before,
    jsonb_build_object('label', p_label, 'enabled', p_enabled, 'lane', p_lane,
                       'priority', p_priority, 'fallback_id', p_fallback_id), null);

  return p_id;
end;
$$;

create or replace function public.admin_delete_model(p_id text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb;
begin
  perform public.admin_require('ai.write');
  select to_jsonb(x) into v_before from (
    select label, provider_id, model, lane from public.ai_models where id = p_id) x;
  if v_before is null then raise exception 'no such model'; end if;

  delete from public.ai_models where id = p_id;
  perform public.admin_audit('ai.model_delete', format('Deleted model %s', p_id),
                             'model', p_id, v_before, null, p_reason);
end;
$$;

-- Clears a tripped circuit breaker. The router owns this state (0011); the
-- console can only reset it, never fake a healthy reading into it.
create or replace function public.admin_reset_model_health(p_provider text, p_model text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.admin_require('ai.write');
  update public.forge_model_health
     set consecutive_fail = 0, open_until = null, backoff_ms = 60000,
         last_reason = null, updated_at = now()
   where provider = p_provider and model = p_model;
  perform public.admin_audit('ai.health_reset', format('Reset breaker %s/%s', p_provider, p_model),
                             'model', p_provider || ':' || p_model, null, null, null);
end;
$$;


/* ══ 11. grants ═══════════════════════════════════════════════════════════
   `authenticated` only. `anon` gets nothing here — an unauthenticated caller
   has no business reaching an admin RPC even to be told no. */

do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_scopes()', 'admin_can(text)',
    'admin_kpis(timestamptz,timestamptz)',
    'admin_timeseries(timestamptz,timestamptz)',
    'admin_retention(int)',
    'admin_typing_analytics(timestamptz,timestamptz,text)',
    'admin_coding_analytics(timestamptz,timestamptz)',
    'admin_activity_feed(int)',
    'admin_user_detail(uuid)',
    'admin_live_matches()',
    'admin_match_detail(uuid)',
    'admin_model_stats(timestamptz,timestamptz)',
    'admin_anomalies(timestamptz,timestamptz)',
    'admin_adjust_xp(uuid,int,text)',
    'admin_set_user_status(uuid,text,text)',
    'admin_set_role(uuid,text,text,text)',
    'admin_moderate_generation(uuid,text,text)',
    'admin_set_flag(text,boolean,int,text)',
    'admin_set_config(text,jsonb)',
    'admin_upsert_announcement(uuid,text,text,text,text,boolean,timestamptz,timestamptz)',
    'admin_delete_announcement(uuid)',
    'admin_upsert_provider(text,text,text,text,boolean,int,int,text)',
    'admin_upsert_model(text,text,text,text,text,boolean,int,text,int,real,real,numeric,numeric,int,text)',
    'admin_delete_model(text,text)',
    'admin_reset_model_health(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

/* `admin_can` is the one exception to the anon revoke above, and it has to be.
   The policies added in §8 reference it, and some of those tables are granted
   to `anon` — 0010 grants select on public.shadow_ratings to anon so the public
   leaderboard works signed-out. Postgres evaluates every SELECT policy on a
   table, so an anonymous read would hit `admin_can` and fail with "permission
   denied for function" instead of returning the leaderboard.

   Granting it leaks nothing: for an anonymous caller auth.uid() is null, no
   user_roles row matches, and it returns false. */
grant execute on function public.admin_can(text) to anon;

-- admin_audit / admin_require are internal plumbing for the functions above.
-- Nothing outside this file should be able to write a log line or assert a
-- scope directly, so they are not granted to any client role.
revoke all on function public.admin_audit(text,text,text,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.admin_require(text) from public, anon, authenticated;
