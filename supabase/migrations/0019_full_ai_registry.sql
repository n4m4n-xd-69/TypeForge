-- The real provider and model registry, and admin-managed API keys.
--
-- 0014 seeded two providers and four models by hand, which described neither
-- the runtime nor reality: supabase/functions/_shared/providers.ts defines
-- FOUR providers and lanes.ts spreads 36 distinct models across
-- 9 lanes. A control centre that lists a subset of what the router
-- actually calls is worse than none, because every conclusion drawn from it is
-- about a system that does not exist.
--
-- This file is generated from those two TypeScript files, so the console starts
-- from exactly what the router knows. From here the tables are authoritative
-- for anything an operator edits -- enable/disable, priority, fallback,
-- parameters, rates -- and rows may be added and removed freely.
--
-- On keys: they are written into Supabase Vault, never into a table a client
-- can read. secrets.ts already resolves in the order environment -> Vault, so
-- a key set here is picked up by the edge functions with no redeploy, and
-- rotating one is an update rather than a deploy. `admin_set_provider_key`
-- writes; nothing reads a value back to any client, ever.

/* == 1. providers: widen to what the runtime actually has ================= */

alter table public.ai_providers
  add column if not exists embed_url       text,
  add column if not exists max_temperature real,
  add column if not exists is_builtin      boolean not null default false;

comment on column public.ai_providers.is_builtin is
  'True for a provider the deployed edge functions know how to talk to. A '
  'custom provider row is configuration only until providers.ts learns it, so '
  'the console labels the difference rather than implying parity.';

insert into public.ai_providers
  (id, label, secret_ref, base_url, embed_url, priority, max_temperature, day_limit, is_builtin)
values
  ('nim', 'NIM', 'FORGE_NVIDIA_KEY', 'https://integrate.api.nvidia.com/v1/chat/completions', 'https://integrate.api.nvidia.com/v1/embeddings', 1, 1, 50, true),
  ('hcnsec', 'HCNSEC', 'FORGE_HCNSEC_KEY', 'https://api.hcnsec.cn/v1/chat/completions', null, 2, 1, 50, true),
  ('kira', 'KIRA', 'FORGE_KIRA_KEY', 'https://kiraai.vn/api/v1/chat/completions', null, 3, null, 50, true),
  ('openrouter', 'OpenRouter', 'FORGE_OPENROUTER_KEY', 'https://openrouter.ai/api/v1/chat/completions', null, 4, null, 50, true)
on conflict (id) do update
  set label           = excluded.label,
      secret_ref      = excluded.secret_ref,
      base_url        = excluded.base_url,
      embed_url       = excluded.embed_url,
      priority        = excluded.priority,
      max_temperature = excluded.max_temperature,
      day_limit       = coalesce(public.ai_providers.day_limit, excluded.day_limit),
      is_builtin      = true;

-- 0014's placeholders named providers that were never real here.
delete from public.ai_models    where provider_id not in (select id from public.ai_providers);

/* == 2. models: the real lane vocabulary ================================== */
-- 0014 invented six lane names before lanes.ts was consulted. The check
-- constraint is replaced rather than extended, because the old values were
-- never valid and keeping them would let a typo pass review.

alter table public.ai_models drop constraint if exists ai_models_lane_check;

-- 0014's four placeholder rows carry lane names that were never real. They are
-- removed rather than remapped: there is nothing to preserve in a row that
-- described a model the router has never called.
delete from public.ai_models where lane not in ('balanced', 'code', 'deep', 'embed', 'feather', 'guard', 'instant', 'long', 'reasoning');
alter table public.ai_models
  add constraint ai_models_lane_check
  check (lane in ('balanced', 'code', 'deep', 'embed', 'feather', 'guard', 'instant', 'long', 'reasoning'));

-- A model usually serves several lanes; `lane` is its primary one and
-- `lanes` is the full set, so the routing view can show every ladder a model
-- appears on without one row per membership.
alter table public.ai_models
  add column if not exists lanes text[] not null default '{}',
  add column if not exists is_builtin boolean not null default false;

