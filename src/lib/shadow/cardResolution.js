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
const MEND_WORD_SALT = 0x4D574430; // 'MWD0' — SB-WRD-1 re-roll walk, see below

const MAX_SB_WRD_1_REROLLS = 8;

function overrideSeed(seed, round, index, player, salt) {
  return seedFrom(toU32(seed), round, index, player + 1, salt);
}

const firstChar = (word) => word[0].toLowerCase();

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
    const list = wordsInRange(COMMON, min, max);
    guardWord = pickWord(wordPick.u, list);

    /**
     * SB-WRD-1 has to be re-established here, and this is not cosmetic.
     *
     * `wordQueue.card()` guarantees the strike and guard words start with
     * different characters, because that first character is how a lane is
     * committed to — two lanes sharing it makes one of them unreachable for
     * that card. This branch then *re-draws* `guardWord` from a different
     * bank and a different length range, which silently voided that
     * guarantee: measured over 2250 cards (3 bands x 5 rounds x 150 indices,
     * seed 1), `card()` produced 0 collisions while this re-roll fired 630
     * times and produced 23 collisions — about 1 card in 100 overall, each
     * one a card where the player physically cannot choose to defend.
     * Example: base `planet`/`morning`(mend) re-rolled to `planet`/`part`,
     * so typing `p` always took the Fight lane.
     *
     * The walk uses its own salt keyed by attempt, so a colliding card and a
     * clean one stay independent, and terminates in the `pickWord` offset
     * fallback below rather than looping unbounded.
     */
    let attempts = 0;
    while (firstChar(guardWord) === firstChar(strikeWord) && attempts < MAX_SB_WRD_1_REROLLS) {
      const walkState = xorshift32(
        seedFrom(toU32(seed), round, index, player + 1, MEND_WORD_SALT, attempts),
      );
      guardWord = pickWord(draw(walkState).u, list);
      attempts += 1;
    }
    if (firstChar(guardWord) === firstChar(strikeWord)) {
      // Deterministic terminal escape: scan the candidate list in order for
      // the first word that clears. `list` is non-empty for every guard/parry
      // range, and COMMON spans many initials, so this resolves in practice;
      // if it ever cannot, the collision is preferable to a thrown error
      // mid-round, and the lane is still typable — just not distinctly.
      const clear = list.find((w) => firstChar(w) !== firstChar(strikeWord));
      if (clear) guardWord = clear;
    }
  }

  return { strikeMove, strikeWord, guardMove, guardWord };
}
