-- Forge AI — shared generation library, semantic retrieval and router state.
--
-- See docs/forge-ai/ARCHITECTURE.md §4 for the reasoning behind every choice
-- here; the load-bearing ones are repeated inline.
--
-- Depends on 0001 (profiles, RLS shape) and 0002 (is_admin, ai_usage).
-- Independent of 0009/0010 — nothing here touches Battlefield or Shadow.

/* ── 0. extensions ────────────────────────────────────────────────────────
   `vector` lives in the `extensions` schema, matching pgcrypto and pg_net.
   Every reference to its types and operator classes below is schema-qualified
   or runs under a search_path that includes it — a SECURITY DEFINER function
   with `set search_path = public` alone cannot resolve `halfvec` or `<=>`.

   pgmq / pg_cron / pg_net are declared here rather than in the Phase 6
   migration so the whole extension surface is established in one place. */
create extension if not exists vector  with schema extensions;
create extension if not exists pg_net  with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;

/* ── 1. the shared library ────────────────────────────────────────────────
   One row per distinct generated body, reusable across every user.

   The six facets (kind, category, level, difficulty, language, topic) are the
   axes the product actually filters on: MODE_REGISTRY supplies category and
   kind, DIFFICULTIES supplies difficulty, LANGUAGES supplies language, and
   gamification supplies level. */
create table if not exists public.forge_generations (
  id              uuid primary key default gen_random_uuid(),

  -- facets
  kind            text not null check (kind in
                    ('passage','snippet','drill','quote','explanation','analysis')),
  category        text not null default 'practice',
  level           int  not null default 0 check (level between 0 and 100),
  difficulty      text not null default 'normal'
                    check (difficulty in ('easy','normal','hard','expert')),
  language        text,                 -- LANGUAGES[].id; null for prose
  topic           text not null default 'general',

  -- payload
  title           text,
  body            text not null check (length(body) > 0),
  meta            jsonb not null default '{}'::jsonb,
  char_count      int generated always as (length(body)) stored,
  word_count      int not null default 0,

  -- identity
  --
  -- content_hash is sha256 over the normalised body: two runs that land on the
  -- same text collapse to one row instead of filling the bucket with
  -- near-duplicates. request_hash is the facets plus the prompt version, and
  -- is what measures how dense a bucket already is.
  content_hash    text not null,
  request_hash    text not null,

  -- retrieval
  --
  -- halfvec, not vector. nvidia/nemotron-3-embed-1b emits exactly 2048
  -- dimensions and rejects any other value, and pgvector can only index
  -- `vector` up to 2000 dimensions versus 4000 for `halfvec`. A vector(2048)
  -- column could not carry an ANN index at all, so every lookup would
  -- sequentially scan the library.
  embedding       extensions.halfvec(2048),
  embedding_model text not null default 'nvidia/nemotron-3-embed-1b',
  embedding_dims  int  not null default 2048,

  -- lifecycle
  published       boolean not null default true,
  flagged         boolean not null default false,
  flag_reason     text,
  quality_score   real not null default 0.5 check (quality_score between 0 and 1),
  serve_count     int  not null default 0,
  completion_count int not null default 0,
  abandon_count   int  not null default 0,

  -- admin-only provenance; the API layer never selects these
  source_provider text,
  source_model    text,
  source_lane     text,

  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.forge_generations is
  'Shared, reusable AI generations. Readable by any signed-in user when '
  'published and unflagged; written only by the service role.';

-- The exact-hit path is this index and nothing else. Sub-10ms.
create unique index if not exists forge_generations_hash_idx
  on public.forge_generations (content_hash);

-- Facet prefilter for the semantic path. Column order is selectivity order.
create index if not exists forge_generations_facet_idx
  on public.forge_generations (kind, difficulty, language, level)
  where published and not flagged;

-- How dense is this bucket already? Drives the decision to skip speculation.
create index if not exists forge_generations_request_idx
  on public.forge_generations (request_hash, created_at desc);

-- ANN. m/ef_construction are pgvector's defaults for this shape; Phase 9
-- sweeps ef_search (a query-time GUC) rather than rebuilding this.
create index if not exists forge_generations_embedding_idx
  on public.forge_generations
  using hnsw (embedding extensions.halfvec_cosine_ops)
  with (m = 16, ef_construction = 64);

/* ── 2. per-user serve ledger ─────────────────────────────────────────────
   What replaces the `avoid: []` prompt hack in generatePassage(): "do not give
   me what I have already typed" stops being a plea to the model and becomes a
   `not exists` clause. */
create table if not exists public.forge_generation_serves (
  generation_id uuid not null references public.forge_generations on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  served_at     timestamptz not null default now(),
  completed     boolean not null default false,
  primary key (generation_id, user_id)
);

create index if not exists forge_serves_user_idx
  on public.forge_generation_serves (user_id, served_at desc);

/* ── 3. router state ──────────────────────────────────────────────────────
   In Postgres rather than instance memory: an Edge Function fleet has many
   isolates, and each one relearning that a model is dead costs three real
   user-visible failures apiece. */
create table if not exists public.forge_model_health (
  provider         text not null,
  model            text not null,
  consecutive_fail int not null default 0,
  open_until       timestamptz,
  backoff_ms       int not null default 60000,
  last_reason      text,
  last_latency_ms  int,
  ok_count         bigint not null default 0,
  fail_count       bigint not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (provider, model)
);

create index if not exists forge_model_health_open_idx
  on public.forge_model_health (open_until)
  where open_until is not null;

-- Per-provider daily counters. OpenRouter's free tier is 20 rpm / 50 rpd, and
-- that ceiling is the reason the library exists at all.
create table if not exists public.forge_budget (
  provider  text not null,
  day       date not null default current_date,
  requests  int not null default 0,
  tokens    bigint not null default 0,
  day_limit int,
  primary key (provider, day)
);

-- Rate-limit counters. One row per request, pruned on a schedule.
create table if not exists public.forge_request_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users on delete cascade,
  ip_hash    text,
  lane       text,
  created_at timestamptz not null default now()
);

