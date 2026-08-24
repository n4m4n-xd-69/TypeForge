import { describe, it, expect } from 'vitest';
import { CONTEST, parMs } from './damage.js';
import { initialRoundState } from './roundState.js';
import { stepEvent } from './combat.js';

const strike = (overrides) => ({
  seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'strike',
  outcome: 'complete', tStart: 0, tEnd: 900, keystrokes: 7, errors: 0,
  ikiStats: [120, 15], moveId: 'slash', chars: 7, ...overrides,
});

describe('stepEvent — strike lane, complete', () => {
  it('a clean Slash at par against a neutral opponent deals 12.5 HP and grants +6 Focus, +1 chain', () => {
    const event = strike({ tEnd: parMs(7) });
    const next = stepEvent(initialRoundState(), event, [event]);
    expect(next.hp).toEqual([1000, 875]); // 1000 - 125
    expect(next.focus).toEqual([6, 0]);
    expect(next.chain).toEqual([1, 0]);
    expect(next.history).toEqual([event]);
  });

  it('a Slash landed with 1 error grants the flat +2 Focus instead of the clean bonus', () => {
    const event = strike({ tEnd: parMs(7), errors: 1 });
    const next = stepEvent(initialRoundState(), event, [event]);
    expect(next.focus).toEqual([2, 0]);
    expect(next.chain).toEqual([0, 0]); // 1 error: held, not grown
  });

  it('2+ errors resets the attacker\'s own chain', () => {
    const state = { ...initialRoundState(), chain: [5, 0] };
    const event = strike({ tEnd: parMs(7), errors: 2 });
    const next = stepEvent(state, event, [event]);
    expect(next.chain).toEqual([0, 0]);
  });

  it('Overdrive spends all Focus and resets the attacker\'s chain, win or not', () => {
    const state = { ...initialRoundState(), focus: [100, 0], chain: [8, 0] };
    const event = strike({ moveId: 'overdrive', chars: 18, tEnd: parMs(18), errors: 0 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([0, 0]);
    expect(next.chain).toEqual([0, 0]);
  });

  it('taking a Critical hit breaks the defender\'s chain', () => {
    const state = { ...initialRoundState(), chain: [0, 4] };
    // clean, well under par -> speed 1.40 -> Critical
    const event = strike({ tEnd: parMs(7) / 2 });
    const next = stepEvent(state, event, [event]);
    expect(next.chain[1]).toBe(0);
  });

  it('a Committed target takes contest x1.50', () => {
    const crushEvent = strike({ player: 1, moveId: 'crush', chars: 12, tStart: 0, tEnd: 1500 });
    const jab = strike({ player: 0, moveId: 'jab', chars: 4, tStart: 200, tEnd: 200 + parMs(4) });
    const next = stepEvent(initialRoundState(), jab, [crushEvent, jab]);
    // §8.5: Clean Jab into a committed opponent -> 11.3 (113 tenths)
    expect(next.hp[1]).toBe(1000 - 113);
  });

  it('a Shuriken vs. a guarding target is reduced only 15%, not 50%', () => {
    // Guard's window is 300..1500; the Shuriken has to resolve inside it,
    // so it starts at t=0 (at par: tEnd = parMs(6) = 1400).
    const guardEvent = { seq: 0, player: 1, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 300, keystrokes: 4, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 4 };
    const shurikenEvent = strike({ player: 0, moveId: 'shuriken', chars: 6, tStart: 0, tEnd: parMs(6) });
    const next = stepEvent(initialRoundState(), shurikenEvent, [guardEvent, shurikenEvent]);
    const expectedTenths = Math.round(7 * 1.00 * 1.25 * 1.00 * 0.85 * 1.00 * 10);
    expect(next.hp[1]).toBe(1000 - expectedTenths);
  });
});

describe('stepEvent — strike lane, expire', () => {
  it('costs the expiring player 5 Focus and resets their chain; no damage', () => {
    const state = { ...initialRoundState(), focus: [40, 0], chain: [3, 0] };
    const event = strike({ outcome: 'expire', tEnd: 2000 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([35, 0]);
    expect(next.chain).toEqual([0, 0]);
    expect(next.hp).toEqual([1000, 1000]);
  });
});

describe('stepEvent — whiff', () => {
  it('costs the whiffing player 3 Focus; chain and HP untouched', () => {
    const state = { ...initialRoundState(), focus: [10, 0], chain: [3, 0] };
    const event = strike({ outcome: 'whiff', tEnd: 500 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([7, 0]);
    expect(next.chain).toEqual([3, 0]);
    expect(next.hp).toEqual([1000, 1000]);
  });
});

describe('stepEvent — KO tracking', () => {
  it('records koAt the first time a player\'s HP reaches 0, and never overwrites it', () => {
    let state = { ...initialRoundState(), hp: [1000, 50] };
    const lethal = strike({ moveId: 'crush', chars: 12, tStart: 0, tEnd: parMs(12), errors: 0 });
    state = stepEvent(state, lethal, [lethal]);
    expect(state.hp[1]).toBe(0);
    expect(state.koAt[1]).toBe(lethal.tEnd);

    const overkill = strike({ seq: 1, moveId: 'jab', chars: 4, tStart: 2000, tEnd: 2000 + parMs(4) });
    state = stepEvent(state, overkill, [lethal, overkill]);
    expect(state.hp[1]).toBe(0);
    expect(state.koAt[1]).toBe(lethal.tEnd); // unchanged
  });
});
