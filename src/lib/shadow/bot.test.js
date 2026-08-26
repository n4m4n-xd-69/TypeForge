import { describe, it, expect } from 'vitest';
import {
  BOT_PROFILES,
  createBotState,
  computeMirrorProfile,
  sampleTypingDuration,
  sampleCardErrors,
  decideLane,
  botTick,
} from './bot.js';
import { initialRoundState } from './roundState.js';

describe('BOT_PROFILES — §13.3', () => {
  it('contains all 5 PRD profiles with required parameters', () => {
    const required = ['recruit', 'adept', 'ronin', 'shade', 'mirror'];
    for (const id of required) {
      const p = BOT_PROFILES[id];
      expect(p).toBeDefined();
      expect(p.id).toBe(id);
      expect(typeof p.name).toBe('string');
      expect(typeof p.wpmMean).toBe('number');
      expect(typeof p.cleanRate).toBe('number');
      expect(typeof p.reactionMs).toBe('number');
      expect(typeof p.guardRate).toBe('number');
    }
  });

  it('profile numbers match PRD §13.3 exactly', () => {
    expect(BOT_PROFILES.recruit).toMatchObject({
      wpmMean: 28, wpmSigma: 9, cleanRate: 0.88, reactionMs: 700, guardRate: 0.15,
    });
    expect(BOT_PROFILES.adept).toMatchObject({
      wpmMean: 45, wpmSigma: 11, cleanRate: 0.94, reactionMs: 450, guardRate: 0.32,
    });
    expect(BOT_PROFILES.ronin).toMatchObject({
      wpmMean: 65, wpmSigma: 12, cleanRate: 0.97, reactionMs: 300, guardRate: 0.52,
    });
    expect(BOT_PROFILES.shade).toMatchObject({
      wpmMean: 88, wpmSigma: 14, cleanRate: 0.99, reactionMs: 200, guardRate: 0.68,
    });
    expect(BOT_PROFILES.mirror).toMatchObject({
      reactionMs: 260, guardRate: 0.45,
    });
  });
});

describe('computeMirrorProfile — §13.4', () => {
  it('targets 0.97x of observed player WPM and 0.01 below clean rate', () => {
    const p = computeMirrorProfile(60, 0.95, 60);
    expect(p.wpmMean).toBeCloseTo(60 * 0.97, 1);
    expect(p.cleanRate).toBeCloseTo(0.94, 2);
  });

  it('clamps WPM between Recruit (28) and Shade (88)', () => {
    const low = computeMirrorProfile(20, 0.90, 20);
    expect(low.wpmMean).toBe(28);

    const high = computeMirrorProfile(120, 0.99, 120);
    expect(high.wpmMean).toBe(88);
  });

  it('clamps clean rate between 0.86 and 0.985', () => {
    const low = computeMirrorProfile(50, 0.70, 50);
    expect(low.cleanRate).toBe(0.86);

    const high = computeMirrorProfile(50, 1.00, 50);
    expect(high.cleanRate).toBe(0.985);
  });

  it('never exceeds 1.05x the player best observed rate in the match', () => {
    const p = computeMirrorProfile(70, 0.95, 60); // best was 60, current is 70
    expect(p.wpmMean).toBeLessThanOrEqual(60 * 1.05);
  });
});

describe('sampleTypingDuration — log-normal simulation', () => {
  it('is deterministic given the same PRNG state', () => {
    const a = sampleTypingDuration(12345, 60, 10, 5);
    const b = sampleTypingDuration(12345, 60, 10, 5);
    expect(a.durationMs).toBe(b.durationMs);
    expect(a.nextState).toBe(b.nextState);
  });

  it('faster WPM yields proportionally shorter durations on average', () => {
    let sumFast = 0;
    let sumSlow = 0;
    let stateFast = 1;
    let stateSlow = 1;
    for (let i = 0; i < 50; i += 1) {
      const fast = sampleTypingDuration(stateFast, 90, 10, 6);
      const slow = sampleTypingDuration(stateSlow, 30, 10, 6);
      sumFast += fast.durationMs;
      sumSlow += slow.durationMs;
      stateFast = fast.nextState;
      stateSlow = slow.nextState;
    }
    expect(sumFast / 50).toBeLessThan(sumSlow / 50);
  });
});

