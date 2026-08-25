import { describe, it, expect } from 'vitest';
import { phraseFor } from './phraseTable.js';

describe('phraseTable', () => {
  it('phraseFor returns a phrase within the requested length range', () => {
    for (let i = 0; i < 20; i += 1) {
      const u = i / 20;
      const phrase = phraseFor(u, 10, 16);
      expect(phrase.length).toBeGreaterThanOrEqual(10);
      expect(phrase.length).toBeLessThanOrEqual(16);
    }
  });

  it('phraseFor(u, 14, 24, { requirePunctuation: true }) satisfies §9.3\'s Overdrive shape: 14-24 chars, multi-word, mixed case, at least one punctuation mark', () => {
    for (let i = 0; i < 20; i += 1) {
      const u = i / 20;
      const phrase = phraseFor(u, 14, 24, { requirePunctuation: true });
      expect(phrase.length).toBeGreaterThanOrEqual(14);
      expect(phrase.length).toBeLessThanOrEqual(24);
      expect(phrase.split(' ').length).toBeGreaterThanOrEqual(2); // multi-word
      expect(/[A-Z]/.test(phrase)).toBe(true); // mixed case: has an uppercase letter
      expect(/[a-z]/.test(phrase)).toBe(true); // and a lowercase letter
      expect(/[^A-Za-z0-9 ]/.test(phrase)).toBe(true); // at least one punctuation mark
    }
  });

  it('is deterministic: the same u always returns the same phrase', () => {
    expect(phraseFor(0.37, 10, 16)).toBe(phraseFor(0.37, 10, 16));
  });

  it('every phrase in the table is ASCII printable (SB-WRD-2)', () => {
    for (let i = 0; i < 60; i += 1) {
      const phrase = phraseFor(i / 60, 1, 24);
      for (const ch of phrase) {
        expect(ch.codePointAt(0)).toBeLessThanOrEqual(126);
      }
    }
  });

  it('throws a clear error if no phrase satisfies an impossible range', () => {
    expect(() => phraseFor(0.5, 1, 1)).toThrow(/no phrase/i);
  });
});