insert into public.ai_models
  (id, provider_id, model, label, lane, lanes, priority, max_tokens, temperature, is_builtin)
values
  ('nim:nvidia/nemotron-3-nano-30b-a3b', 'nim', 'nvidia/nemotron-3-nano-30b-a3b', 'nemotron-3-nano-30b-a3b', 'instant', '{instant}', 10, 700, 1, true),
  ('hcnsec:glm-4.5-air', 'hcnsec', 'glm-4.5-air', 'glm-4.5-air', 'instant', '{instant}', 20, 700, 1, true),
  ('nim:nvidia/nemotron-nano-3-30b-a3b', 'nim', 'nvidia/nemotron-nano-3-30b-a3b', 'nemotron-nano-3-30b-a3b', 'instant', '{instant}', 30, 700, 1, true),
  ('kira:kira-mini-1.0', 'kira', 'kira-mini-1.0', 'kira-mini-1.0', 'instant', '{instant}', 40, 700, 1, true),
  ('hcnsec:sensenova-6.8-flash-lite', 'hcnsec', 'sensenova-6.8-flash-lite', 'sensenova-6.8-flash-lite', 'instant', '{instant}', 50, 700, 1, true),
  ('openrouter:liquid/lfm-2.5-2.6b:free', 'openrouter', 'liquid/lfm-2.5-2.6b:free', 'lfm-2.5-2.6b:free', 'instant', '{instant,feather}', 60, 700, 1, true),
  ('nim:nvidia/riva-translate-4b-instruct-v2', 'nim', 'nvidia/riva-translate-4b-instruct-v2', 'riva-translate-4b-instruct-v2', 'feather', '{feather}', 10, 300, 0.7, true),
  ('hcnsec:sensenova-u1.5-lite', 'hcnsec', 'sensenova-u1.5-lite', 'sensenova-u1.5-lite', 'feather', '{feather}', 20, 300, 0.7, true),
  ('kira:hy3', 'kira', 'hy3', 'hy3', 'feather', '{feather}', 30, 300, 0.7, true),
  ('nim:nvidia/nemotron-3-super-120b-a12b', 'nim', 'nvidia/nemotron-3-super-120b-a12b', 'nemotron-3-super-120b-a12b', 'balanced', '{balanced,reasoning}', 10, 1200, 0.6, true),
  ('hcnsec:step-3.7-flash', 'hcnsec', 'step-3.7-flash', 'step-3.7-flash', 'balanced', '{balanced}', 20, 1200, 0.6, true),
  ('nim:google/gemma-4-31b-it', 'nim', 'google/gemma-4-31b-it', 'gemma-4-31b-it', 'balanced', '{balanced}', 30, 1200, 0.6, true),
  ('kira:glm-5.3-flash', 'kira', 'glm-5.3-flash', 'glm-5.3-flash', 'balanced', '{balanced}', 40, 1200, 0.6, true),
  ('hcnsec:MiniMax-M3', 'hcnsec', 'MiniMax-M3', 'MiniMax-M3', 'balanced', '{balanced,long}', 50, 1200, 0.6, true),
  ('openrouter:openrouter/free', 'openrouter', 'openrouter/free', 'free', 'balanced', '{balanced}', 60, 1200, 0.6, true),
  ('nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nim', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nemotron-3-nano-omni-30b-a3b-reasoning', 'reasoning', '{reasoning}', 10, 4000, 0.5, true),
  ('hcnsec:kimi-k3', 'hcnsec', 'kimi-k3', 'kimi-k3', 'reasoning', '{reasoning}', 20, 4000, 0.5, true),
  ('hcnsec:DeepSeek-V4-Pro', 'hcnsec', 'DeepSeek-V4-Pro', 'DeepSeek-V4-Pro', 'reasoning', '{reasoning}', 40, 4000, 0.5, true),
  ('openrouter:z-ai/glm-5.2:free', 'openrouter', 'z-ai/glm-5.2:free', 'glm-5.2:free', 'reasoning', '{reasoning}', 50, 4000, 0.5, true),
  ('nim:nvidia/nemotron-3-ultra-550b-a55b', 'nim', 'nvidia/nemotron-3-ultra-550b-a55b', 'nemotron-3-ultra-550b-a55b', 'deep', '{deep}', 10, 6000, 0.5, true),
  ('nim:moonshotai/kimi-k3', 'nim', 'moonshotai/kimi-k3', 'kimi-k3', 'deep', '{deep}', 20, 6000, 0.5, true),
  ('openrouter:thinkingmachines/inkling:free', 'openrouter', 'thinkingmachines/inkling:free', 'inkling:free', 'deep', '{deep}', 30, 6000, 0.5, true),
  ('openrouter:nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nemotron-3-ultra-550b-a55b:free', 'deep', '{deep}', 40, 6000, 0.5, true),
  ('hcnsec:kat-coder-pro-v2.5', 'hcnsec', 'kat-coder-pro-v2.5', 'kat-coder-pro-v2.5', 'code', '{code}', 10, 2400, 0.3, true),
  ('nim:poolside/laguna-xs-2.1', 'nim', 'poolside/laguna-xs-2.1', 'laguna-xs-2.1', 'code', '{code}', 20, 2400, 0.3, true),
  ('hcnsec:Qwen3.8-27B', 'hcnsec', 'Qwen3.8-27B', 'Qwen3.8-27B', 'code', '{code}', 30, 2400, 0.3, true),
  ('nim:deepseek-ai/deepseek-v4-flash-0731', 'nim', 'deepseek-ai/deepseek-v4-flash-0731', 'deepseek-v4-flash-0731', 'code', '{code}', 40, 2400, 0.3, true),
  ('kira:deepseek-v4-flash-free', 'kira', 'deepseek-v4-flash-free', 'deepseek-v4-flash-free', 'code', '{code}', 50, 2400, 0.3, true),
  ('openrouter:cohere/north-mini-code:free', 'openrouter', 'cohere/north-mini-code:free', 'north-mini-code:free', 'code', '{code}', 60, 2400, 0.3, true),
  ('nim:minimaxai/minimax-m3', 'nim', 'minimaxai/minimax-m3', 'minimax-m3', 'long', '{long}', 10, 8000, 0.4, true),
  ('openrouter:minimax/minimax-m3:free', 'openrouter', 'minimax/minimax-m3:free', 'minimax-m3:free', 'long', '{long}', 30, 8000, 0.4, true),
  ('openrouter:thinkingmachines/inkling-small:free', 'openrouter', 'thinkingmachines/inkling-small:free', 'inkling-small:free', 'long', '{long}', 40, 8000, 0.4, true),
  ('nim:nvidia/nemotron-3.5-content-safety', 'nim', 'nvidia/nemotron-3.5-content-safety', 'nemotron-3.5-content-safety', 'guard', '{guard}', 10, 256, null, true),
  ('nim:meta/llama-guard-4-12b', 'nim', 'meta/llama-guard-4-12b', 'llama-guard-4-12b', 'guard', '{guard}', 20, 256, null, true),
  ('openrouter:nvidia/nemotron-3.5-content-safety:free', 'openrouter', 'nvidia/nemotron-3.5-content-safety:free', 'nemotron-3.5-content-safety:free', 'guard', '{guard}', 30, 256, null, true),
  ('nim:nvidia/nemotron-3-embed-1b', 'nim', 'nvidia/nemotron-3-embed-1b', 'nemotron-3-embed-1b', 'embed', '{embed}', 10, null, null, true)
on conflict (id) do update
  set provider_id = excluded.provider_id,
      model       = excluded.model,
      label       = excluded.label,
      lane        = excluded.lane,
      lanes       = excluded.lanes,
      is_builtin  = true;

/* == 3. key management, via Vault ======================================== */
--
-- The value goes browser -> HTTPS -> this function -> Vault, encrypted at
-- rest. It is never selected back out to any client: the console gets
-- `key_present` and the last four characters, which is enough to answer "is
-- this configured, and is it the key I think it is" and nothing more.
--
-- `FORGE_` prefix is enforced because forge_secrets() filters on it -- a key
-- stored under any other name would be written successfully and then never
-- read, which is the worst of both outcomes.

create or replace function public.admin_set_provider_key(
  p_provider text,
  p_key      text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ref text; v_tail text; v_existing uuid;
begin
  perform public.admin_require('ai.write');

  select secret_ref into v_ref from public.ai_providers where id = p_provider;
  if v_ref is null then raise exception 'no such provider %', p_provider; end if;
  if v_ref !~ '^FORGE_[A-Z0-9_]+$' then
    raise exception 'secret_ref % must start with FORGE_ to be readable by the runtime', v_ref;
  end if;
  if coalesce(length(trim(p_key)), 0) < 8 then
    raise exception 'that does not look like an API key';
  end if;

  select id into v_existing from vault.secrets where name = v_ref;
  if v_existing is null then
    perform vault.create_secret(trim(p_key), v_ref, 'TypeForge provider key, set from the admin console');
  else
    perform vault.update_secret(v_existing, trim(p_key), v_ref, 'TypeForge provider key, rotated from the admin console');
  end if;

  v_tail := right(trim(p_key), 4);

  update public.ai_providers
     set key_present = true, key_tail = v_tail, key_rotated_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_provider;

  -- The key itself is never an audit value. What is recorded is that it
  -- changed, by whom, and which four characters it now ends with.
  perform public.admin_audit(
    'ai.key_set',
    format('Key for %s set (••••%s)', p_provider, v_tail),
    'provider', p_provider, null, jsonb_build_object('key_tail', v_tail), null);

  return jsonb_build_object('provider', p_provider, 'key_tail', v_tail);
end;
$$;

create or replace function public.admin_clear_provider_key(p_provider text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_ref text;
begin
  perform public.admin_require('ai.write');
  select secret_ref into v_ref from public.ai_providers where id = p_provider;
  if v_ref is null then raise exception 'no such provider %', p_provider; end if;

  delete from vault.secrets where name = v_ref;

  update public.ai_providers
     set key_present = false, key_tail = null, key_rotated_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_provider;

  perform public.admin_audit('ai.key_clear', format('Key for %s removed', p_provider),
                             'provider', p_provider, null, null, p_reason);
end;
$$;

create or replace function public.admin_delete_provider(p_id text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_before jsonb; v_models int;
begin
  perform public.admin_require('ai.write');
  select to_jsonb(x) into v_before from (
    select id, label, secret_ref, is_builtin from public.ai_providers where id = p_id) x;
  if v_before is null then raise exception 'no such provider'; end if;

  select count(*) into v_models from public.ai_models where provider_id = p_id;

  -- ai_models cascades, so deleting a provider silently takes its models with
  -- it. Saying how many up front is the difference between a decision and a
  -- surprise.
  delete from public.ai_providers where id = p_id;

  perform public.admin_audit('ai.provider_delete',
    format('Deleted provider %s and %s model(s)', p_id, v_models),
    'provider', p_id, v_before, null, p_reason);
end;
$$;

/* Reflects what the runtime can actually see, so the console can distinguish
   "no key set" from "key set under a name the functions do not read". Returns
   names only -- never values. */
create or replace function public.admin_provider_key_status()
returns table (provider_id text, secret_ref text, in_vault boolean)
language sql security definer stable set search_path = ''
as $$
  select p.id, p.secret_ref, exists (select 1 from vault.secrets s where s.name = p.secret_ref)
  from public.ai_providers p
  where public.admin_can('ai.read');
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_set_provider_key(text,text)',
    'admin_clear_provider_key(text,text)',
    'admin_delete_provider(text,text)',
    'admin_provider_key_status()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

/* Reconcile key_present with Vault on the way in, so a project that set its
   keys before this migration does not show them all as missing. */
update public.ai_providers p
   set key_present = exists (select 1 from vault.secrets s where s.name = p.secret_ref);
