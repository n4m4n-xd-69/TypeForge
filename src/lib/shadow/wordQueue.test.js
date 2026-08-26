import { describe, it, expect } from 'vitest';
import { xorshift32, toU32, draw, seedFrom } from './prng.js';
import { STRIKE_WEIGHTS, GUARD_WEIGHTS, pickWeighted, resolveStrikeMove } from './wordQueue.js';

describe('STRIKE_WEIGHTS / GUARD_WEIGHTS — §10.2/10.3, fixed regardless of band', () => {
  it('strike weights are the PRD\'s ~30/40/18/12 and sum to 1', () => {
    expect(STRIKE_WEIGHTS).toEqual({ jab: 0.30, slash: 0.40, crush: 0.18, shuriken: 0.12 });
    const total = Object.values(STRIKE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('guard weights are the PRD\'s ~45/25/30 and sum to 1', () => {
    expect(GUARD_WEIGHTS).toEqual({ guard: 0.45, parry: 0.25, mend: 0.30 });
    const total = Object.values(GUARD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});

describe('pickWeighted', () => {
  it('picks by cumulative threshold, in object key order', () => {
    const weights = { a: 0.5, b: 0.3, c: 0.2 };
    expect(pickWeighted(0.0, weights)).toBe('a');
    expect(pickWeighted(0.49, weights)).toBe('a');
    expect(pickWeighted(0.5, weights)).toBe('b');
    expect(pickWeighted(0.79, weights)).toBe('b');
    expect(pickWeighted(0.8, weights)).toBe('c');
    expect(pickWeighted(0.999, weights)).toBe('c');
  });

  it('renormalizes weights that don\'t sum to 1', () => {
    const weights = { a: 45, b: 25 }; // sums to 70, not 1
    expect(pickWeighted(0.0, weights)).toBe('a');
    expect(pickWeighted(45 / 70 + 0.001, weights)).toBe('b');
  });
});

describe('resolveStrikeMove — SB-MOV-5', () => {
  it('index 0 is always jab, for any seed/round', () => {
    expect(resolveStrikeMove(1, 1, 0, 'ember').move).toBe('jab');
    expect(resolveStrikeMove(999, 3, 0, 'damascus').move).toBe('jab');
  });
});

describe('resolveStrikeMove — determinism', () => {
  it('the same (seed, round, index, band) always resolves to the same move', () => {
    const a = resolveStrikeMove(12345, 2, 7, 'steel').move;
    const b = resolveStrikeMove(12345, 2, 7, 'steel').move;
    expect(a).toBe(b);
  });
});

describe('resolveStrikeMove — SB-MOV-4: Crush never appears twice consecutively', () => {
  it('scans a long run of indices for a seed/round and finds no crush-crush adjacency', () => {
    let prevMove = null;
    for (let index = 0; index < 200; index += 1) {
      const { move } = resolveStrikeMove(777, 1, index, 'damascus'); // Damascus favors harder content, a reasonable stress case
      if (prevMove === 'crush') {
        expect(move).not.toBe('crush');
      }
      prevMove = move;
    }
  });
});

describe('resolveStrikeMove — seedFrom guards against xorshift32(0) fixed point', () => {
  it('does not degenerate when seed/round/index XOR to 0', () => {
    // seed=5, round=3, index=6: toU32(5)^3^6 = 5^3^6 = 0
    // Without seedFrom's guard, this would call xorshift32(0)=0, draw()=>u=0 forever,
    // causing pickWeighted to always return the first move ('jab').
    const { move, state } = resolveStrikeMove(5, 3, 6, 'ember');

    // Verify the PRNG state is not 0 (i.e., seedFrom was used).
    expect(state).not.toBe(0);

    // Verify the move is properly drawn from the weighted distribution,
    // not degenerate to 'jab' (which would be the first key every time if u=0).
    // Calling draw(xorshift32(seedFrom(...))) should NOT give u=0.
    const testState = xorshift32(seedFrom(toU32(5), 3, 6));
    const { u } = draw(testState);
    expect(u).not.toBe(0);
  });
});

import { WORD_LENGTH_RANGES, BANDS, wordsInRange, pickWord, drawWordFor } from './wordQueue.js';
import { MOVES } from './moveTable.js';

describe('WORD_LENGTH_RANGES — §9.3', () => {
  it('matches the PRD\'s per-move length bands', () => {
    expect(WORD_LENGTH_RANGES).toEqual({
      jab: [3, 5], slash: [6, 9], crush: [10, 16], shuriken: [4, 8],
      guard: [2, 4], parry: [3, 5], mend: [6, 8],
      // `evade` is the Stickman avatar's Jump lane — a 9th move added beyond
      // §10.1's eight. [4,7] brackets it between Guard/Parry at the short end
      // and Mend at the long end, so a jump is a real commitment without
      // ceasing to be the reflex option. See
      // docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §4.
      evade: [4, 7],
    });
  });

  it('has a length range for every move the table defines', () => {
    // Guards the pairing directly: `drawWordFor` falls back to the `crush`
    // range for an unlisted move, which would silently hand a guard-lane move
    // a 10-16 character word instead of failing.
    const moveIds = Object.keys(MOVES).filter((id) => id !== 'overdrive');
    for (const id of moveIds) {
      expect(WORD_LENGTH_RANGES, `no length range for ${id}`).toHaveProperty(id);
    }
  });
});

describe('BANDS — §9.5', () => {
  it('matches the PRD\'s Ember/Steel/Damascus COMMON:HARDER ratios', () => {
    expect(BANDS.ember).toEqual({ common: 75, harder: 20 });
    expect(BANDS.steel).toEqual({ common: 55, harder: 33 });
    expect(BANDS.damascus).toEqual({ common: 35, harder: 45 });
  });
});

import { COMMON } from '../content.js';

describe('wordsInRange', () => {
  it('filters a bank to words within [min, max] length, inclusive', () => {
    const bank = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    expect(wordsInRange(bank, 2, 4)).toEqual(['bb', 'ccc', 'dddd']);
  });

  it('COMMON has ample words in 6-8 char range to prevent Mend/Slash repetition (SB-WRD-5)', () => {
    const candidates = wordsInRange(COMMON, 6, 8);
    expect(candidates.length).toBeGreaterThanOrEqual(40);
  });
});

describe('pickWord', () => {
  it('picks by fractional index into the list', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(pickWord(0.0, list)).toBe('a');
    expect(pickWord(0.24, list)).toBe('a');
    expect(pickWord(0.25, list)).toBe('b');
    expect(pickWord(0.99, list)).toBe('d');
  });
});

describe('drawWordFor', () => {
  it('jab/guard/parry/mend draw from COMMON, within their length range', () => {
    for (const move of ['jab', 'guard', 'parry', 'mend']) {
      const { word } = drawWordFor(move, 12345, 'steel');
      const [min, max] = WORD_LENGTH_RANGES[move];
      expect(word.length).toBeGreaterThanOrEqual(min);
      expect(word.length).toBeLessThanOrEqual(max);
    }
  });

  it('shuriken draws from PUNCTUATED, within its length range', () => {
    const { word } = drawWordFor('shuriken', 999, 'ember');
    const [min, max] = WORD_LENGTH_RANGES.shuriken;
    expect(word.length).toBeGreaterThanOrEqual(min);
    expect(word.length).toBeLessThanOrEqual(max);
  });

  it('slash draws from COMMON or HARDER (band-weighted), within its length range', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const { word } = drawWordFor('slash', seed, 'damascus');
      const [min, max] = WORD_LENGTH_RANGES.slash;
      expect(word.length).toBeGreaterThanOrEqual(min);
      expect(word.length).toBeLessThanOrEqual(max);
    }
  });

  it('crush draws from HARDER or the phrase table, within its length range', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const { word } = drawWordFor('crush', seed, 'ember');
      const [min, max] = WORD_LENGTH_RANGES.crush;
      expect(word.length).toBeGreaterThanOrEqual(min);
      expect(word.length).toBeLessThanOrEqual(max);
    }
  });

  it('returns a state usable for the next draw', () => {
    const { state } = drawWordFor('jab', 1, 'ember');
    expect(Number.isInteger(state)).toBe(true);
  });
});

import { SB_WRD_1_FALLBACK, card } from './wordQueue.js';

describe('SB_WRD_1_FALLBACK', () => {
  it('has one entry per letter a-z, each 2-4 ASCII lowercase letters', () => {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const word = SB_WRD_1_FALLBACK[letter];
      expect(word).toBeDefined();
      expect(word.length).toBeGreaterThanOrEqual(2);
      expect(word.length).toBeLessThanOrEqual(4);
      expect(word[0]).toBe(letter);
    }
  });
});

