import { xorshift32, toU32, draw } from './prng.js';
import { COMMON, HARDER, PUNCTUATED } from '../content.js';
import { phraseFor } from './phraseTable.js';

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

// §9.3 — per-move word-length ranges.
export const WORD_LENGTH_RANGES = {
  jab: [3, 5], slash: [6, 9], crush: [10, 16], shuriken: [4, 8],
  guard: [2, 4], parry: [3, 5], mend: [6, 8],
};

// §9.5 — band ratios. Only `common`/`harder` are kept: the queue only
// consults this for Slash's COMMON-vs-HARDER choice (the one place a
// move's bank is genuinely ambiguous per §9.3 and covered by a stated
// PRD ratio) — Crush's HARDER-vs-phrase-table choice has no PRD-stated
// ratio and is fixed at 50/50 by design-doc ruling, not read from here.
export const BANDS = {
  ember: { common: 75, harder: 20 },
  steel: { common: 55, harder: 33 },
  damascus: { common: 35, harder: 45 },
};

export function wordsInRange(bank, min, max) {
  return bank.filter((w) => w.length >= min && w.length <= max);
}

export function pickWord(u, list) {
  return list[Math.floor(u * list.length)];
}

// Draws exactly one word (plus, for crush/slash, one preceding bank-choice
// draw) for the given move, returning the next PRNG state so the caller
// can keep consuming the same stream.
export function drawWordFor(move, state, band) {
  const [min, max] = WORD_LENGTH_RANGES[move] ?? WORD_LENGTH_RANGES.crush;

  if (move === 'crush') {
    const bankPick = draw(state);
    const wordPick = draw(bankPick.next);
    if (bankPick.u < 0.5) {
      const list = wordsInRange(HARDER, min, max);
      return { word: pickWord(wordPick.u, list), state: wordPick.next };
    }
    return { word: phraseFor(wordPick.u, min, max), state: wordPick.next };
  }

  if (move === 'slash') {
    const bankPick = draw(state);
    const ratio = BANDS[band].common / (BANDS[band].common + BANDS[band].harder);
    const bank = bankPick.u < ratio ? COMMON : HARDER;
    const list = wordsInRange(bank, min, max);
    const wordPick = draw(bankPick.next);
    return { word: pickWord(wordPick.u, list), state: wordPick.next };
  }

  if (move === 'shuriken') {
    const list = wordsInRange(PUNCTUATED, min, max);
    const wordPick = draw(state);
    return { word: pickWord(wordPick.u, list), state: wordPick.next };
  }

  // jab, guard, parry, mend — single-bank COMMON.
  const list = wordsInRange(COMMON, min, max);
  const wordPick = draw(state);
  return { word: pickWord(wordPick.u, list), state: wordPick.next };
}
