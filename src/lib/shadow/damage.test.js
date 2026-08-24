import { describe, it, expect } from 'vitest';
import {
  CONTEST, parMs, speedFactor, precisionFactor, chainMul, contestFactor,
  isCritical, critMul, computeDamage, reflectedDamage,
} from './damage.js';

describe('parMs', () => {
  it('§8.3: parMs(chars) = 60000 * (chars + 1) / (5 * 60)', () => {
    expect(parMs(7)).toBe(Math.round(60000 * 8 / 300)); // 1600
  });
});

describe('speedFactor', () => {
  it('is 1.00 exactly at par', () => {
    const par = parMs(7);
    expect(speedFactor(par, par)).toBeCloseTo(1.00, 5);
  });

  it('clamps at 1.40 for a much faster completion', () => {
    const par = parMs(7);
    expect(speedFactor(par, par / 3)).toBe(1.40);
  });

  it('clamps at 0.60 for a much slower completion', () => {
    const par = parMs(7);
    expect(speedFactor(par, par * 5)).toBe(0.60);
  });
});

describe('precisionFactor', () => {
  it('§8.4: the 4-tier table', () => {
    expect(precisionFactor(0)).toBe(1.25);
    expect(precisionFactor(1)).toBe(1.00);
    expect(precisionFactor(2)).toBe(0.80);
    expect(precisionFactor(3)).toBe(0.60);
    expect(precisionFactor(9)).toBe(0.60);
  });
});

describe('chainMul', () => {
  it('§11.3: 1 + min(0.05 * chain, 0.50), capping at chain 10', () => {
    expect(chainMul(0)).toBe(1.00);
    expect(chainMul(6)).toBeCloseTo(1.30, 5);
    expect(chainMul(10)).toBe(1.50);
    expect(chainMul(20)).toBe(1.50);
  });
});

describe('contestFactor', () => {
  it('§8.4: the contest-state table, default guardFactor 0.50', () => {
    expect(contestFactor(CONTEST.NEUTRAL)).toBe(1.00);
    expect(contestFactor(CONTEST.GUARDING)).toBe(0.50);
    expect(contestFactor(CONTEST.PARRYING)).toBe(0.00);
    expect(contestFactor(CONTEST.EXPOSED)).toBe(1.25);
    expect(contestFactor(CONTEST.COMMITTED)).toBe(1.50);
    expect(contestFactor(CONTEST.STAGGERED)).toBe(1.35);
  });

  it("Shuriken's guardFactor (0.85) overrides Guarding only", () => {
    expect(contestFactor(CONTEST.GUARDING, 0.85)).toBe(0.85);
    expect(contestFactor(CONTEST.NEUTRAL, 0.85)).toBe(1.00);
  });

  it('throws on an unknown state', () => {
    expect(() => contestFactor('confused')).toThrow(/unknown contest state/i);
  });
});

describe('isCritical / critMul', () => {
  it('§8.4: precision === 1.25 AND speed >= 1.25, both axes, no randomness', () => {
    expect(isCritical(1.25, 1.25)).toBe(true);
    expect(isCritical(1.25, 1.24)).toBe(false);
    expect(isCritical(1.00, 1.40)).toBe(false);
    expect(critMul(1.25, 1.30)).toBe(1.50);
    expect(critMul(1.00, 1.40)).toBe(1.00);
  });
});

// §8.5 worked examples, reproduced exactly (non-reflection rows — the
// reflection row is a combat.js/fixture concern, see Task 5 and Task 7).
describe('computeDamage — §8.5 worked examples', () => {
  it('Clean Slash at par, chain 0, neutral → 12.5', () => {
    const par = parMs(7);
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: par, errors: 0, chain: 0,
      contestState: CONTEST.NEUTRAL,
    });
    expect(tenths).toBe(125);
  });

  it('Same, opponent guarding → 6.3', () => {
    const par = parMs(7);
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: par, errors: 0, chain: 0,
      contestState: CONTEST.GUARDING, guardFactor: 0.50,
    });
    expect(tenths).toBe(63);
  });

  it('Clean Slash 30% under par, chain 6, neutral → Critical → 31.7', () => {
    const par = parMs(7);
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: par / 1.30, errors: 0, chain: 6,
      contestState: CONTEST.NEUTRAL,
    });
    expect(tenths).toBe(317);
  });

  it('Sloppy Crush, over par, opponent guarding → 3.4', () => {
    const par = parMs(12);
    const tenths = computeDamage({
      base: 16, chars: 12, actualMs: par / 0.70, errors: 3, chain: 0,
      contestState: CONTEST.GUARDING, guardFactor: 0.50,
    });
    expect(tenths).toBe(34);
  });

  it('Clean Jab into a committed opponent → 11.3', () => {
    const par = parMs(4);
    const tenths = computeDamage({
      base: 6, chars: 4, actualMs: par, errors: 0, chain: 0,
      contestState: CONTEST.COMMITTED,
    });
    expect(tenths).toBe(113);
  });

  it('Overdrive, clean, at par, chain 10, neutral → 56.3', () => {
    const par = parMs(18);
    const tenths = computeDamage({
      base: 30, chars: 18, actualMs: par, errors: 0, chain: 10,
      contestState: CONTEST.NEUTRAL,
    });
    expect(tenths).toBe(563);
  });

  it('Damage arithmetic is integer tenths — no float ever escapes', () => {
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: parMs(7), errors: 0, chain: 0,
      contestState: CONTEST.NEUTRAL,
    });
    expect(Number.isInteger(tenths)).toBe(true);
  });
});

describe('reflectedDamage — §10.7', () => {
  it('is 60% of the fully-computed (neutral-contest) incoming damage', () => {
    // A Slash that would have dealt 12.5 HP (125 tenths) at neutral —
    // reflected at 60% = 7.5 HP.
    expect(reflectedDamage(125)).toBe(75);
  });

  it('rounds once, to integer tenths', () => {
    expect(Number.isInteger(reflectedDamage(101))).toBe(true);
  });
});
