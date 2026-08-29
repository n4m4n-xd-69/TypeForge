import { supabase } from './supabase.js';

/**
 * A signed-in account's own standing.
 *
 * Readable without any special grant: `profiles` has carried an own-row select
 * policy since 0001, and `status`/`status_reason` are columns on that same row.
 * A suspended person is entitled to know they are suspended and why — a
 * product that silently stops working is indistinguishable from one that is
 * broken, and the support ticket costs more than the sentence.
 *
 * The appeal window is a product rule, not a database one: nothing expires on
 * its own, and an appeal after the deadline is still an appeal. The date is
 * shown so the person knows when to act, not to bar them afterwards.
 */

export const APPEAL_WINDOW_DAYS = 3;

export async function fetchAccountStatus(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('status, status_reason, status_changed_at')
    .eq('id', userId)
    .maybeSingle();
  // A read failure must not lock anybody out of a working product, so an
  // error is treated as "no reason to think anything is wrong".
  if (error || !data) return null;
  return data;
}

/** Deadline for appealing, derived from when the suspension was applied. */
export function appealDeadline(statusChangedAt) {
  if (!statusChangedAt) return null;
  const from = new Date(statusChangedAt);
  if (Number.isNaN(from.getTime())) return null;
  return new Date(from.getTime() + APPEAL_WINDOW_DAYS * 86_400_000);
}

/** Whole days left, floored at zero. `null` when there is no known start. */
export function daysRemaining(statusChangedAt, now = Date.now()) {
  const deadline = appealDeadline(statusChangedAt);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline.getTime() - now) / 86_400_000));
}
