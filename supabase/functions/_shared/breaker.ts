/**
 * Circuit breaker over `forge_model_health`.
 *
 * The durable state lives in Postgres because an Edge Function fleet has many
 * isolates, and each one relearning that a model is dead costs three real
 * user-visible failures apiece. The isolate-local cache in front of it exists
 * because the opposite is also true: reading the table on every attempt would
 * add a round trip to a path budgeted in milliseconds.
 *
 * Two sets, deliberately kept apart and unioned on read:
 *
 *   `remote` — what the database says, refreshed at most every 5s.
 *   `local`  — what *this* isolate just watched fail, expiring after 60s.
 *
 * They are separate because a refresh replaces `remote` wholesale, and an
 * earlier version folded both into one set: a refresh then silently discarded
 * a failure this isolate had observed seconds earlier but whose durable write
 * had not landed yet, and the dead model went straight back into rotation.
 *
 * The open/close *policy* — three strikes, doubling backoff, auth opens
 * immediately, bad-request never opens — is mirrored here but owned by
 * `forge_breaker_record()` in migration 0011, so every isolate reaches the
 * same verdict no matter which one observed the failure.
 */
import type { ForgeDb } from './db.ts';

const CACHE_MS = 5_000;
/** How long a locally-observed failure sidelines a model. Matches the SQL base backoff. */
const LOCAL_TTL_MS = 60_000;

let remote: Set<string> = new Set();
let remoteAt = 0;
let inflight: Promise<void> | null = null;

/** `provider/model` -> epoch ms at which the local sideline expires. */
const local = new Map<string, number>();
/** Consecutive failures observed by this isolate, mirroring the SQL policy. */
const localFails = new Map<string, number>();

export function key(provider: string, model: string): string {
  return `${provider}/${model}`;
}

/** Test seam — also used when a deploy wants a cold read. */
export function resetBreakerCache(): void {
  remote = new Set();
  remoteAt = 0;
  inflight = null;
  local.clear();
  localFails.clear();
}

/**
 * The set of `provider/model` pairs currently open.
 *
 * Concurrent callers share one read rather than each issuing their own: an
 * isolate handles many requests at once, and a thundering herd against this
 * table would be self-defeating.
 */
export async function openModels(db: ForgeDb, now = Date.now()): Promise<Set<string>> {
  if (now - remoteAt >= CACHE_MS && !inflight) {
    inflight = (async () => {
      try {
        remote = new Set(await db.openModels());
      } catch {
        // A breaker that cannot be read means "nothing is open". Failing
        // closed here would take the whole AI surface down whenever the
        // database hiccups, which is the outage the breaker exists to prevent.
        remote = new Set();
      } finally {
        remoteAt = now;
        inflight = null;
      }
    })();
  }
  if (inflight) await inflight;

  // Drop expired local sidelines, then union.
  const out = new Set(remote);
  for (const [k, until] of local) {
    if (until <= now) local.delete(k);
    else out.add(k);
  }
  return out;
}

/**
 * Records an outcome. Never awaited on the response path.
 *
 * `bad-request` is passed through to the database rather than filtered here so
 * the policy stays in one place; the SQL function is what decides it must not
 * open. Locally it is skipped for the same reason.
 */
export function recordOutcome(
  db: ForgeDb,
  provider: string,
  model: string,
  ok: boolean,
  reason?: string,
  latencyMs?: number,
  now = Date.now(),
): void {
  void db.recordHealth(provider, model, ok, reason, latencyMs).catch(() => {
    /* Telemetry must never be the reason an answer fails to arrive. */
  });

  const k = key(provider, model);

  if (ok) {
    localFails.delete(k);
    local.delete(k);
    return;
  }
  if (reason === 'bad-request') return;

  // A rejected key will not heal itself inside a 60s backoff, so it does not
  // get the three-strike grace the transient reasons do.
  if (reason === 'auth') {
    local.set(k, now + 15 * 60_000);
    return;
  }

  const n = (localFails.get(k) ?? 0) + 1;
  localFails.set(k, n);
  if (n >= 3) local.set(k, now + LOCAL_TTL_MS);
}
