import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS, MIN_PLAYERS, QUICK_PICKS, clampPlayerCount } from './capacity.js';

/**
 * Coverage for the Battlefield capacity picker's pure logic.
 *
 * The server already enforces 2–60 (migration 0028); this is the client-side
 * mirror the Custom number input clamps through before it ever reaches
 * `createBattle`, so a stray keystroke can't round-trip to the server as a
 * doomed RPC call.
 */

describe('clampPlayerCount', () => {
  it('passes through a value already inside range', () => {
    expect(clampPlayerCount(45)).toBe(45);
  });

  it('clamps below the minimum up to MIN_PLAYERS', () => {
    expect(clampPlayerCount(1)).toBe(MIN_PLAYERS);
    expect(clampPlayerCount(0)).toBe(MIN_PLAYERS);
    expect(clampPlayerCount(-5)).toBe(MIN_PLAYERS);
  });

  it('clamps above the maximum down to MAX_PLAYERS', () => {
    expect(clampPlayerCount(75)).toBe(MAX_PLAYERS);
    expect(clampPlayerCount(999)).toBe(MAX_PLAYERS);
  });

  it('rounds a fractional value to the nearest integer', () => {
    expect(clampPlayerCount(30.7)).toBe(31);
    expect(clampPlayerCount(30.4)).toBe(30);
  });

  it('falls back to MIN_PLAYERS for non-numeric input', () => {
    expect(clampPlayerCount('abc')).toBe(MIN_PLAYERS);
    expect(clampPlayerCount('')).toBe(MIN_PLAYERS);
    expect(clampPlayerCount(null)).toBe(MIN_PLAYERS);
    expect(clampPlayerCount(undefined)).toBe(MIN_PLAYERS);
    expect(clampPlayerCount(NaN)).toBe(MIN_PLAYERS);
  });

  it('accepts a numeric string', () => {
    expect(clampPlayerCount('12')).toBe(12);
  });
});

describe('QUICK_PICKS', () => {
  it('stays within [MIN_PLAYERS, MAX_PLAYERS] and tops out at 30', () => {
    expect(Math.min(...QUICK_PICKS)).toBe(MIN_PLAYERS);
    expect(Math.max(...QUICK_PICKS)).toBe(30);
    expect(Math.max(...QUICK_PICKS)).toBeLessThanOrEqual(MAX_PLAYERS);
  });
});
