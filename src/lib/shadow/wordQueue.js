import { xorshift32, toU32, draw } from './prng.js';

/**
 * The §9.4 base seeded queue. `card(seed, round, index, band)` (assembled
 * in a later task) takes no `player` and reads no live state — per
 * SB-WRD-7 both players see the identical base sequence; only pacing
 * differs. State-dependent overrides (Overdrive, Mend) live in
 * cardResolution.js, on their own independently-salted draws that never
 * touch this module's shared stream.
 */

// §10.2 — fixed strike-lane frequencies, independent of difficulty band.
export const STRIKE_WEIGHTS = { jab: 0.30, slash: 0.40, crush: 0.18, shuriken: 0.12 };
// §10.3 — fixed guard-lane candidate frequencies (Mend is a candidate
// here; cardResolution.js gates it on live HP/Focus per player).
export const GUARD_WEIGHTS = { guard: 0.45, parry: 0.25, mend: 0.30 };

export function pickWeighted(u, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w / total;
    if (u < acc) return key;
  }
  return entries[entries.length - 1][0];
}

// SB-MOV-5 (index 0 is always Jab|Guard) and SB-MOV-4 (Crush never twice
// consecutively) both resolve here. SB-MOV-4 needs the previous index's
// strike move, resolved by recursing on index-1 — bounded by the round's
// own card count (tens, not thousands), so this is cheap in practice even
// without memoization across separate top-level calls.
export function resolveStrikeMove(seed, round, index, band) {
  const state = xorshift32(toU32(seed) ^ round ^ index);
  if (index === 0) return { move: 'jab', state };

  const prevMove = resolveStrikeMove(seed, round, index - 1, band).move;
  const { u, next } = draw(state);
  const weights = prevMove === 'crush'
    ? { jab: STRIKE_WEIGHTS.jab, slash: STRIKE_WEIGHTS.slash, shuriken: STRIKE_WEIGHTS.shuriken }
    : STRIKE_WEIGHTS;
  return { move: pickWeighted(u, weights), state: next };
}