describe('card — SB-MOV-5: index 0 is always Jab | Guard', () => {
  it('across several seeds/rounds', () => {
    for (const seed of [1, 42, 999]) {
      const pair = card(seed, 1, 0, 'ember');
      expect(pair.strikeMove).toBe('jab');
      expect(pair.guardMove).toBe('guard');
    }
  });
});

describe('card — SB-WRD-1: strike and guard cards never share a first character', () => {
  it('holds across a large generated sample', () => {
    let violations = 0;
    for (let round = 1; round <= 3; round += 1) {
      for (let index = 0; index < 150; index += 1) {
        const pair = card(7, round, index, 'steel');
        if (pair.strikeWord[0].toLowerCase() === pair.guardWord[0].toLowerCase()) {
          violations += 1;
        }
      }
    }
    expect(violations).toBe(0);
  });
});

describe('card — determinism', () => {
  it('the same (seed, round, index, band) always returns the same pair', () => {
    const a = card(555, 2, 10, 'damascus');
    const b = card(555, 2, 10, 'damascus');
    expect(a).toEqual(b);
  });

  it('is independent of call order across different indices', () => {
    const forward = [0, 1, 2, 3].map((i) => card(88, 1, i, 'ember'));
    const backward = [3, 2, 1, 0].map((i) => card(88, 1, i, 'ember')).reverse();
    expect(forward).toEqual(backward);
  });
});

