// src/lib/shadow/match.test.js
import { describe, it, expect } from 'vitest';
import { initialMatchState, applyRoundOutcome } from './match.js';

const outcome = (winner, hpRemaining = [500, 500]) => ({ winner, hpRemaining });

describe('initialMatchState', () => {
  it('starts at 0-0, no draws, in progress', () => {
    expect(initialMatchState()).toEqual({
      wins: [0, 0], draws: 0, roundsPlayed: 0,
      hpRemainingSum: [0, 0], phase: 'in-progress', outcome: null,
    });
  });
});

describe('applyRoundOutcome — §12.2-12.3, best of 3', () => {
  it('2-0: match completes after round 2, no sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    expect(state.phase).toBe('in-progress');
    state = applyRoundOutcome(state, outcome(0));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match', winner: 0 });
  });

  it('2-1: a normal round-3 decider, no sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(1));
    expect(state.phase).toBe('in-progress');
    state = applyRoundOutcome(state, outcome(0));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match', winner: 0 });
  });

  it('§12.4: 1-1-1 (one win each plus a draw) enters sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(null)); // round draw
    state = applyRoundOutcome(state, outcome(1));
    expect(state.wins).toEqual([1, 1]);
    expect(state.draws).toBe(1);
    expect(state.phase).toBe('sudden-death');
  });

  it('a draw at 0-0 does not trigger sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(null));
    expect(state.phase).toBe('in-progress');
  });

  it('a sudden-death round with a winner completes the match', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(null));
    state = applyRoundOutcome(state, outcome(1));
    expect(state.phase).toBe('sudden-death');
    state = applyRoundOutcome(state, outcome(1));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match', winner: 1 });
  });

  it('a sudden-death round that draws is a match draw', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(null));
    state = applyRoundOutcome(state, outcome(1));
    state = applyRoundOutcome(state, outcome(null));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match-draw', winner: null });
  });

  it('§12.3: 5 total rounds hard-stops the match and breaks ties on aggregate HP', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(null, [10, 10]));
    state = applyRoundOutcome(state, outcome(null, [20, 5]));
    state = applyRoundOutcome(state, outcome(null, [5, 20]));
    state = applyRoundOutcome(state, outcome(null, [30, 10]));
    expect(state.phase).toBe('in-progress');
    state = applyRoundOutcome(state, outcome(null, [10, 5]));
    expect(state.phase).toBe('complete');
    // sums: p0 = 10+20+5+30+10 = 75, p1 = 10+5+20+10+5 = 50
    expect(state.outcome).toEqual({ type: 'match', winner: 0 });
  });

  it('the 5-round hard stop draws the match if aggregate HP also ties', () => {
    let state = initialMatchState();
    for (let i = 0; i < 5; i += 1) {
      state = applyRoundOutcome(state, outcome(null, [10, 10]));
    }
    expect(state.outcome).toEqual({ type: 'match-draw', winner: null });
  });

  it('throws if called again after the match has completed', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(0));
    expect(() => applyRoundOutcome(state, outcome(0))).toThrow(/completed/i);
  });
});
