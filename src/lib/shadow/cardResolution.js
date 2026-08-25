import { xorshift32, toU32, draw, seedFrom } from './prng.js';
import { phraseFor } from './phraseTable.js';
import { wordsInRange, pickWord, WORD_LENGTH_RANGES } from './wordQueue.js';
import { COMMON } from '../content.js';

/**
 * §10.4's state-dependent card overrides (Overdrive, Mend) — the only
 * player/state-dependent step in the whole word system. Both overrides
 * draw from their own independently-salted PRNG stream (never the shared
 * base-sequence stream wordQueue.js uses), so resolving for one player at
 * one index can never change what a different index, or the other
 * player's own resolution, produces. `roundState` uses the same shape
 * Plan 1's combat.js reducer state does: HP in integer tenths.
 *
 * PRD §10.2 also says Overdrive "stays until played or the round ends"
 * once triggered. This module can't provide that by itself —
 * `resolveForPlayer` is a pure function of the CURRENT `roundState`, so if
 * Focus drops below 100 between two calls for the same index, Overdrive
 * silently reverts. Whoever consumes this module must cache the resolved
 * pair for an index once Overdrive fires, and keep using that cached pair
 * rather than re-resolving, until the card is actually played or the
 * round ends.
 */

const OVERDRIVE_SALT = 0x4F564552; // 'OVER'
const MEND_REROLL_SALT = 0x4D454E44; // 'MEND'

function overrideSeed(seed, round, index, player, salt) {
  return seedFrom(toU32(seed), round, index, player + 1, salt);
}

export function resolveForPlayer(seed, round, index, basePair, roundState, player) {
  let { strikeMove, strikeWord, guardMove, guardWord } = basePair;

  const focus = roundState.focus[player];
  const hp = roundState.hp[player]; // integer tenths

  if (focus === 100) {
    const state = xorshift32(overrideSeed(seed, round, index, player, OVERDRIVE_SALT));
    const wordPick = draw(state);
    strikeMove = 'overdrive';
    strikeWord = phraseFor(wordPick.u, 14, 24, { requirePunctuation: true });
  }

  if (guardMove === 'mend' && !(hp < 700 && focus >= 25)) {
    const state = xorshift32(overrideSeed(seed, round, index, player, MEND_REROLL_SALT));
    const movePick = draw(state);
    guardMove = movePick.u < (0.45 / 0.70) ? 'guard' : 'parry';
    const wordPick = draw(movePick.next);
    const [min, max] = WORD_LENGTH_RANGES[guardMove];
    guardWord = pickWord(wordPick.u, wordsInRange(COMMON, min, max));
  }

  return { strikeMove, strikeWord, guardMove, guardWord };
}
