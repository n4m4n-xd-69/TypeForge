-- Forge AI — the library read path and write-back.
--
-- 0011 created the tables, the HNSW index and the semantic matcher. This adds
-- the two things the orchestrator needs on top: a cheap exact lookup, and an
-- insert that is safe to call from many isolates at once.
--
-- ── A correction to ARCHITECTURE.md §3.1 ─────────────────────────────────
-- That section describes the exact-hit stage as `content_hash` equality, and
-- §7.2 defines `content_hash` as sha256 of the *body*. Both cannot be true:
-- at lookup time there is no body yet, so nothing can be hashed to match on.
--
-- The exact stage therefore keys on `request_hash` — sha256 of the canonical
-- facets plus the prompt version, which IS known before generating. That is
-- deliberately not unique: many generations share a request_hash, and the
-- bucket they form is what makes novelty free. `content_hash` keeps its real
-- job, which is collapsing two runs that produced identical text on write.

/* ── exact lookup ─────────────────────────────────────────────────────────
   One btree probe on (request_hash, created_at desc), plus a NOT EXISTS
   against this user's serve ledger. Sub-10ms and no vector work at all — the
   overwhelming majority of repeat requests should end here.

   Ordering is by quality first, then by how rarely a row has been served, so
   the library spreads load across its bucket instead of showing everyone the
   same paragraph until it goes stale. */
create or replace function public.forge_lookup_exact(
  p_request_hash text,
  p_user         uuid default null,
  p_limit        int  default 1
)
returns table (
  id uuid, title text, body text, meta jsonb, topic text, serve_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.title, g.body, g.meta, g.topic, g.serve_count
  from public.forge_generations g
  where g.request_hash = p_request_hash
    and g.published
    and not g.flagged
    and g.quality_score >= 0.25
    and (p_user is null or not exists (
          select 1 from public.forge_generation_serves s
          where s.generation_id = g.id and s.user_id = p_user))
  order by g.quality_score desc, g.serve_count asc, g.created_at desc
  limit p_limit;
$$;

/* ── write-back ───────────────────────────────────────────────────────────
   Returns the row id whether it inserted or collided. Eight Battlefield
   clients racing the same request must not fill the bucket with eight copies
   of one paragraph, and the caller still needs an id to record the serve
   against — so a collision returns the existing row rather than nothing.

   `on conflict do nothing` cannot return the existing id, hence the explicit
   re-select. */
create or replace function public.forge_save_generation(
  p_kind         text,
  p_category     text,
  p_level        int,
  p_difficulty   text,
  p_language     text,
  p_topic        text,
  p_title        text,
  p_body         text,
  p_meta         jsonb,
  p_word_count   int,
  p_content_hash text,
  p_request_hash text,
  p_provider     text default null,
  p_model        text default null,
  p_lane         text default null,
  p_created_by   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.forge_generations (
    kind, category, level, difficulty, language, topic,
    title, body, meta, word_count, content_hash, request_hash,
    source_provider, source_model, source_lane, created_by
  ) values (
    p_kind, p_category, p_level, p_difficulty, p_language, p_topic,
    p_title, p_body, coalesce(p_meta, '{}'::jsonb), p_word_count,
    p_content_hash, p_request_hash,
    p_provider, p_model, p_lane, p_created_by
  )
  on conflict (content_hash) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.forge_generations
    where content_hash = p_content_hash;
  end if;

  return v_id;
end;
$$;

/* ── embedding queue ──────────────────────────────────────────────────────
   Enqueue and drain wrappers, so an Edge Function never needs rights on the
   pgmq schema itself. Embedding runs out of band because a request has 2s of
   CPU and an embedding call plus a 2048-float parse would spend it. */
create or replace function public.forge_enqueue_embed(p_generation uuid)
returns bigint
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.send('forge_embed', jsonb_build_object('id', p_generation));
$$;

create or replace function public.forge_read_embed_queue(
  p_limit int default 16,
  p_vt    int default 60
)
returns table (msg_id bigint, generation_id uuid, body text, kind text,
               language text, topic text, difficulty text)
language sql
security definer
set search_path = public, pgmq
as $$
  select q.msg_id,
         g.id, g.body, g.kind, g.language, g.topic, g.difficulty
  from pgmq.read('forge_embed', p_vt, p_limit) q
  join public.forge_generations g
    on g.id = (q.message ->> 'id')::uuid
  where g.embedding is null;
$$;

create or replace function public.forge_store_embedding(
  p_generation uuid,
  p_msg_id     bigint,
  p_embedding  extensions.halfvec(2048)
) returns void
language plpgsql
security definer
set search_path = public, pgmq, extensions
as $$
begin
  update public.forge_generations
     set embedding = p_embedding
   where id = p_generation;
  perform pgmq.archive('forge_embed', p_msg_id);
end;
$$;

/* Drops a message whose row has vanished or can never be embedded, so a
   poison message cannot block the queue forever. */
create or replace function public.forge_drop_embed_message(p_msg_id bigint)
returns void
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('forge_embed', p_msg_id);
$$;

/* ── quality feedback ─────────────────────────────────────────────────────
   The typing engine already knows whether a session finished. A passage that
   is abandoned most of the time earns a lower score, and forge_match() and
   forge_lookup_exact() both exclude anything below 0.25 — so the library gets
   better the more it is typed, with no curation step. */
create or replace function public.forge_record_outcome(
  p_generation uuid,
  p_user       uuid,
  p_completed  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.forge_generation_serves
     set completed = p_completed
   where generation_id = p_generation and user_id = p_user;

  if p_completed then
    update public.forge_generations
       set completion_count = completion_count + 1
     where id = p_generation;
  else
    update public.forge_generations
       set abandon_count = abandon_count + 1
     where id = p_generation;
  end if;

  -- Only judge a row once it has a real sample behind it.
  update public.forge_generations
     set quality_score = greatest(0, least(1,
           completion_count::real / nullif(completion_count + abandon_count, 0)))
   where id = p_generation
     and completion_count + abandon_count >= 10;
end;
$$;

/* ── privileges ───────────────────────────────────────────────────────────
   Same explicit revoke as 0011: Supabase grants EXECUTE on new public-schema
   functions to anon and authenticated directly, so a revoke aimed at PUBLIC
   leaves them callable over PostgREST. These return library content and
   mutate quality scores, so both roles must be named. */
do $$
declare fn text;
begin
  foreach fn in array array[
    'forge_lookup_exact(text, uuid, int)',
    'forge_save_generation(text, text, int, text, text, text, text, text, jsonb, int, text, text, text, text, text, uuid)',
    'forge_enqueue_embed(uuid)',
    'forge_read_embed_queue(int, int)',
    'forge_store_embedding(uuid, bigint, extensions.halfvec)',
    'forge_drop_embed_message(bigint)',
    'forge_record_outcome(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
