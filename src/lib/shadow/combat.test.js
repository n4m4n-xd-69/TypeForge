import { describe, it, expect } from 'vitest';
import { CONTEST, parMs } from './damage.js';
import { initialRoundState } from './roundState.js';
import { stepEvent, reduceRound, finalizeOutcome, DOUBLE_KO_WINDOW_MS, ROUND_TIME_CAP_MS } from './combat.js';

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

const guardLane = (overrides) => ({
  seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard',
  outcome: 'complete', tStart: 0, tEnd: 300, keystrokes: 4, errors: 0,
  ikiStats: [80, 5], moveId: 'guard', chars: 4, ...overrides,
});

describe('stepEvent — Guard', () => {
  it('grants +3 Focus unconditionally and follows the general chain rule', () => {
    const event = guardLane({ errors: 1 });
    const next = stepEvent(initialRoundState(), event, [event]);
    expect(next.focus).toEqual([3, 0]);
    expect(next.chain).toEqual([0, 0]); // 1 error: held
  });
});

describe('stepEvent — Parry', () => {
  it('success: +10 Focus, 0 damage to the parrier, 60% reflected to the attacker', () => {
    const parry = guardLane({ player: 0, moveId: 'parry', tStart: 100, tEnd: 500 });
    const attack = strike({ player: 1, moveId: 'slash', chars: 7, tStart: 0, tEnd: parMs(7) });
    let state = initialRoundState();
    const all = [parry, attack];
    state = stepEvent(state, parry, all);
    state = stepEvent(state, attack, all);
    expect(state.focus[0]).toBe(10);
    expect(state.hp[0]).toBe(1000); // parrier takes 0
    // §8.5: "Any strike into a successful Parry: 0 dealt, ~7.5 taken" (a
    // clean-at-par Slash's neutral damage is 12.5 HP; 60% of that is 7.5)
    expect(state.hp[1]).toBe(1000 - 75);
  });

  it('§10.7: a reflected strike never crits, even if the original strike would have', () => {
    // Slash at half of par (the same speed-doubling trick used by "taking
    // a Critical hit breaks the defender's chain" above) -> speed clamps
    // to 1.40 -> this strike WOULD be Critical if unsuppressed. It must
    // still be in flight when the parry resolves, so it overlaps [100,500).
    const parry = guardLane({ player: 0, moveId: 'parry', tStart: 100, tEnd: 500 });
    const attack = strike({ player: 1, moveId: 'slash', chars: 7, tStart: 0, tEnd: parMs(7) / 2 });
    let state = initialRoundState();
    const all = [parry, attack];
    state = stepEvent(state, parry, all);
    state = stepEvent(state, attack, all);

    // Hand-traced neutral damage with crit suppressed: speed 1.40 (clamped,
    // half of par), precision 1.25 (0 errors), chainFactor 1.00 (chain 0),
    // contest 1.00 (neutral), crit forced to 1.00:
    //   10 * 1.40 * 1.25 * 1.00 * 1.00 = 17.5 -> round(175) = 175 tenths
    // Reflected at 60%: round(175 * 0.60) = 105 tenths.
    // (Unsuppressed this strike is Critical -> neutral would be 263 tenths
    // and reflected 158 — a materially different, larger number, so this
    // assertion is a real discriminator between suppressed and not.)
    expect(state.hp[1]).toBe(1000 - 105);
  });

  it('failure: no Focus gain, and the fighter is Exposed for 600ms', () => {
    const parry = guardLane({ player: 0, moveId: 'parry', tStart: 0, tEnd: 50 });
    let state = stepEvent(initialRoundState(), parry, [parry]);
    expect(state.focus).toEqual([0, 0]);

    // A follow-up strike into the exposed window (50..650) takes contest
    // x1.25 — but it must start strictly after the parry's own tEnd (50).
    // If it started at or before 50 it would itself have been "in flight"
    // when the parry resolved, which would make the parry succeed against
    // it instead (findSuccessfulParryAgainst — Task 4) — the two checks
    // share the same strikeInFlightAt window, so a strike can't be both
    // "not yet started" (making the earlier parry fail) and "in flight"
    // (making it the parry's target) at once. Starting after tEnd, the
    // window (600ms) is still narrower than even the fastest strike's
    // at-par duration (Jab at 3 chars: parMs(3) = 800ms), so this
    // necessarily lands as a Critical too — the assertion computes the
    // expected damage from the actual resulting speed rather than
    // assuming a specific one, so that's accounted for either way.
    const par = parMs(3);
    const punish = strike({ player: 1, moveId: 'jab', chars: 3, tStart: 51, tEnd: 550 });
    state = stepEvent(state, punish, [parry, punish]);
    const speed = Math.min(1.40, Math.max(0.60, par / (punish.tEnd - punish.tStart)));
    const precision = 1.25; // errors: 0
    const crit = precision === 1.25 && speed >= 1.25 ? 1.50 : 1.00;
    const expectedTenths = Math.round(6 * speed * precision * 1.00 * 1.25 * crit * 10);
    expect(state.hp[0]).toBe(1000 - expectedTenths);
  });
});

