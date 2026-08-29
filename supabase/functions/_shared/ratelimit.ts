/**
 * Per-caller request ceilings.
 *
 * These exist because the shared provider budget is small and communal:
 * OpenRouter's free tier is 50 requests a day across every user of the app.
 * Without a per-caller ceiling, one enthusiastic visitor — or one loop in a
 * dev console — spends everyone's allowance before lunch.
 *
 * Counting happens in Postgres (`forge_request_log`) so it holds across the
 * whole isolate fleet, with an isolate-local pre-check in front so the common
 * case costs no round trip at all.
 */
import type { ForgeDb } from './db.ts';

export interface Limits {
  perMinute: number;
  perDay: number;
}

export const LIMITS: Record<'user' | 'anonymous', Limits> = {
  user: { perMinute: 20, perDay: 200 },
  // Anonymous users are real auth.users rows here, but they are also the
  // cheapest identity to mint, so they get half.
  anonymous: { perMinute: 10, perDay: 100 },
};

interface Window { minute: number[]; day: number[] }

const local = new Map<string, Window>();

export function resetRateLimits(): void {
  local.clear();
}

export interface Verdict {
  allowed: boolean;
  reason?: 'per-minute' | 'per-day';
  retryAfterSec?: number;
}

/**
 * Isolate-local check.
 *
 * Not authoritative — an isolate only sees its own share of traffic — but it
 * catches the runaway-loop case immediately and for free, which is the case
 * that actually burns the budget.
 */
export function checkLocal(
  id: string,
  anonymous: boolean,
  now = Date.now(),
): Verdict {
  const limits = anonymous ? LIMITS.anonymous : LIMITS.user;
  const w = local.get(id) ?? { minute: [], day: [] };

  const minuteAgo = now - 60_000;
  const dayAgo = now - 86_400_000;
  w.minute = w.minute.filter((t) => t > minuteAgo);
  w.day = w.day.filter((t) => t > dayAgo);

  if (w.minute.length >= limits.perMinute) {
    local.set(id, w);
    return {
      allowed: false,
      reason: 'per-minute',
      retryAfterSec: Math.max(1, Math.ceil((w.minute[0] + 60_000 - now) / 1000)),
    };
  }
  if (w.day.length >= limits.perDay) {
    local.set(id, w);
    return { allowed: false, reason: 'per-day', retryAfterSec: 3600 };
  }

  w.minute.push(now);
  w.day.push(now);
  local.set(id, w);
  return { allowed: true };
}

/** Durable record, fire-and-forget. */
export function record(db: ForgeDb, userId: string | null, lane: string): void {
  void db.logRequest(userId, lane).catch(() => { /* advisory */ });
}
