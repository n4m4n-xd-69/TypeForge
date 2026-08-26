import { describe, it, expect } from 'vitest';
import { CONTEST } from './damage.js';
import {
  TIMING, MAX_HP_TENTHS, MAX_FOCUS,
  CHAIN_MILESTONE_STEP, CHAIN_MILESTONE_BONUS_FOCUS,
  initialRoundState, clampHp, clampFocus, nextChainValue,
  chainMilestoneBonus, strikeInFlightAt, parrySucceeded, deriveContestState,
} from './roundState.js';

describe('initialRoundState', () => {
  it('§11: HP 100 (1000 tenths), Focus 0, Chain 0, no history, no outcome', () => {
    expect(initialRoundState()).toEqual({
      hp: [1000, 1000], focus: [0, 0], chain: [0, 0],
      koAt: [null, null], history: [], outcome: null,
    });
  });
});

describe('clamps', () => {
  it('clampHp holds to [0, MAX_HP_TENTHS]', () => {
    expect(clampHp(-50)).toBe(0);
    expect(clampHp(MAX_HP_TENTHS + 100)).toBe(MAX_HP_TENTHS);
    expect(clampHp(500)).toBe(500);
  });

  it('clampFocus holds to [0, MAX_FOCUS]', () => {
    expect(clampFocus(-10)).toBe(0);
    expect(clampFocus(150)).toBe(MAX_FOCUS);
    expect(clampFocus(40)).toBe(40);
  });
});

describe('nextChainValue — §11.3', () => {
  it('0 errors: chain grows', () => {
    expect(nextChainValue(4, 0)).toBe(5);
  });
  it('1 error: chain holds (forgiven, but does not grow)', () => {
    expect(nextChainValue(4, 1)).toBe(4);
  });
  it('2+ errors: chain resets to 0', () => {
    expect(nextChainValue(4, 2)).toBe(0);
    expect(nextChainValue(4, 5)).toBe(0);
  });
});

describe('chainMilestoneBonus — §11.2', () => {
  it('crossing a multiple of 5 awards +5 Focus', () => {
    expect(chainMilestoneBonus(4, 5)).toBe(CHAIN_MILESTONE_BONUS_FOCUS);
    expect(chainMilestoneBonus(9, 10)).toBe(CHAIN_MILESTONE_BONUS_FOCUS);
  });
  it('not crossing a multiple of 5 awards nothing', () => {
    expect(chainMilestoneBonus(5, 6)).toBe(0);
    expect(chainMilestoneBonus(4, 0)).toBe(0); // a reset is not a crossing
  });
  it('CHAIN_MILESTONE_STEP is 5', () => {
    expect(CHAIN_MILESTONE_STEP).toBe(5);
  });
});

const strike = (overrides) => ({
  seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'strike',
  outcome: 'complete', tStart: 0, tEnd: 900, keystrokes: 7, errors: 0,
  ikiStats: [120, 15], moveId: 'slash', chars: 7, ...overrides,
});

describe('strikeInFlightAt', () => {
  it('true while tStart <= t < tEnd', () => {
    const s = strike({ tStart: 100, tEnd: 900 });
    expect(strikeInFlightAt(s, 100)).toBe(true);
    expect(strikeInFlightAt(s, 500)).toBe(true);
    expect(strikeInFlightAt(s, 899)).toBe(true);
  });
  it('false before tStart or at/after tEnd', () => {
    const s = strike({ tStart: 100, tEnd: 900 });
    expect(strikeInFlightAt(s, 99)).toBe(false);
    expect(strikeInFlightAt(s, 900)).toBe(false);
  });
});

describe('parrySucceeded — §10.3', () => {
  it('true when an opposing strike is in flight at the parry\'s tEnd', () => {
    const events = [
      strike({ seq: 0, player: 1, moveId: 'crush', tStart: 0, tEnd: 1500 }),
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 100, tEnd: 500, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    expect(parrySucceeded(events, events[1])).toBe(true);
  });

  it('false when no opposing strike is in flight', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 100, tEnd: 500, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    expect(parrySucceeded(events, events[0])).toBe(false);
  });
});

