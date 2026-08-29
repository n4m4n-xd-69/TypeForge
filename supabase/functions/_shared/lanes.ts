/**
 * Lanes: one routing ladder per job.
 *
 * The old client-side runner had a single global model list for six different
 * jobs, so a 60-word Zen passage and a 2200-token code analysis went down the
 * same ladder in the same order. A lane is that list, scoped to a job, with
 * its own timeout and token budget.
 *
 * Every model id below was confirmed present in a live `/v1/models` response
 * on 2026-08-28. `scripts/forge-reconcile.mjs` re-checks them; six HCNSec ids
 * died within about three weeks, so this is not a one-time exercise.
 *
 * Ladders interleave providers on purpose: the hedged runner starts attempt
 * N+1 before attempt N has failed, so a backup provider wants an early slot
 * rather than a place at the bottom.
 */
import type { ProviderId } from './providers.ts';

export type LaneId =
  | 'instant' | 'feather' | 'balanced' | 'reasoning'
  | 'deep' | 'code' | 'long' | 'guard' | 'embed';

/** `[provider, model]`. */
export type Rung = readonly [ProviderId, string];

export interface Lane {
  id: LaneId;
  /** The name a user sees. `null` means the lane is never user-selectable. */
  label: string | null;
  /** One-line description for the picker. */
  blurb?: string;
  /** Picker group. */
  group?: 'fast' | 'everyday' | 'thinking' | 'code' | 'long';
  timeoutMs: number;
  hedgeMs: number;
  maxTokens: number;
  temperature: number;
  /** Passed through where the model supports it; ignored elsewhere. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Whether this lane's models stream a chain of thought worth showing. */
  showsThinking?: boolean;
  ladder: readonly Rung[];
}

export const LANES: Record<LaneId, Lane> = {
  instant: {
    id: 'instant',
    label: 'Forge Instant',
    blurb: 'Drills, passages and quick answers.',
    group: 'fast',
    timeoutMs: 6_000, hedgeMs: 1_200, maxTokens: 700, temperature: 1,
    ladder: [
      ['nim', 'nvidia/nemotron-3-nano-30b-a3b'],
      ['hcnsec', 'glm-4.5-air'],
      ['nim', 'nvidia/nemotron-nano-3-30b-a3b'],
      ['kira', 'kira-mini-1.0'],
      ['hcnsec', 'sensenova-6.8-flash-lite'],
      ['openrouter', 'liquid/lfm-2.5-2.6b:free'],
    ],
  },

  feather: {
    id: 'feather',
    label: 'Forge Feather',
    blurb: 'The smallest model, for one-line replies.',
    group: 'fast',
    timeoutMs: 4_000, hedgeMs: 900, maxTokens: 300, temperature: 0.7,
    ladder: [
      ['nim', 'nvidia/riva-translate-4b-instruct-v2'],
      ['hcnsec', 'sensenova-u1.5-lite'],
      ['kira', 'hy3'],
      ['openrouter', 'liquid/lfm-2.5-2.6b:free'],
    ],
  },

  balanced: {
    id: 'balanced',
    label: 'Forge Balanced',
    blurb: 'The everyday default.',
    group: 'everyday',
    timeoutMs: 20_000, hedgeMs: 4_000, maxTokens: 1_200, temperature: 0.6,
    ladder: [
      ['nim', 'nvidia/nemotron-3-super-120b-a12b'],
      ['hcnsec', 'step-3.7-flash'],
      ['nim', 'google/gemma-4-31b-it'],
      ['kira', 'glm-5.3-flash'],
      ['hcnsec', 'MiniMax-M3'],
      ['openrouter', 'openrouter/free'],
    ],
  },

  reasoning: {
    id: 'reasoning',
    label: 'Forge Reason',
    blurb: 'Shows its working.',
    group: 'thinking',
    timeoutMs: 45_000, hedgeMs: 8_000, maxTokens: 4_000, temperature: 0.5,
    reasoningEffort: 'medium',
    showsThinking: true,
    ladder: [
      ['nim', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'],
      ['hcnsec', 'kimi-k3'],
      ['nim', 'nvidia/nemotron-3-super-120b-a12b'],
      ['hcnsec', 'DeepSeek-V4-Pro'],
      ['openrouter', 'z-ai/glm-5.2:free'],
    ],
  },

  deep: {
    id: 'deep',
    label: 'Forge Deep',
    blurb: 'Long chains of thought. Slowest.',
    group: 'thinking',
    timeoutMs: 60_000, hedgeMs: 12_000, maxTokens: 6_000, temperature: 0.5,
    reasoningEffort: 'high',
    showsThinking: true,
    ladder: [
      ['nim', 'nvidia/nemotron-3-ultra-550b-a55b'],
      ['nim', 'moonshotai/kimi-k3'],
      ['openrouter', 'thinkingmachines/inkling:free'],
      ['openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'],
    ],
  },

  code: {
    id: 'code',
    label: 'Forge Code',
    blurb: 'Snippets, analysis and refactors.',
    group: 'code',
    timeoutMs: 32_000, hedgeMs: 6_000, maxTokens: 2_400, temperature: 0.3,
    ladder: [
      ['hcnsec', 'kat-coder-pro-v2.5'],
      ['nim', 'poolside/laguna-xs-2.1'],
      ['hcnsec', 'Qwen3.8-27B'],
      ['nim', 'deepseek-ai/deepseek-v4-flash-0731'],
      ['kira', 'deepseek-v4-flash-free'],
      ['openrouter', 'cohere/north-mini-code:free'],
    ],
  },

  long: {
    id: 'long',
    label: 'Forge Ledger',
    blurb: 'Whole files and long transcripts.',
    group: 'long',
    timeoutMs: 60_000, hedgeMs: 12_000, maxTokens: 8_000, temperature: 0.4,
    ladder: [
      ['nim', 'minimaxai/minimax-m3'],
      ['hcnsec', 'MiniMax-M3'],
      ['openrouter', 'minimax/minimax-m3:free'],
      ['openrouter', 'thinkingmachines/inkling-small:free'],
    ],
  },

  /** Moderation. Never user-selectable. */
  guard: {
    id: 'guard',
    label: null,
    timeoutMs: 3_000, hedgeMs: 800, maxTokens: 256, temperature: 0,
    ladder: [
      ['nim', 'nvidia/nemotron-3.5-content-safety'],
      ['nim', 'meta/llama-guard-4-12b'],
      ['openrouter', 'nvidia/nemotron-3.5-content-safety:free'],
    ],
  },

  /**
   * Embeddings. NIM only — it is the sole provider here with an embedding
   * model, and nemotron-3-embed-1b emits exactly 2048 dimensions and rejects
   * any other `dimensions` value. That number is why the library column is
   * `halfvec(2048)`: pgvector indexes `vector` only to 2000 dimensions.
   */
  embed: {
    id: 'embed',
    label: null,
    timeoutMs: 5_000, hedgeMs: 2_000, maxTokens: 0, temperature: 0,
    ladder: [['nim', 'nvidia/nemotron-3-embed-1b']],
  },
};

export const EMBED_MODEL = 'nvidia/nemotron-3-embed-1b';
export const EMBED_DIMS = 2048;

/**
 * Deliberately excluded from every ladder:
 * `nvidia/nemotron-3.5-lightning-30b-a3b`. The name suggests a lane lead, but
 * it hung past 60s on NIM and returned `400 DEGRADED function cannot be
 * invoked` through OpenRouter. It goes back in when a health probe passes.
 */
export const QUARANTINED: readonly string[] = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-lightning:free',
];

