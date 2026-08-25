import { describe, it, expect } from 'vitest';
import { xorshift32, toU32 } from './prng.js';
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