create index if not exists forge_request_log_user_idx
  on public.forge_request_log (user_id, created_at desc);
create index if not exists forge_request_log_ip_idx
  on public.forge_request_log (ip_hash, created_at desc);

/* ── 4. telemetry ─────────────────────────────────────────────────────────
   ai_usage is extended, not replaced. The client "insert own" policy from 0002
   deliberately stays for now: it is dropped in the final phase, once the Edge
   Function is provably the only writer. */
alter table public.ai_usage add column if not exists lane          text;
alter table public.ai_usage add column if not exists cache         text;
alter table public.ai_usage add column if not exists request_id    uuid;
alter table public.ai_usage add column if not exists attempt_index int;
alter table public.ai_usage add column if not exists generation_id uuid
  references public.forge_generations on delete set null;

create index if not exists ai_usage_request_idx
  on public.ai_usage (request_id) where request_id is not null;

/* ── 5. matching ──────────────────────────────────────────────────────────
   SECURITY DEFINER so the caller needs no direct table rights and so the
   per-statement HNSW settings can be applied. Same pattern as
   battle_leaderboard() in 0009.

   search_path includes extensions: without it neither `halfvec` nor `<=>`
   resolves inside the function body. */
create or replace function public.forge_match(
  p_embedding    extensions.halfvec(2048),
  p_kind         text,
  p_category     text default null,
  p_difficulty   text default null,
  p_language     text default null,
  p_level        int  default null,
  p_level_span   int  default 3,
  p_min_sim      real default 0.78,
  p_limit        int  default 5,
  p_exclude_user uuid default null
)
returns table (
  id uuid, title text, body text, meta jsonb, topic text,
  similarity real, serve_count int
)
language plpgsql
-- Deliberately VOLATILE (the default), not STABLE: `set local` is rejected
-- inside a non-volatile function with "SET is not allowed in a non-volatile
-- function", and the two GUCs below are what make this an index scan with a
-- narrow facet filter rather than an empty result.
security definer
set search_path = public, extensions
as $$
begin
  -- Recall/latency knob. Phase 9 sweeps this against a seeded library.
  set local hnsw.ef_search = 40;

  -- The facet filter is narrow, and an HNSW scan applies it *after* collecting
  -- ef_search candidates — which can return zero rows from a healthy index.
  -- Iterative scan keeps widening until it has enough. pgvector >= 0.8 only;
  -- this project is on 0.8.2.
  set local hnsw.iterative_scan = 'relaxed_order';

  return query
  select g.id, g.title, g.body, g.meta, g.topic,
         (1 - (g.embedding <=> p_embedding))::real as similarity,
         g.serve_count
  from public.forge_generations g
  where g.published
    and not g.flagged
    and g.embedding is not null
    and g.quality_score >= 0.25
    and g.kind = p_kind
    and (p_category   is null or g.category   = p_category)
    and (p_difficulty is null or g.difficulty = p_difficulty)
    and (p_language   is null or g.language   = p_language)
    and (p_level      is null or g.level between p_level - p_level_span
                                             and p_level + p_level_span)
    -- Novelty: never re-serve to the same person while the bucket still holds
    -- something they have not seen.
    and (p_exclude_user is null or not exists (
          select 1 from public.forge_generation_serves s
          where s.generation_id = g.id and s.user_id = p_exclude_user))
    and (1 - (g.embedding <=> p_embedding)) >= p_min_sim
  -- Orders on the raw distance operator: that is the form the HNSW index can
  -- serve. Ordering on `similarity` instead would force a sequential scan.
  order by g.embedding <=> p_embedding
  limit p_limit;
