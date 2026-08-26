import { describe, it, expect } from 'vitest';
import { LANES, MOVES, getMove } from './moveTable.js';

describe('moveTable', () => {
  it('defines the 8 MVP moves with their §10.1 values', () => {
    expect(MOVES.jab).toEqual({
      id: 'jab', name: 'Jab', lane: LANES.STRIKE,
      base: 6, focus: 4, committed: false, guardFactor: 0.50,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.slash).toEqual({
      id: 'slash', name: 'Slash', lane: LANES.STRIKE,
      base: 10, focus: 6, committed: false, guardFactor: 0.50,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.crush).toEqual({
      id: 'crush', name: 'Crush', lane: LANES.STRIKE,
      base: 16, focus: 8, committed: true, guardFactor: 0.50,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.shuriken).toEqual({
      id: 'shuriken', name: 'Shuriken', lane: LANES.STRIKE,
      base: 7, focus: 5, committed: false, guardFactor: 0.85,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.overdrive).toEqual({
      id: 'overdrive', name: 'Overdrive', lane: LANES.STRIKE,
      base: 30, focus: -100, committed: true, guardFactor: 0.50,
      resetsChain: true, healsHp: 0,
    });
    expect(MOVES.guard).toEqual({
      id: 'guard', name: 'Guard', lane: LANES.GUARD,
      base: 0, focus: 3, committed: false, guardFactor: null,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.parry).toEqual({
      id: 'parry', name: 'Parry', lane: LANES.GUARD,
      base: 0, focus: 10, committed: false, guardFactor: null,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.mend).toEqual({
      id: 'mend', name: 'Mend', lane: LANES.GUARD,
      base: 0, focus: -25, committed: true, guardFactor: null,
      resetsChain: false, healsHp: 120,
    });
  });

  /**
   * The 9th move, added for the Stickman avatar's Jump lane
   * (docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §4.1). A
   * divergence from §10.1's eight, recorded deliberately rather than by
   * loosening the assertion above.
   */
  it('defines Evade, the Jump lane, as a guard-lane move', () => {
    expect(MOVES.evade).toEqual({
      id: 'evade', name: 'Evade', lane: LANES.GUARD,
      base: 0, focus: 5, committed: false, guardFactor: null,
      resetsChain: false, healsHp: 0,
    });
  });

  /**
   * Pins the table size explicitly. Previously the count lived only in a test
   * *name* ("the 8 MVP moves"), so a 9th move could be added with every
   * assertion still green and nothing pointing out that the documented set had
   * changed. Now the number is an assertion.
   */
  it('holds exactly nine moves, five strike and four guard', () => {
    expect(Object.keys(MOVES).sort()).toEqual(
      ['crush', 'evade', 'guard', 'jab', 'mend', 'overdrive', 'parry', 'shuriken', 'slash'],
    );
    const byLane = (lane) => Object.values(MOVES).filter((m) => m.lane === lane).map((m) => m.id).sort();
    expect(byLane(LANES.STRIKE)).toEqual(['crush', 'jab', 'overdrive', 'shuriken', 'slash']);
    expect(byLane(LANES.GUARD)).toEqual(['evade', 'guard', 'mend', 'parry']);
  });

  /** Every move must carry the full field set — no partial entries. */
  it('every move carries the same nine fields', () => {
    const fields = ['id', 'name', 'lane', 'base', 'focus', 'committed', 'guardFactor', 'resetsChain', 'healsHp'];
    for (const move of Object.values(MOVES)) {
      for (const field of fields) {
        expect(move, `${move.id} is missing ${field}`).toHaveProperty(field);
      }
      expect(Object.keys(move).sort()).toEqual([...fields].sort());
    }
  });

  /** Only Mend heals. Evade in particular must not, or the Jump lane becomes a free Mend. */
  it('Mend is the only move that heals', () => {
    expect(Object.values(MOVES).filter((m) => m.healsHp > 0).map((m) => m.id)).toEqual(['mend']);
  });

  it('getMove returns the move by id', () => {
    expect(getMove('slash').base).toBe(10);
  });

  it('getMove throws on an unknown id', () => {
    expect(() => getMove('spin-kick')).toThrow(/unknown move/i);
  });
});
