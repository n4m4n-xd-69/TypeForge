/**
 * The real ForgeDb, backed by Supabase.
 *
 * Deno-only: `npm:` specifiers do not resolve under the Node-based test
 * runner, which is exactly why the interface lives in db.ts and every module
 * that matters depends on that instead. Nothing here is unit tested; it is
 * covered by the live checks in scripts/forge-verify.mjs.
 *
 * Uses the secret key, so it bypasses RLS. That is deliberate and is what lets
 * `forge_generations` be writable by nobody at all through PostgREST: the
 * service role is the only writer, and it is only reachable from inside a
 * function.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ForgeDb, LibraryRow, SaveRow, UsageRow } from './db.ts';
import { toVectorLiteral } from './embeddings.ts';
import { env } from './env.ts';

/**
 * Supabase injects `SUPABASE_SECRET_KEYS` as a JSON dictionary and keeps the
 * legacy `SUPABASE_SERVICE_ROLE_KEY` alongside it. Reading both means this
 * works before and after a project migrates to the new key format.
 */
function secretKey(): string {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const dict = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const first = Object.values(dict)[0];
    return typeof first === 'string' ? first : '';
  } catch {
    return '';
  }
}

/** The RPCs all return snake_case; the router speaks camelCase. */
function mapRows(data: unknown): LibraryRow[] {
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: (r.title as string | null) ?? null,
    body: String(r.body ?? ''),
    meta: (r.meta as Record<string, unknown>) ?? {},
    topic: String(r.topic ?? 'general'),
    serveCount: Number(r.serve_count ?? 0),
  }));
}

let client: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient | null {
  if (client) return client;
  const url = env('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function createForgeDb(): ForgeDb | null {
  const sb = serviceClient();
  if (!sb) return null;

  return {
    async openModels() {
      const { data, error } = await sb
        .from('forge_model_health')
        .select('provider, model')
        .gt('open_until', new Date().toISOString());
      if (error) throw error;
      return (data ?? []).map((r) => `${r.provider}/${r.model}`);
    },

    async recordHealth(provider, model, ok, reason, latencyMs) {
      const { error } = await sb.rpc('forge_breaker_record', {
        p_provider: provider,
        p_model: model,
        p_ok: ok,
        p_reason: reason ?? null,
        p_latency_ms: latencyMs ?? null,
      });
      if (error) throw error;
    },

    async chargeBudget(provider, limit) {
      const { data, error } = await sb.rpc('forge_budget_charge', {
        p_provider: provider,
        p_limit: limit ?? null,
        p_tokens: 0,
      });
      if (error) throw error;
      return typeof data === 'number' ? data : 0;
    },

    async budgetToday() {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await sb
        .from('forge_budget')
        .select('provider, requests')
        .eq('day', today);
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of data ?? []) out[row.provider] = row.requests;
      return out;
    },

    async recordUsage(row: UsageRow) {
      const { error } = await sb.from('ai_usage').insert({
        user_id: row.userId,
        surface: row.surface,
        lane: row.lane,
        provider: row.provider,
        // HCNSec answers with `model: ""`, so the *requested* id is what gets
        // recorded — an empty string here would make the table useless for
        // exactly the provider most likely to need debugging.
        model: row.model,
        prompt_tokens: row.promptTokens ?? null,
        output_tokens: row.outputTokens ?? null,
        latency_ms: row.latencyMs,
        ok: row.ok,
        reason: row.reason ?? null,
        request_id: row.requestId,
        attempt_index: row.attemptIndex,
        cache: row.cache ?? null,
        generation_id: row.generationId ?? null,
      });
      if (error) throw error;
    },

    async logRequest(userId, lane) {
      const { error } = await sb
        .from('forge_request_log')
        .insert({ user_id: userId, lane });
      if (error) throw error;
    },

    async lookupExact(requestHash, userId) {
      const { data, error } = await sb.rpc('forge_lookup_exact', {
        p_request_hash: requestHash,
        p_user: userId,
        p_limit: 1,
      });
      if (error) throw error;
      return mapRows(data);
    },

    async matchSemantic(embedding, facets, userId, minSimilarity = 0.78) {
      const { data, error } = await sb.rpc('forge_match', {
        // halfvec has no JS binding, so it crosses as a Postgres literal and
        // is cast by the function signature on the way in.
        p_embedding: toVectorLiteral(embedding),
        p_kind: facets.kind,
        p_category: facets.category ?? null,
        p_difficulty: facets.difficulty ?? null,
        p_language: facets.language ?? null,
        p_level: facets.level ?? null,
        p_level_span: 3,
        p_min_sim: minSimilarity,
        p_limit: 5,
        p_exclude_user: userId,
      });
      if (error) throw error;
      return mapRows(data).map((r, i) => ({
        ...r,
        similarity: Number((data as Array<{ similarity: number }>)[i]?.similarity ?? 0),
      }));
    },

    async saveGeneration(row: SaveRow) {
      const { data, error } = await sb.rpc('forge_save_generation', {
        p_kind: row.kind,
        p_category: row.category,
        p_level: row.level,
        p_difficulty: row.difficulty,
        p_language: row.language,
        p_topic: row.topic,
        p_title: row.title,
        p_body: row.body,
        p_meta: row.meta ?? {},
        p_word_count: row.wordCount,
        p_content_hash: row.contentHash,
        p_request_hash: row.requestHash,
        p_provider: row.provider ?? null,
        p_model: row.model ?? null,
        p_lane: row.lane ?? null,
        p_created_by: row.createdBy ?? null,
      });
      if (error) throw error;
      return typeof data === 'string' ? data : null;
    },

    async recordServe(generationId, userId) {
      const { error } = await sb.rpc('forge_record_serve', {
        p_generation: generationId,
        p_user: userId,
      });
      if (error) throw error;
    },

    async enqueueEmbed(generationId) {
      const { error } = await sb.rpc('forge_enqueue_embed', {
        p_generation: generationId,
      });
      if (error) throw error;
    },

    async loadSecrets() {
      // forge_secrets() is SECURITY DEFINER and filtered to FORGE_* names, so
      // it can only ever return keys Forge itself put in the Vault — never the
      // project's own internal secrets.
      const { data, error } = await sb.rpc('forge_secrets');
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const row of (data ?? []) as Array<{ name: string; value: string }>) {
        if (row?.name && typeof row.value === 'string') out[row.name] = row.value;
      }
      return out;
    },
  };
}
