/**
 * Battlefield player-capacity limits, shared by the create form and anything
 * else that needs to reason about room size without duplicating the numbers.
 *
 * The server (migration 0028) is the real gate — `battle_create` rejects
 * anything outside [MIN_PLAYERS, MAX_PLAYERS] regardless of what the client
 * sends. `clampPlayerCount` exists so a stray keystroke in the Custom input
 * never round-trips to the server as a doomed RPC call; it mirrors the
 * server's range, it does not replace it.
 */

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 60;

/** Fixed chips for the common sizes. Custom is the only way past 30. */
export const QUICK_PICKS = Object.freeze([2, 4, 6, 8, 12, 16, 24, 30]);

/**
 * Coerces arbitrary input (a number, a numeric string, an empty field mid-edit,
 * a pasted non-number) to a valid player count.
 *
 * Anything that isn't a finite number — including a blank string, since that's
 * what a cleared number input reads as — falls back to MIN_PLAYERS rather than
 * throwing, so the input is always in a valid state to render and to submit.
 */
export function clampPlayerCount(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
}