describe('stepEvent — Mend', () => {
  it('costs 25 Focus and heals 12 HP', () => {
    const state = { ...initialRoundState(), hp: [600, 1000], focus: [40, 0] };
    const event = guardLane({ moveId: 'mend', tStart: 0, tEnd: 1100 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([15, 0]);
    expect(next.hp[0]).toBe(720); // 600 + 120 tenths
  });

  it('never heals past MAX_HP_TENTHS', () => {
    const state = { ...initialRoundState(), hp: [950, 1000], focus: [40, 0] };
    const event = guardLane({ moveId: 'mend', tStart: 0, tEnd: 1100 });
    const next = stepEvent(state, event, [event]);
    expect(next.hp[0]).toBe(1000);
  });
});

describe('finalizeOutcome — §12.3', () => {
  it('a single KO: the other player wins', () => {
    const state = { ...initialRoundState(), koAt: [null, 1500] };
    expect(finalizeOutcome(state, {}).outcome).toEqual({ type: 'ko', winner: 0 });
  });

  it('both KO within the 120ms window: double knockout, a draw', () => {
    const state = { ...initialRoundState(), koAt: [1500, 1500 + DOUBLE_KO_WINDOW_MS] };
    expect(finalizeOutcome(state, {}).outcome).toEqual({ type: 'double-ko', winner: null });
  });

  it('both KO more than 120ms apart: the earlier one lost', () => {
    const state = { ...initialRoundState(), koAt: [1500, 1500 + DOUBLE_KO_WINDOW_MS + 1] };
    expect(finalizeOutcome(state, {}).outcome).toEqual({ type: 'ko', winner: 1 });
  });

  it('time cap reached, HP differs: higher HP wins', () => {
    const state = { ...initialRoundState(), hp: [400, 600] };
    expect(finalizeOutcome(state, { timeUp: true }).outcome).toEqual({ type: 'time', winner: 1 });
  });

  it('time cap reached, HP tied: a round draw', () => {
    const state = { ...initialRoundState(), hp: [400, 400] };
    expect(finalizeOutcome(state, { timeUp: true }).outcome).toEqual({ type: 'time-draw', winner: null });
  });

  it('no KO, time not up: still open', () => {
    expect(finalizeOutcome(initialRoundState(), {}).outcome).toBeNull();
  });

  it('ROUND_TIME_CAP_MS is 90 seconds', () => {
    expect(ROUND_TIME_CAP_MS).toBe(90000);
  });
});

describe('reduceRound', () => {
  it('folds a full event log and finalizes the outcome in one call', () => {
    const event = strike({ tEnd: parMs(7) });
    const result = reduceRound([event]);
    expect(result.hp).toEqual([1000, 875]);
    expect(result.outcome).toBeNull(); // no KO, time not up
  });

  it('sorts by tEnd before folding, regardless of input order', () => {
    // Both strikes are the same player's, against the same opponent, so
    // this is a real discriminator: the second strike's chainMul depends
    // on whether the first (earlier tEnd) has already been folded. If
    // reduceRound folded input-array order instead of tEnd order, the two
    // calls below would disagree (second would see chain 0 in one and
    // chain 1 in the other) instead of matching.
    const first = strike({ seq: 0, player: 0, tStart: 0, tEnd: 500 });
    const second = strike({ seq: 1, player: 0, tStart: 600, tEnd: 1000 });
    const forward = reduceRound([first, second]);
    const reversed = reduceRound([second, first]);
    expect(reversed).toEqual(forward);
    expect(forward.chain[0]).toBe(2); // two clean completions, in tEnd order
  });

  it('accepts an initialState override for test convenience (e.g. pre-loaded Focus)', () => {
    const event = strike({ moveId: 'overdrive', chars: 18, tEnd: parMs(18) });
    const result = reduceRound([event], { initialState: { focus: [100, 0] } });
    expect(result.focus).toEqual([0, 0]);
  });

  it('reports a KO outcome once HP crosses 0', () => {
    const lethal = strike({ moveId: 'crush', chars: 12, tEnd: parMs(12) });
    const result = reduceRound([lethal], { initialState: { hp: [1000, 20] } });
    expect(result.outcome.type).toBe('ko');
    expect(result.outcome.winner).toBe(0);
  });

  it('sorts by tEnd, then player, then seq — same-tEnd events from different players fold deterministically', () => {
    // Player 0's critical strike on player 1 at tEnd 128 (fast jab, triggers critical).
    // Player 1's clean strike on player 0 at the same tEnd 128.
    // When player 0's strike folds first (player 0 < player 1), it zeroes player 1's chain
    // due to the critical hit. Then player 1's strike folds and increments it back to 1.
    // If we reverse input order, the sort should still produce the same fold order.
    const criticalStrike = strike({
      player: 0, moveId: 'jab', chars: 3, seq: 0,
      tStart: 0, tEnd: 128, // well under par -> speed 1.25+ -> critical
      errors: 0,
    });
    const respondingStrike = strike({
      player: 1, moveId: 'slash', chars: 7, seq: 0,
      tStart: 0, tEnd: 128, // same tEnd as the critical strike
      errors: 0,
    });

    const forward = reduceRound([criticalStrike, respondingStrike]);
    const reversed = reduceRound([respondingStrike, criticalStrike]);

    // Both orders should produce the same result due to deterministic tie-breaking
    expect(reversed).toEqual(forward);
    // Player 1's chain: starts at 0, then player 1's strike increments it to 1
    // (because player 0's critical strike resolves first and zeroes it, but then
    // player 1's clean strike increments it, all deterministically)
    expect(forward.chain[1]).toBe(1);
  });

  it('§12.4: a damageMul option scales all damage in the fold (sudden-death x1.25)', () => {
    // A clean Slash at par, chain 0, neutral deals 125 tenths with no
    // damageMul (the first stepEvent test above). With damageMul 1.25:
    //   10 * 1.00 * 1.25 * 1.00 * 1.00 * 1.00 * 1.25 = 15.625
    //   -> round(156.25) = 156 tenths, i.e. exactly 1.25x 125 rounded once.
    const event = strike({ tEnd: parMs(7) });
    const base = reduceRound([event]);
    const boosted = reduceRound([event], { damageMul: 1.25 });
    expect(base.hp).toEqual([1000, 875]); // 1000 - 125
    expect(boosted.hp).toEqual([1000, 844]); // 1000 - 156
  });
});
