import { supabase } from './supabase.js';

/**
 * Operator notices addressed to the signed-in person.
 *
 * `my_notices()` does the audience, targeting, live-window and
 * already-dismissed filtering in one query, so nothing here decides who sees
 * what — this file only moves the result.
 *
 * Every call is best-effort. A notice is a message, not a feature: if the
 * network is down the product must still work, so a failure returns "nothing
 * to show" rather than surfacing an error over the app.
 */

export async function fetchMyNotices() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_notices');
  if (error) return [];
  return data ?? [];
}

/** Advisory: drives the delivery stats an operator sees. Never blocks render. */
export async function markNoticeSeen(id) {
  if (!supabase || !id) return;
  try {
    await supabase.rpc('mark_notice_seen', { p_id: id });
  } catch {
    /* stats only */
  }
}

/**
 * Durable across devices, which is the whole point of storing it server-side:
 * a "show once" notice dismissed on a laptop must not reappear on a phone.
 */
export async function dismissNotice(id) {
  if (!supabase || !id) return false;
  const { error } = await supabase.rpc('dismiss_notice', { p_id: id });
  return !error;
}
