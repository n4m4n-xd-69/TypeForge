import { describe, expect, it } from 'vitest';
import { xpForSession } from './gamification.js';

describe('xpForSession', () => {
  const baseParams = { wpm: 80, accuracy: 97, durationSec: 60 };

  it('preserves pre-refactor XP for text kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'text' })).toBe(103);
  });

  it('preserves pre-refactor XP for code kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'code' })).toBe(129);
  });

  it('preserves pre-refactor XP for battle kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'battle' })).toBe(119);
  });

  it('preserves pre-refactor XP for unregistered kind (defaults to 1)', () => {
    expect(xpForSession({ ...baseParams, kind: 'made-up-kind' })).toBe(103);
  });

  it('default kind parameter is text', () => {
    expect(xpForSession({ ...baseParams })).toBe(xpForSession({ ...baseParams, kind: 'text' }));
  });

  it('preserves pre-refactor XP for code with hard difficulty', () => {
    expect(xpForSession({ ...baseParams, kind: 'code', difficulty: 'hard' })).toBe(155);
  });
});