/** Lanes the UI may offer, in picker order. Vendor ids never appear here. */
export const PUBLIC_LANES: readonly LaneId[] = [
  'instant', 'feather', 'balanced', 'reasoning', 'deep', 'code', 'long',
];

export function isPublicLane(id: string): id is LaneId {
  return (PUBLIC_LANES as readonly string[]).includes(id);
}

/**
 * Resolves an UNTRUSTED lane name — anything arriving off the wire.
 *
 * Restricted to public lanes on purpose: a client must not be able to select
 * `guard` or `embed`, whose prompts and token budgets make no sense for a
 * conversation. Anything unrecognised becomes balanced.
 */
export function resolveLane(id: string | undefined | null): Lane {
  return isPublicLane(id ?? '') ? LANES[id as LaneId] : LANES.balanced;
}

/**
 * Resolves a TRUSTED lane id — one this codebase chose, not one a caller sent.
 *
 * Separate from `resolveLane` because that one rejects `guard` and `embed`,
 * and routing an internal call through it silently ran moderation on the
 * balanced ladder: the live smoke test reported the `guard` lane answering
 * from a general chat model, which is a moderation bypass rather than a
 * cosmetic mis-route.
 */
export function laneById(id: LaneId): Lane {
  return LANES[id];
}

export function isLaneId(id: string): id is LaneId {
  return Object.prototype.hasOwnProperty.call(LANES, id);
}

/**
 * The picker payload. Labels and blurbs only — no provider, no model, no
 * count of either, because a model count is itself a hint about what is
 * underneath.
 */
export function publicCatalogue() {
  return PUBLIC_LANES.map((id) => {
    const lane = LANES[id];
    return {
      id: lane.id,
      label: lane.label,
      blurb: lane.blurb,
      group: lane.group,
      showsThinking: Boolean(lane.showsThinking),
    };
  });
}
