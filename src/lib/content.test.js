import { describe, expect, it } from 'vitest';
import { QUOTES, QUOTE_LENGTHS, randomQuote } from './content.js';

/**
 * Quote mode.
 *
 * The failure this guards against is the one that made the mode feel broken:
 * drawing the same quote twice in a row. In a mode where the text *is* the
 * content, a repeat does not read as chance — it reads as the generator not
 * working. The length filter has the same character: it existed in the data
 * and was wired to nothing, so asking for a short quote did nothing at all.
 */
describe('QUOTES', () => {
  it('has enough quotes that each length band is a real choice', () => {
    // A three-quote band repeats constantly once someone picks that length.
    for (const band of ['short', 'medium', 'long']) {
      const n = QUOTES.filter((q) => q.length === band).length;
      expect(n, `${band} band has only ${n}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('gives every quote a text, an author and a known length', () => {
    for (const q of QUOTES) {
      expect(q.text.trim().length, q.text).toBeGreaterThan(10);
      expect(q.author.trim().length, q.text).toBeGreaterThan(0);
      expect(QUOTE_LENGTHS, q.text).toContain(q.length);
    }
  });

  it('has no duplicate quote text', () => {
    const texts = QUOTES.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('randomQuote', () => {
  it('respects the requested length', () => {
    for (const band of ['short', 'medium', 'long']) {
      for (let i = 0; i < 40; i++) {
        expect(randomQuote(band).length).toBe(band);
      }
    }
  });

  it('never returns the avoided quote when an alternative exists', () => {
    // The repeat guard, stated directly. Run enough times that a uniform draw
    // over the pool would hit the avoided quote many times over.
    const avoid = QUOTES[0].text;
    for (let i = 0; i < 300; i++) {
      expect(randomQuote('any', avoid).text).not.toBe(avoid);
    }
  });

  it('serves the right length even when that means repeating', () => {
    // Correct length beats novelty: being handed a long quote after asking for
    // a short one is a bigger surprise than seeing the same short one twice.
    const shorts = QUOTES.filter((q) => q.length === 'short');
    const result = randomQuote('short', shorts.map((q) => q.text).join('|'));
    expect(result.length).toBe('short');
  });

  it('covers the whole pool rather than favouring one quote', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(randomQuote('any').text);
    expect(seen.size).toBe(QUOTES.length);
  });

  it('falls back to the full pool for an unknown length', () => {
    expect(randomQuote('enormous')).toBeTruthy();
  });

  it('is deterministic when given a deterministic rng', () => {
    // Pinning the selection arithmetic: index 0 of the filtered pool.
    const first = randomQuote('any', null, () => 0);
    expect(first).toBe(QUOTES[0]);
  });
});
