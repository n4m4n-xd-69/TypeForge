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

  it('getMove returns the move by id', () => {
    expect(getMove('slash').base).toBe(10);
  });

  it('getMove throws on an unknown id', () => {
    expect(() => getMove('spin-kick')).toThrow(/unknown move/i);
  });
});
