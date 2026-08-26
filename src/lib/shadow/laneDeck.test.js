import { describe, expect, it } from 'vitest';
import { LANE_IDS, WHIFF_FOCUS_COST, deckFor, fallbackWordAvoiding, laneForKey } from './laneDeck.js';
import { card } from './wordQueue.js';
import { initialRoundState } from './roundState.js';
import { getMove } from './moveTable.js';

/**
 * Coverage for the Stickman avatar's three-lane deck
 * (docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §4).
 *
 * The reachability sweep below is the single most important assertion in the
 * avatar work: a lane is committed to by typing its word's first character, so
 * two lanes sharing a first character makes one of them unreachable for that
 * card — a soft-lock the player cannot see coming and cannot work around.
 */

const BANDS = ['ember', 'steel', 'damascus'];
const fresh = () => initialRoundState();

describe('LANE_IDS', () => {
  it('is the three presented lanes in render order', () => {
    expect(LANE_IDS).toEqual(['fight', 'shield', 'jump']);
  });
});

describe('deckFor', () => {
  it('returns three lanes, one per LANE_ID, in order', () => {
    const deck = deckFor(1, 1, 0, 'steel', fresh(), 0);
    expect(deck.overdrive).toBe(false);
    expect(deck.lanes.map((l) => l.id)).toEqual(LANE_IDS);
  });

  it('maps each presented lane onto a real mechanical lane', () => {
    const deck = deckFor(7, 2, 3, 'steel', fresh(), 0);
    for (const lane of deck.lanes) {
      // Throws on an unknown id, so this also proves every moveId is in the table.
      const move = getMove(lane.moveId);
      expect(move.lane).toBe(lane.mechanicalLane);
    }
  });

  it('Jump is always Evade, and Evade is a guard-lane move', () => {
    for (let index = 0; index < 40; index += 1) {
      const deck = deckFor(3, 1, index, 'steel', fresh(), 0);
      if (deck.overdrive) continue;
      const jump = deck.lanes.find((l) => l.id === 'jump');
      expect(jump.moveId).toBe('evade');
      expect(jump.mechanicalLane).toBe('guard');
    }
  });

  /**
   * The reachability invariant, swept broadly.
   *
   * Shape note: coverage is spread across **rounds** rather than deep into card
   * indices, because `wordQueue.resolveStrikeMove` recurses on `index - 1` to
   * enforce SB-MOV-4 (no consecutive Crush), making a sweep O(n²) in the index
   * bound. 12 rounds x 40 indices visits the same number of decks as 3 x 150 at
   * roughly a tenth of the work, and rounds are the axis that actually varies
   * the seed. An earlier version used 150 indices and intermittently blew
   * vitest's 5s default timeout under parallel load — a flaky test on the most
   * important invariant in the module, which is worse than no test.
   *
   * 2 seeds x 3 bands x 12 rounds x 40 indices = 2880 decks.
   */
  it('every deck has three distinct first characters, case-insensitively', () => {
    let checked = 0;
    for (const seed of [1, 0xbeef]) {
      for (const band of BANDS) {
        for (let round = 1; round <= 12; round += 1) {
          for (let index = 0; index < 40; index += 1) {
            const deck = deckFor(seed, round, index, band, fresh(), 0);
            const firsts = deck.lanes.map((l) => l.word[0].toLowerCase());
            expect(
              new Set(firsts).size,
              `collision at seed=${seed} band=${band} round=${round} index=${index}: ${JSON.stringify(deck.lanes.map((l) => l.word))}`,
            ).toBe(firsts.length);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2000);
  }, 20000);

  it('every word is non-empty and every lane is therefore committable', () => {
    for (let index = 0; index < 60; index += 1) {
      const deck = deckFor(11, 1, index, 'damascus', fresh(), 0);
      for (const lane of deck.lanes) {
        expect(lane.word.length).toBeGreaterThan(0);
        expect(laneForKey(deck, lane.word[0])).toMatchObject({ id: lane.id });
      }
    }
  });

  /**
   * Non-perturbation: adding the Jump lane must not move the Fight/Shield words
   * an existing seed produces, or every stored replay and determinism fixture
   * shifts underneath us. `card()` is the pre-existing base sequence.
   */
  it('does not perturb the Fight/Shield words the base queue produces', () => {
    for (const band of BANDS) {
      for (let index = 0; index < 50; index += 1) {
        const base = card(5, 1, index, band);
        const deck = deckFor(5, 1, index, band, fresh(), 0);
        if (deck.overdrive) continue;
        const fight = deck.lanes.find((l) => l.id === 'fight');
        const shield = deck.lanes.find((l) => l.id === 'shield');
        expect(fight.word).toBe(base.strikeWord);
        expect(fight.moveId).toBe(base.strikeMove);
        // guardMove can legitimately differ: cardResolution gates Mend on live
        // HP/Focus, and a fresh round state fails that gate. The *word* only
        // changes when the move does, so assert the pair moves together.
        if (shield.moveId === base.guardMove) expect(shield.word).toBe(base.guardWord);
      }
    }
  });

  it('is deterministic — same inputs, same deck', () => {
    const a = deckFor(42, 3, 9, 'steel', fresh(), 0);
    const b = deckFor(42, 3, 9, 'steel', fresh(), 0);
    expect(b).toEqual(a);
  });

  /**
   * Overdrive is a commitment, not a choice. Offering Shield and Jump beside it
   * would be offering a decision the rules do not permit.
   */
  it('collapses to a single Fight lane when Overdrive is live', () => {
    const charged = { ...fresh(), focus: [100, 0] };
    const deck = deckFor(1, 1, 4, 'steel', charged, 0);
    expect(deck.overdrive).toBe(true);
    expect(deck.lanes).toHaveLength(1);
    expect(deck.lanes[0]).toMatchObject({ id: 'fight', moveId: 'overdrive' });
  });

  it('index 0 opens on Jab and Guard, per SB-MOV-5', () => {
    const deck = deckFor(1, 1, 0, 'steel', fresh(), 0);
    expect(deck.lanes.find((l) => l.id === 'fight').moveId).toBe('jab');
    expect(deck.lanes.find((l) => l.id === 'shield').moveId).toBe('guard');
  });
});

describe('laneForKey', () => {
  it('is case-insensitive, so Shift never costs Focus', () => {
    const deck = deckFor(1, 1, 0, 'steel', fresh(), 0);
    const word = deck.lanes[0].word;
    expect(laneForKey(deck, word[0].toUpperCase())).toMatchObject({ id: deck.lanes[0].id });
    expect(laneForKey(deck, word[0].toLowerCase())).toMatchObject({ id: deck.lanes[0].id });
  });

  it('returns null for a key that matches no lane — a whiff', () => {
    const deck = deckFor(1, 1, 0, 'steel', fresh(), 0);
    const taken = new Set(deck.lanes.map((l) => l.word[0].toLowerCase()));
    const unused = 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !taken.has(c));
    expect(laneForKey(deck, unused)).toBeNull();
  });

  it('returns null for non-single-character keys', () => {
    const deck = deckFor(1, 1, 0, 'steel', fresh(), 0);
    for (const key of ['Enter', 'Backspace', 'ArrowLeft', '', null, undefined]) {
      expect(laneForKey(deck, key)).toBeNull();
    }
  });
});

describe('fallbackWordAvoiding', () => {
  it('returns a word whose first letter is not taken', () => {
    const word = fallbackWordAvoiding(['a', 'b'], 'a');
    expect(word[0].toLowerCase()).not.toBe('a');
    expect(word[0].toLowerCase()).not.toBe('b');
  });

  it('wraps past z', () => {
    const word = fallbackWordAvoiding(['z'], 'z');
    expect(word).toBeTruthy();
    expect(word[0].toLowerCase()).not.toBe('z');
  });

  it('always resolves for any two taken letters', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
    for (const a of alphabet) {
      for (const b of alphabet) {
        const word = fallbackWordAvoiding([a, b], a);
        expect(word, `no fallback for taken=[${a},${b}]`).toBeTruthy();
        expect([a, b]).not.toContain(word[0].toLowerCase());
      }
    }
  });
});

describe('WHIFF_FOCUS_COST', () => {
  it('matches the reducer penalty it mirrors', () => {
    // combat.js applyWhiff subtracts 3. If that changes, this must too.
    expect(WHIFF_FOCUS_COST).toBe(3);
  });
});
