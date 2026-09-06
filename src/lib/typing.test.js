import { describe, expect, it } from 'vitest';
import {
  accuracyPct, consistencyPct, countCorrect, diffChars, grossWPM, netWPM, CHAR_STATE,
} from './typing.js';

/**
 * The typing maths, pinned.
 *
 * These are the numbers on the results screen and the numbers the Battlefield
 * ranks on, and until now nothing tested them. Each case below states a
 * definition rather than a current behaviour, so a change that alters what WPM
 * *means* has to change a test that says so out loud.
 */

describe('netWPM', () => {
  it('is (correct chars / 5) / minutes', () => {
    // 300 correct characters in one minute = 60 words per minute.
    expect(netWPM(300, 60_000)).toBe(60);
  });

  it('scales linearly with time', () => {
    expect(netWPM(300, 30_000)).toBe(120);
    expect(netWPM(150, 60_000)).toBe(30);
  });

  it('returns 0 for a zero or negative span rather than Infinity', () => {
    // The old guard was `elapsedMs < 500`, which reported a flat 0 for the
    // first half second and then jumped straight to a three-figure rate. The
    // only value that genuinely cannot be computed is a non-positive span.
    expect(netWPM(10, 0)).toBe(0);
    expect(netWPM(10, -5)).toBe(0);
  });

  it('reports an honest rate inside the first second', () => {
    // 10 correct characters in 600ms is 200 WPM, and saying so beats saying 0.
    expect(netWPM(10, 600)).toBeCloseTo(200, 5);
  });

  it('never returns a negative rate', () => {
    expect(netWPM(-4, 60_000)).toBe(0);
  });
});

describe('grossWPM', () => {
  it('counts every character typed, right or wrong', () => {
    expect(grossWPM(300, 60_000)).toBe(60);
  });
});

describe('accuracyPct', () => {
  it('is correct keystrokes over total keystrokes', () => {
    expect(accuracyPct(90, 100)).toBe(90);
  });

  it('is 100 before a single key is pressed', () => {
    expect(accuracyPct(0, 0)).toBe(100);
  });

  it('counts a corrected mistake against you', () => {
    // Three keys pressed, one of them wrong, then fixed: the fix is a fourth
    // keystroke and the mistake still happened.
    expect(accuracyPct(3, 4)).toBe(75);
  });

  it('clamps to 0..100 rather than trusting its caller', () => {
    expect(accuracyPct(120, 100)).toBe(100);
    expect(accuracyPct(-5, 100)).toBe(0);
  });
});

describe('consistencyPct', () => {
  it('is null when there are too few samples to measure', () => {
    // Not 0. Zero is a measurement — "you were maximally erratic" — and a
    // two-second quote run had no way to earn it. `gradeRun` renormalises
    // around null rather than docking a grade for a number nobody produced.
    expect(consistencyPct([])).toBeNull();
    expect(consistencyPct([40, 42])).toBeNull();
  });

  it('is 100 for a perfectly steady run', () => {
    expect(consistencyPct([50, 50, 50, 50])).toBe(100);
  });

  it('falls as the samples spread out', () => {
    const steady = consistencyPct([50, 51, 49, 50]);
    const erratic = consistencyPct([20, 80, 30, 70]);
    expect(steady).toBeGreaterThan(erratic);
  });
});

describe('countCorrect', () => {
  it('counts characters matching at their own position', () => {
    expect(countCorrect('hello', 'hello')).toBe(5);
    expect(countCorrect('hello', 'hallo')).toBe(4);
    expect(countCorrect('hello', 'he')).toBe(2);
  });

  it('does not credit a correct character sitting at the wrong index', () => {
    // "ehllo" has every letter of "hello" and only two of them are in place.
    expect(countCorrect('hello', 'ehllo')).toBe(3);
  });
});

describe('diffChars', () => {
  it('marks pending, correct and wrong', () => {
    const states = diffChars('abc', 'ax', new Set());
    expect(states).toEqual([CHAR_STATE.CORRECT, CHAR_STATE.WRONG, CHAR_STATE.PENDING]);
  });

  it('marks a fixed mistake as corrected, typed or not', () => {
    const everWrong = new Set([1]);
    expect(diffChars('abc', 'ab', everWrong)[1]).toBe(CHAR_STATE.CORRECTED);
    expect(diffChars('abc', 'a', everWrong)[1]).toBe(CHAR_STATE.CORRECTED);
  });
});
