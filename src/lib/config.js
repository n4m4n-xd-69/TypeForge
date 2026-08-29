/**
 * Client configuration.
 *
 * This file used to hold the provider table and, through `VITE_HCNSEC_KEY` and
 * `VITE_OPENROUTER_KEY`, the API keys themselves. Anything `VITE_`-prefixed is
 * inlined into the bundle and readable by anyone who loads the site, and the
 * old version of this file said so in a comment that ended "move to a
 * serverless proxy before this is public in earnest".
 *
 * That move is done. Every provider key now lives in Supabase — as an Edge
 * Function secret, or in Vault — and the browser talks only to
 * `/functions/v1/forge-*`. There is deliberately nothing left here for a key to
 * hide in: the provider table, the model ladders and the timing knobs all moved
 * to `supabase/functions/_shared/`.
 *
 * The model ids that used to live here were also badly out of date. Six of the
 * eight HCNSec ids and two of the four OpenRouter ids had been withdrawn
 * upstream, so most requests were silently failing over to the tail of the
 * ladder. `npm run forge:reconcile` now checks every configured id against the
 * providers' live catalogues, which is the check that found them.
 */

const env = import.meta.env ?? {};

/* ── Supabase ──────────────────────────────────────────────────────────────
   Public by design: anything VITE_-prefixed is inlined into the bundle. Safety
   comes from row-level security (supabase/migrations/0001_init.sql), not from
   this key being secret.

   Both key names are read so the app works before and after a project moves
   from the legacy `anon` key to the newer publishable format. */

export const SUPABASE = {
  url: env.VITE_SUPABASE_URL || '',
  anonKey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '',
};

export const SUPABASE_ENABLED = Boolean(SUPABASE.url && SUPABASE.anonKey);

/**
 * Whether the AI surfaces are switched on.
 *
 * Note what this no longer depends on: the presence of a provider key. The
 * browser cannot see one, and must not be able to infer one. Forge is
 * available exactly when Supabase is, because that is the only door in — and a
 * deploy with no provider keys configured answers `no-key`, which every
 * surface already renders as a fallback rather than an error.
 */
export const AI_ENABLED = env.VITE_AI_ENABLED !== 'false' && SUPABASE_ENABLED;

/**
 * Client-side timing.
 *
 * Failover, hedging and per-model timeouts are the server's business now;
 * these are only about how long the browser waits before giving up on the
 * Edge Function itself.
 */
export const AI_TIMING = {
  /** A streamed answer may legitimately take this long end to end. */
  requestTimeoutMs: 90_000,
  /** Short, non-streaming JSON contract calls. */
  quickTimeoutMs: 40_000,
};
