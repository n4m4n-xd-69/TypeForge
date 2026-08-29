/**
 * The four AI providers, server-side only.
 *
 * Every key is resolved at call time, never at module load: a test that
 * overrides the environment must be able to change which providers exist
 * without re-importing this file. `secret()` checks the function environment
 * first and Supabase Vault second — see secrets.ts for why both.
 *
 * A provider with no key is not "disabled" — it is absent. `activeProviders()`
 * is the only way in, and it filters on the key, so a deploy with three keys
 * behaves exactly like a build that never knew about the fourth.
 *
 * Model ladders live in lanes.ts, not here. This file knows how to *talk* to a
 * provider; lanes.ts knows which models are worth talking to for a given job.
 */
import { secret } from './secrets.ts';

export type ProviderId = 'nim' | 'hcnsec' | 'kira' | 'openrouter';

export interface Provider {
  id: ProviderId;
  label: string;
  /** Chat-completions URL. All four speak the OpenAI shape. */
  endpoint: string;
  /** Embeddings URL, where the provider has one. */
  embedEndpoint?: string;
  /** Secret name holding the key, in the environment or in Vault. */
  keyName: string;
  /** Lower wins. Ordering interleaves providers across a lane's ladder. */
  priority: number;
  /**
   * Provider ceiling on `temperature`. Anything above is rejected outright:
   * HCNSec answers `'temperature' value must be less or equal than 1` with a
   * 400, which failover cannot rescue because it fails identically every time.
   */
  maxTemperature?: number;
  /**
   * Some providers echo an empty `model` in the response body (HCNSec does).
   * When false, usage logging records the *requested* id instead.
   */
  trustResponseModel: boolean;
  /** Hard daily request ceiling, where the provider publishes one. */
  dailyLimit?: number;
  /** Extra headers, evaluated per request so env changes are picked up. */
  extraHeaders?: () => Record<string, string>;
  /**
   * Body fields that turn the model's chain of thought on or off.
   *
   * This is not cosmetic. Left to their defaults, several models emit their
   * reasoning into `content` rather than `reasoning_content`, so a chat answer
   * begins "We need to respond per instruction:" — verified against the
   * deployed function. Suppressing it is what makes non-thinking lanes read
   * like answers instead of transcripts.
   *
   * The mechanism is per-provider because the obvious cross-provider field
   * does not work: `reasoning_effort: "none"` returned **500 from every NIM
   * model tested** (gemma-4-31b-it, riva-translate, nemotron-3-nano), while
   * `chat_template_kwargs: {thinking: false}` returned 200 from all of them.
   */
  thinkingBody?: (wantThinking: boolean, effort?: string) => Record<string, unknown>;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  /**
   * Fastest measured of the four: nemotron-3-nano-30b-a3b returned in 0.58s
   * against a short prompt. Also the only provider here that exposes an
   * embedding model, which makes it load-bearing for retrieval as well.
   */
  nim: {
    id: 'nim',
    label: 'nim',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    embedEndpoint: 'https://integrate.api.nvidia.com/v1/embeddings',
    keyName: 'FORGE_NVIDIA_KEY',
    priority: 1,
    maxTemperature: 1,
    trustResponseModel: true,
    // NIM reasons by default, so a thinking lane sends nothing extra. Turning
    // it off uses the chat template rather than `reasoning_effort`, which 500s.
    thinkingBody: (want) => (want ? {} : { chat_template_kwargs: { thinking: false } }),
  },

  hcnsec: {
    id: 'hcnsec',
    label: 'hcnsec',
    endpoint: 'https://api.hcnsec.cn/v1/chat/completions',
    keyName: 'FORGE_HCNSEC_KEY',
    priority: 2,
    maxTemperature: 1,
    // Returns `"model": ""` on every completion.
    trustResponseModel: false,
  },

  kira: {
    id: 'kira',
    label: 'kira',
    endpoint: 'https://kiraai.vn/api/v1/chat/completions',
    keyName: 'FORGE_KIRA_KEY',
    priority: 3,
    trustResponseModel: true,
  },

  /**
   * Last, deliberately. The free tier is 20 requests/minute and 50/day — about
   * one user's practice session. Leading with it would exhaust the shared
   * allowance before lunch, so it is a backstop, and the generation library is
   * what actually carries the load.
   */
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyName: 'FORGE_OPENROUTER_KEY',
    priority: 4,
    dailyLimit: 50,
    trustResponseModel: true,
    extraHeaders: () => ({
      'HTTP-Referer': secret('FORGE_SITE_URL') || 'https://typeforge.app',
      'X-Title': 'TypeForge',
    }),
    // `reasoning.enabled: false` verified against nemotron-3-super:free.
    // `exclude: true` would only hide the trace while still paying for it.
    // A model with `reasoning.mandatory` rejects being switched off entirely,
    // which surfaces as a normal failover rather than anything special.
    thinkingBody: (want, effort) => (want
      ? { reasoning: { effort: effort ?? 'medium' } }
      : { reasoning: { enabled: false } }),
  },
};

export function apiKey(id: ProviderId): string {
  return secret(PROVIDERS[id].keyName);
}

/** Providers that actually have a key, in priority order. */
export function activeProviders(): Provider[] {
  return Object.values(PROVIDERS)
    .filter((p) => apiKey(p.id) !== '')
    .sort((a, b) => a.priority - b.priority);
}

export function isActive(id: ProviderId): boolean {
  return apiKey(id) !== '';
}

/** Auth and attribution headers for one request. */
export function headersFor(id: ProviderId): Record<string, string> {
  const p = PROVIDERS[id];
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey(id)}`,
    ...(p.extraHeaders?.() ?? {}),
  };
}

/** Never leaves the server. Admin telemetry only. */
export function providerSummary(): Array<{ id: ProviderId; label: string }> {
  return activeProviders().map((p) => ({ id: p.id, label: p.label }));
}
