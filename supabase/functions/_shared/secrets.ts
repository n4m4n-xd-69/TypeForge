/**
 * Where provider keys come from.
 *
 * Two sources, checked in this order:
 *
 *   1. The function's environment (`supabase secrets set`). The standard
 *      mechanism, and the one RESOURCES.md documents.
 *   2. Supabase Vault, read once per isolate through `public.forge_secrets()`.
 *
 * Environment wins, deliberately. That makes the Vault path a fallback rather
 * than a fork: a project can start on Vault — which needs nothing but SQL
 * access to set up — and later move to environment secrets by pushing them and
 * redeploying, with no code change and no window where both are live and
 * disagreeing.
 *
 * Vault earns its place beyond bootstrapping too: rotating a key becomes an
 * `update_secret` call rather than a redeploy, and the value is encrypted at
 * rest rather than sitting in a deploy-time config.
 *
 * Neither source is ever reachable from a browser. `forge_secrets()` is
 * SECURITY DEFINER, revoked from anon and authenticated, and filtered to names
 * beginning `FORGE_` so it can never return the project's own internals.
 *
 * The cache is module-scope, which on Fluid/Edge isolates means one read per
 * cold start rather than one per request — the 2s CPU budget has no room for a
 * database round trip in front of every attempt.
 */
import { env } from './env.ts';

let vault: Record<string, string> = {};
let primed = false;
let inflight: Promise<void> | null = null;

/** Test seam. */
export function resetSecrets(): void {
  vault = {};
  primed = false;
  inflight = null;
}

/**
 * Reads one secret. Synchronous by design — `providers.ts` needs it inside
 * `headersFor()`, which sits on the hot path and cannot await.
 */
export function secret(name: string): string {
  const fromEnv = env(name);
  if (fromEnv) return fromEnv;
  return vault[name] ?? '';
}

/**
 * Loads the Vault values once per isolate.
 *
 * Concurrent callers share one load. A failure is cached as "no Vault
 * secrets" rather than retried per request: if the environment already has the
 * keys this changes nothing, and if it does not, the request fails with
 * `no-key`, which is the honest answer and one the client already renders.
 */
export async function primeSecrets(
  loader: () => Promise<Record<string, string>>,
): Promise<void> {
  if (primed) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      vault = await loader();
    } catch {
      vault = {};
    } finally {
      primed = true;
      inflight = null;
    }
  })();

  return inflight;
}

/** Which FORGE_ names resolved, for a health endpoint. Never the values. */
export function secretNames(): string[] {
  const names = new Set(Object.keys(vault));
  for (const n of [
    'FORGE_NVIDIA_KEY', 'FORGE_HCNSEC_KEY', 'FORGE_OPENROUTER_KEY',
    'FORGE_KIRA_KEY', 'FORGE_SITE_URL',
  ]) {
    if (env(n)) names.add(n);
  }
  return [...names].filter((n) => secret(n) !== '').sort();
}
