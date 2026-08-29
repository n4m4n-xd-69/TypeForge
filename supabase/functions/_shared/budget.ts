/**
 * Per-provider daily spend guard.
 *
 * This exists for one number: OpenRouter's free tier allows 50 requests a day,
 * which is roughly one user's practice session. Without a guard, the first
 * enthusiastic visitor exhausts the allowance shared by everyone else, and
 * every subsequent request falls through to whatever is left.
 *
 * The counter is authoritative in Postgres and cached per isolate for 30s.
 * Drift within that window is acceptable and deliberate: the alternative is a
 * database round trip in front of every attempt, which costs more latency than
 * the occasional overshoot costs quota.
 */
import type { ForgeDb } from './db.ts';
import { PROVIDERS, type ProviderId } from './providers.ts';

const CACHE_MS = 30_000;
/** Stop using a provider once it is this close to its ceiling. */
const HEADROOM = 0.9;

let counts: Record<string, number> = {};
let countsAt = 0;
let inflight: Promise<Record<string, number>> | null = null;

export function resetBudgetCache(): void {
  counts = {};
  countsAt = 0;
  inflight = null;
}

export async function refresh(db: ForgeDb, now = Date.now()): Promise<Record<string, number>> {
  if (now - countsAt < CACHE_MS) return counts;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      counts = await db.budgetToday();
      countsAt = now;
    } catch {
      // Unknown spend is treated as zero spend. Blocking every provider
      // because the counter table is unreachable would turn a metrics outage
      // into a product outage.
      counts = {};
      countsAt = now;
    } finally {
      inflight = null;
    }
    return counts;
  })();

  return inflight;
}

/**
 * Whether a provider may still be used.
 *
 * `exhausted` is the interesting case: it is not a hard block. The caller is
 * expected to fall back to it when every other provider is open or absent,
 * because a rate-limited answer is still better than no answer.
 */
export function canSpend(id: ProviderId): boolean {
  const limit = PROVIDERS[id].dailyLimit;
  if (!limit) return true;
  return (counts[id] ?? 0) < limit * HEADROOM;
}

/** True when no provider in the list has budget left. */
export function allExhausted(ids: readonly ProviderId[]): boolean {
  return ids.length > 0 && ids.every((id) => !canSpend(id));
}

/**
 * Charges one request. Optimistic: the local counter moves immediately so a
 * burst inside the cache window is still counted, and the durable increment
 * happens without being awaited.
 */
export function charge(db: ForgeDb, id: ProviderId): void {
  counts[id] = (counts[id] ?? 0) + 1;
  void db.chargeBudget(id, PROVIDERS[id].dailyLimit).catch(() => {
    /* Advisory. A missed increment costs accuracy, never an answer. */
  });
}

/** Admin view. */
export function snapshot(): Record<string, { used: number; limit?: number }> {
  const out: Record<string, { used: number; limit?: number }> = {};
  for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
    out[id] = { used: counts[id] ?? 0, limit: PROVIDERS[id].dailyLimit };
  }
  return out;
}