describe('card — SB-WRD-7: no player parameter, callable identically for "both players"', () => {
  it('card() has arity 4 (seed, round, index, band) — no player slot', () => {
    expect(card.length).toBe(4);
  });
});

describe('resolveStrikeMove — distribution (post seedFrom fix)', () => {
  it('Crush lands close to its ~18% target share across a large sample (was ~10% before the seedFrom fix)', () => {
    const counts = { jab: 0, slash: 0, crush: 0, shuriken: 0 };
    let total = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      for (let round = 1; round <= 3; round += 1) {
        for (let index = 1; index < 30; index += 1) { // skip index 0, it's hardcoded jab
          const { move } = resolveStrikeMove(seed, round, index, 'steel');
          counts[move] += 1;
          total += 1;
        }
      }
    }
    const crushShare = counts.crush / total;
    // PRD target is ~18%, but SB-MOV-4 (no consecutive Crush) caps the
    // achievable maximum lower than that; allow a wide-but-meaningful band
    // that clearly distinguishes "fixed" from the measured ~10% broken rate.
    expect(crushShare).toBeGreaterThan(0.12);
    expect(crushShare).toBeLessThan(0.18);
  });

  it('card(seed, round, index) does not collide with card(seed, index, round) nearly as often as before (was 91%)', () => {
    let collisions = 0;
    let total = 0;
    for (let seed = 1; seed <= 15; seed += 1) {
      for (let a = 1; a <= 8; a += 1) {
        for (let b = 1; b <= 8; b += 1) {
          if (a === b) continue;
          total += 1;
          const cardA = card(seed, a, b, 'steel');
          const cardB = card(seed, b, a, 'steel');
          if (cardA.strikeWord === cardB.strikeWord && cardA.guardWord === cardB.guardWord) {
            collisions += 1;
          }
        }
      }
    }
    expect(collisions / total).toBeLessThan(0.1); // was ~0.91 before the fix
  });
});
