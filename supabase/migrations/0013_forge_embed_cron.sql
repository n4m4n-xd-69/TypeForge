-- Forge AI — scheduled embedding drain.
--
-- Embedding cannot happen inside a generation request. An Edge Function gets 2s
-- of real CPU; an embedding round trip plus parsing a 2048-float array would
-- spend much of it on work nobody is waiting for. So the request enqueues an id
-- and returns, and this drains the queue out of band — Supabase's documented
-- pgmq + pg_net + pg_cron pattern.
--
-- Two things this deliberately does NOT do:
--
--   * It does not hardcode a URL or a key. Both come from Vault, so this file
--     is safe to commit and a branch/preview project can point at itself by
--     setting its own two secrets.
--
--   * It does not call the function on an empty queue. Queue depth is a local
--     count costing microseconds; an HTTP call is a billed invocation. Checking
--     first turns ~43k monthly invocations into roughly one per generation.

-- ── The tick ────────────────────────────────────────────────────────────────

create or replace function public.forge_drain_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, pgmq, vault
as $$
declare
  v_depth   bigint;
  v_url     text;
  v_secret  text;
begin
  select count(*) into v_depth from pgmq.q_forge_embed;
  if v_depth = 0 then
    return;                       -- nothing queued; do not spend an invocation
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'forge_functions_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'forge_cron_secret';

  if v_url is null or v_secret is null then
    -- Unconfigured project (a fresh branch, say). Staying quiet is right: the
    -- queue is durable, so work resumes the moment the secrets exist.
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/forge-embed-drain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Scoped to this one endpoint on purpose. pg_net persists request headers
      -- in net.http_request_queue, so whatever goes here ends up stored in a
      -- table; a secret that only opens the drain is a much smaller thing to
      -- leave in one than the service_role key.
      'apikey', v_secret
    ),
    body    := '{}'::jsonb,
    -- Comfortably longer than a full batch of 16 embeddings, and shorter than
    -- the queue's 60s visibility timeout so a stalled call cannot overlap with
    -- the retry that replaces it.
    timeout_milliseconds := 50000
  );
end;
$$;

comment on function public.forge_drain_tick() is
  'pg_cron entry point: posts to forge-embed-drain only when the embed queue is non-empty.';

-- Same rule as every other forge_* definer function: Supabase grants EXECUTE to
-- anon and authenticated by default, and `from public` does not take that back.
revoke all on function public.forge_drain_tick() from public, anon, authenticated;

-- ── The schedule ────────────────────────────────────────────────────────────

-- cron.schedule replaces a job of the same name, so re-running this is safe.
select cron.schedule(
  'forge-embed-drain',
  '30 seconds',
  $cron$ select public.forge_drain_tick(); $cron$
);