describe('deriveContestState — §8.4 priority: Committed > Guarding > Exposed > Staggered > Neutral', () => {
  it('Neutral with no history', () => {
    expect(deriveContestState([], 0, 1000)).toBe(CONTEST.NEUTRAL);
  });

  it('Guarding for GUARD_DURATION_MS after a completed Guard', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 300, keystrokes: 4, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 4 },
    ];
    expect(deriveContestState(events, 0, 300)).toBe(CONTEST.GUARDING);
    expect(deriveContestState(events, 0, 300 + TIMING.GUARD_DURATION_MS - 1)).toBe(CONTEST.GUARDING);
    expect(deriveContestState(events, 0, 300 + TIMING.GUARD_DURATION_MS)).toBe(CONTEST.NEUTRAL);
  });

  it('Committed for the duration of a Crush/Overdrive/Mend, even mid-move', () => {
    const events = [strike({ player: 0, moveId: 'crush', tStart: 0, tEnd: 1500 })];
    expect(deriveContestState(events, 0, 0)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 750)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 1500)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 1501)).toBe(CONTEST.NEUTRAL);
  });

  it('Exposed for EXPOSED_DURATION_MS after a failed Parry', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 400, keystrokes: 5, errors: 0, ikiStats: [80, 5], moveId: 'parry', chars: 5 },
    ];
    expect(deriveContestState(events, 0, 400)).toBe(CONTEST.EXPOSED);
    expect(deriveContestState(events, 0, 400 + TIMING.EXPOSED_DURATION_MS)).toBe(CONTEST.NEUTRAL);
  });

  it('a successful Parry does not expose', () => {
    const events = [
      strike({ seq: 0, player: 1, moveId: 'slash', tStart: 0, tEnd: 900 }),
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 100, tEnd: 500, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    expect(deriveContestState(events, 0, 500)).toBe(CONTEST.NEUTRAL);
  });

  it('Staggered for STAGGER_DURATION_MS after a card expires', () => {
    const events = [
      { ...strike({ player: 0, outcome: 'expire', tStart: 0, tEnd: 600 }) },
    ];
    expect(deriveContestState(events, 0, 600)).toBe(CONTEST.STAGGERED);
    expect(deriveContestState(events, 0, 600 + TIMING.STAGGER_DURATION_MS)).toBe(CONTEST.NEUTRAL);
  });

  it('Committed outranks a concurrent Guarding window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 100, keystrokes: 3, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 3 },
      strike({ seq: 1, player: 0, moveId: 'mend', lane: 'guard', tStart: 150, tEnd: 1250 }),
    ];
    // at t=200: both the Guard window (100..1300) and the Mend window (150..1250) cover it
    expect(deriveContestState(events, 0, 200)).toBe(CONTEST.COMMITTED);
  });

  it('a Committed move with outcome=expire still produces CONTEST.COMMITTED during [tStart, tEnd]', () => {
    const events = [
      strike({ player: 0, moveId: 'crush', outcome: 'expire', tStart: 100, tEnd: 1500 }),
    ];
    expect(deriveContestState(events, 0, 100)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 750)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 1500)).toBe(CONTEST.COMMITTED);
  });

  it('Guarding outranks a concurrent Exposed window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 100, keystrokes: 4, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 4 },
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 150, tEnd: 600, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    // at t=800: Guard window [100,1300) and Exposed window [600,1200) genuinely overlap
    expect(deriveContestState(events, 0, 800)).toBe(CONTEST.GUARDING);
  });

  it('Guarding outranks a concurrent Staggered window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 100, keystrokes: 4, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 4 },
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'strike', outcome: 'expire', tStart: 0, tEnd: 700, keystrokes: 7, errors: 0, ikiStats: [120, 15], moveId: 'slash', chars: 7 },
    ];
    // at t=1000: Guard window [100,1300) and Staggered window [700,1400) genuinely overlap
    expect(deriveContestState(events, 0, 1000)).toBe(CONTEST.GUARDING);
  });

  it('Exposed outranks a concurrent Staggered window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 200, keystrokes: 5, errors: 0, ikiStats: [80, 5], moveId: 'parry', chars: 5 },
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'strike', outcome: 'expire', tStart: 0, tEnd: 500, keystrokes: 7, errors: 0, ikiStats: [120, 15], moveId: 'slash', chars: 7 },
    ];
    // at t=650: Exposed window [200,800) and Staggered window [500,1200) genuinely overlap
    expect(deriveContestState(events, 0, 650)).toBe(CONTEST.EXPOSED);
  });

  it('Committed outranks a concurrent Exposed window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 400, keystrokes: 5, errors: 0, ikiStats: [80, 5], moveId: 'parry', chars: 5 },
      strike({ seq: 1, player: 0, moveId: 'crush', tStart: 300, tEnd: 1500 }),
    ];
    // at t=600: Exposed window (400..1000) and Committed window (300..1500) overlap
    expect(deriveContestState(events, 0, 600)).toBe(CONTEST.COMMITTED);
  });

  it('Committed outranks a concurrent Staggered window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'strike', outcome: 'expire', tStart: 0, tEnd: 600, keystrokes: 7, errors: 0, ikiStats: [120, 15], moveId: 'slash', chars: 7 },
      strike({ seq: 1, player: 0, moveId: 'crush', tStart: 500, tEnd: 1500 }),
    ];
    // at t=800: Staggered window (600..1300) and Committed window (500..1500) overlap
    expect(deriveContestState(events, 0, 800)).toBe(CONTEST.COMMITTED);
  });
});
