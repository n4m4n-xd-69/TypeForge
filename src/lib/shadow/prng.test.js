import { describe, it, expect } from 'vitest';
import { xorshift32, toU32, draw } from './prng.js';

describe('xorshift32', () => {
  it('matches a hand-verified reference value', () => {
    // Hand-traced: x=1 -> x^=x<<13 (1^8192=8193) -> x^=x>>>17 (8193>>>17=0,
    // no change) -> x^=x<<5 (8193^262176=270369).
    expect(xorshift32(1)).toBe(270369);
  });

  it('is deterministic: same input always gives the same output', () => {
    expect(xorshift32(42)).toBe(xorshift32(42));
  });

  it('returns an unsigned 32-bit integer', () => {
    const result = xorshift32(0xFFFFFFFF);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(4294967296);
  });

  it('0 is a fixed point (all XOR/shift operations on 0 stay 0) — callers must never seed with a value that reduces to 0', () => {
    expect(xorshift32(0)).toBe(0);
  });
});

describe('toU32', () => {
  it('passes through a small non-negative number unchanged', () => {
    expect(toU32(5)).toBe(5);
  });

  it('accepts a bigint', () => {
    expect(toU32(5n)).toBe(5);
  });

  it('wraps a value larger than 2^32', () => {
    expect(toU32(4294967296n + 5n)).toBe(5);
  });
});

describe('draw', () => {
  it('u is next/2^32, and next matches xorshift32', () => {
    const result = draw(1);
    expect(result.next).toBe(xorshift32(1));
    expect(result.u).toBe(xorshift32(1) / 4294967296);
  });

  it('u is always in [0, 1)', () => {
    for (const seed of [0, 1, 42, 0xFFFFFFFF, 12345]) {
      const { u } = draw(seed);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});