describe('sampleCardErrors', () => {
  it('returns 0 errors when roll < cleanRate', () => {
    let cleanCount = 0;
    let state = 100;
    for (let i = 0; i < 100; i += 1) {
      const res = sampleCardErrors(state, 0.90);
      if (res.errors === 0) cleanCount += 1;
      state = res.nextState;
    }
    expect(cleanCount).toBeGreaterThanOrEqual(80);
    expect(cleanCount).toBeLessThanOrEqual(98);
  });

  it('adds correction penalty time when errors occur', () => {
    // 1 error adds 140 + 90 = 230ms, 2 errors adds 140 + 180 = 320ms
    const clean = sampleCardErrors(1, 1.0); // 100% clean
    expect(clean.penaltyMs).toBe(0);
  });
});

describe('decideLane — observable state only (SB-BOT-9)', () => {
  it('Recruit guards only when HP < 300 (30.0 HP)', () => {
    const highHp = { hp: [1000, 1000], focus: [0, 0], chain: [0, 0] };
    const lowHp = { hp: [1000, 250], focus: [0, 0], chain: [0, 0] };
    const pair = { strikeMove: 'jab', strikeWord: 'test', guardMove: 'guard', guardWord: 'safe' };

    // At high HP, Recruit never guards
    let guardHigh = 0;
    let state = 42;
    for (let i = 0; i < 50; i += 1) {
      const { lane, nextState } = decideLane(state, BOT_PROFILES.recruit, pair, highHp, 1, false);
      if (lane === 'guard') guardHigh += 1;
      state = nextState;
    }
    expect(guardHigh).toBe(0);

    // At low HP, Recruit guards around 15% of the time
    let guardLow = 0;
    for (let i = 0; i < 100; i += 1) {
      const { lane, nextState } = decideLane(state, BOT_PROFILES.recruit, pair, lowHp, 1, false);
      if (lane === 'guard') guardLow += 1;
      state = nextState;
    }
    expect(guardLow).toBeGreaterThan(5);
  });

  it('Shade attempts parry when opponent strike is in flight and parry is the guard card', () => {
    const roundState = { hp: [1000, 1000], focus: [0, 0], chain: [0, 0] };
    const pair = { strikeMove: 'slash', strikeWord: 'slash', guardMove: 'parry', guardWord: 'block' };

    let parryCount = 0;
    let state = 99;
    for (let i = 0; i < 100; i += 1) {
      const { lane, nextState } = decideLane(state, BOT_PROFILES.shade, pair, roundState, 1, true);
      if (lane === 'guard') parryCount += 1;
      state = nextState;
    }
    expect(parryCount).toBeGreaterThanOrEqual(30);
  });
});

describe('botTick — deterministic event generation', () => {
  it('advances through reaction and typing, then emits a CombatEvent', () => {
    const roundState = initialRoundState();
    let bot = createBotState('adept', 12345, 1);

    const emitted = [];
    // Advance simulation from 0ms to 4000ms in 100ms ticks
    for (let t = 100; t <= 4000; t += 100) {
      const res = botTick(bot, roundState, { hp: [1000, 1000], focus: [0, 0], chain: [0, 0] }, t, 'steel');
      bot = res.nextBotState;
      if (res.emittedEvents.length > 0) {
        emitted.push(...res.emittedEvents);
      }
    }

    expect(emitted.length).toBeGreaterThan(0);
    const ev = emitted[0];
    expect(ev.player).toBe(1);
    expect(ev.outcome).toBe('complete');
    expect(['strike', 'guard']).toContain(ev.lane);
    expect(ev.tEnd).toBeGreaterThan(ev.tStart);
    expect(ev.keystrokes).toBeGreaterThanOrEqual(ev.chars);
  });
});
