/**
 * Runtime-agnostic environment access.
 *
 * These modules run under Deno in production (Supabase Edge Functions) and
 * under Node in the test suite. `Deno.env.get` does not exist in Node and
 * `process.env` does not exist in Deno, so every read goes through here rather
 * than through a global that only resolves in one of them.
 *
 * Keeping this in one file is also what lets the router be unit-tested at all:
 * a test can call `setEnvOverride()` to stand up a fake provider without
 * touching the real process environment.
 */

declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

let overrides: Record<string, string | undefined> | null = null;

/** Test seam. Pass `null` to restore the real environment. */
export function setEnvOverride(next: Record<string, string | undefined> | null): void {
  overrides = next;
}

export function env(key: string): string {
  if (overrides) return overrides[key] ?? '';
  try {
    if (typeof Deno !== 'undefined' && Deno?.env) return Deno.env.get(key) ?? '';
  } catch {
    /* Deno throws without --allow-env; fall through to process. */
  }
  // eslint-disable-next-line no-undef
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key] ?? '';
}

/** `true` unless explicitly disabled, matching the client's AI_ENABLED. */
export function aiEnabled(): boolean {
  return env('FORGE_AI_ENABLED') !== 'false';
}