end;
$$;

-- `revoke ... from public` is NOT enough on Supabase. The platform grants
-- EXECUTE on new public-schema functions to `anon` and `authenticated`
-- directly, not via PUBLIC, so those grants survive a revoke aimed at PUBLIC
-- and the function stays callable over PostgREST at /rest/v1/rpc/forge_match.
-- Both roles must be named explicitly. (Caught by the security advisor as
-- anon_security_definer_function_executable.)
revoke all on function public.forge_match(
  extensions.halfvec, text, text, text, text, int, int, real, int, uuid)
  from public, anon, authenticated;
grant execute on function public.forge_match(
  extensions.halfvec, text, text, text, text, int, int, real, int, uuid) to service_role;

/* ── 6. write helpers ─────────────────────────────────────────────────── */

-- Records that a user was served a row, and bumps the counter. Idempotent:
-- re-serving the same row to the same user is a no-op on the ledger but still
-- correct, so a retry cannot double-count.
create or replace function public.forge_record_serve(
  p_generation uuid,
  p_user       uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.forge_generation_serves (generation_id, user_id)
  values (p_generation, p_user)
  on conflict (generation_id, user_id) do nothing;

  if found then
    update public.forge_generations
       set serve_count = serve_count + 1
     where id = p_generation;
  end if;
end;
$$;

-- Circuit breaker. Called fire-and-forget on the response path.
--
-- 'bad-request' deliberately does NOT open the model: a 400 is our bug, not a
-- condition at the provider, it fails identically on every attempt, and
-- opening the model would hide the real cause. 'auth' opens immediately —
-- a rejected key will not heal itself within a 60s backoff.
create or replace function public.forge_breaker_record(
  p_provider   text,
  p_model      text,
  p_ok         boolean,
  p_reason     text default null,
  p_latency_ms int  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_backoff int;
  v_fails   int;
begin
  insert into public.forge_model_health (provider, model)
  values (p_provider, p_model)
  on conflict (provider, model) do nothing;

  if p_ok then
    update public.forge_model_health
       set consecutive_fail = 0,
           open_until       = null,
           backoff_ms       = 60000,
           ok_count         = ok_count + 1,
           last_reason      = null,
           last_latency_ms  = p_latency_ms,
           updated_at       = now()
     where provider = p_provider and model = p_model;
    return;
  end if;

  if p_reason = 'bad-request' then
    update public.forge_model_health
       set fail_count = fail_count + 1, last_reason = p_reason, updated_at = now()
     where provider = p_provider and model = p_model;
    return;
  end if;

  update public.forge_model_health
     set consecutive_fail = consecutive_fail + 1,
         fail_count       = fail_count + 1,
         last_reason      = p_reason,
         last_latency_ms  = p_latency_ms,
         updated_at       = now()
   where provider = p_provider and model = p_model
  returning consecutive_fail, backoff_ms into v_fails, v_backoff;

  if p_reason = 'auth' then
    update public.forge_model_health
       set open_until = now() + interval '15 minutes', backoff_ms = 900000
     where provider = p_provider and model = p_model;
  elsif v_fails >= 3 then
    update public.forge_model_health
       set open_until = now() + make_interval(secs => v_backoff / 1000.0),
           backoff_ms = least(v_backoff * 2, 900000)
     where provider = p_provider and model = p_model;
  end if;
end;
$$;

-- Increments a provider's daily counter and returns the new value, so the
-- caller can decide in one round trip whether it is still within budget.
create or replace function public.forge_budget_charge(
  p_provider text,
  p_limit    int default null,
  p_tokens   bigint default 0
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_requests int;
begin
  insert into public.forge_budget (provider, day, requests, tokens, day_limit)
  values (p_provider, current_date, 1, p_tokens, p_limit)
  on conflict (provider, day) do update
    set requests  = public.forge_budget.requests + 1,
        tokens    = public.forge_budget.tokens + excluded.tokens,
        day_limit = coalesce(excluded.day_limit, public.forge_budget.day_limit)
  returning requests into v_requests;
  return v_requests;
end;
$$;

-- Same explicit revoke as forge_match above. Without naming anon and
-- authenticated, any holder of the publishable key could call
-- forge_breaker_record to open every model in the router, or spin
-- forge_budget_charge to exhaust the daily counter — a trivial denial of
-- service against the whole AI surface.
revoke all on function public.forge_record_serve(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.forge_breaker_record(text, text, boolean, text, int)
  from public, anon, authenticated;
revoke all on function public.forge_budget_charge(text, int, bigint)
  from public, anon, authenticated;
grant execute on function public.forge_record_serve(uuid, uuid) to service_role;
grant execute on function public.forge_breaker_record(text, text, boolean, text, int) to service_role;
grant execute on function public.forge_budget_charge(text, int, bigint) to service_role;

/* ── 7. embedding queue ───────────────────────────────────────────────────
   Write-back runs out of band. An Edge Function request has a 2s CPU budget;
   embedding inline would spend a network call plus a 2048-float parse inside
   it. The request enqueues an id and returns; a scheduled drain does the work.
   This is Supabase's own documented pgmq + pg_net + pg_cron pattern. */
do $$
begin
  perform pgmq.create('forge_embed');
exception when others then
  null;  -- already exists
end $$;

/* ── 8. RLS ───────────────────────────────────────────────────────────────
   Same shape as 0001: own-rows write, admins read all via is_admin().
   The one departure is forge_generations, readable by every signed-in user —
   that is the entire point of a shared library. Nobody can write it: the
   service role bypasses RLS and is the only writer. */
alter table public.forge_generations       enable row level security;
alter table public.forge_generation_serves enable row level security;
alter table public.forge_model_health      enable row level security;
alter table public.forge_budget            enable row level security;
alter table public.forge_request_log       enable row level security;

drop policy if exists "read published" on public.forge_generations;
create policy "read published" on public.forge_generations
  for select to authenticated
  using (published and not flagged);

drop policy if exists "admins read all" on public.forge_generations;
create policy "admins read all" on public.forge_generations
  for select using (public.is_admin());

drop policy if exists "own serves" on public.forge_generation_serves;
create policy "own serves" on public.forge_generation_serves
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "admins read health" on public.forge_model_health;
create policy "admins read health" on public.forge_model_health
  for select using (public.is_admin());

drop policy if exists "admins read budget" on public.forge_budget;
create policy "admins read budget" on public.forge_budget
  for select using (public.is_admin());

-- forge_request_log gets no policy at all: deny-all for every role except the
-- service role, which bypasses RLS. Nothing in the client needs to read it.

/* ── 9. migration ledger ──────────────────────────────────────────────────
   0002 flagged _schema_migrations as needing RLS. The migrate runner connects
   over the direct Postgres protocol as `postgres` (scripts/migrate-supabase.mjs),
   not through PostgREST, so it bypasses RLS entirely and is unaffected. With
   no policy, `anon` and `authenticated` lose the read/write access they had. */
alter table public._schema_migrations enable row level security;
