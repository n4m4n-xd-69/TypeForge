import { describe, expect, it } from 'vitest';
import { extractBattlePin } from './api.js';
import { MAX_BYTES, validatePhoto } from './photo.js';

/**
 * Battlefield-code extraction.
 *
 * This runs over text a person typed, and the output becomes a join button. So
 * the failure that matters is not "missed a code" — it is "turned an ordinary
 * word into a room code", which produces a feed full of buttons that go
 * nowhere. The bare-code rule requires a digit for exactly that reason, and
 * these tests pin the boundary in both directions.
 */
describe('extractBattlePin', () => {
  it('reads a code out of a full invite link', () => {
    expect(extractBattlePin('join me https://typeforge.app/battle/AB12CD now')).toBe('AB12CD');
  });

  it('uppercases a lowercase link code', () => {
    expect(extractBattlePin('http://localhost:5173/battle/ab12cd')).toBe('AB12CD');
  });

  it('reads a bare code typed on its own', () => {
    expect(extractBattlePin('room AB12CD, come on')).toBe('AB12CD');
  });

  it('does not mistake an ordinary six-letter word for a code', () => {
    // The whole reason bare codes must contain a digit.
    expect(extractBattlePin('ANYONE up for a race')).toBeNull();
    expect(extractBattlePin('BATTLE time')).toBeNull();
  });

  it('ignores strings of the wrong length', () => {
    expect(extractBattlePin('AB12C')).toBeNull();
    expect(extractBattlePin('AB12CDE')).toBeNull();
  });

  it('prefers a link over a bare candidate elsewhere in the text', () => {
    expect(extractBattlePin('ZZ99ZZ but really /battle/AB12CD')).toBe('AB12CD');
  });

  it('is safe on non-strings and empty input', () => {
    expect(extractBattlePin(null)).toBeNull();
    expect(extractBattlePin(undefined)).toBeNull();
    expect(extractBattlePin('')).toBeNull();
    expect(extractBattlePin(42)).toBeNull();
  });
});

describe('validatePhoto', () => {
  const file = (type, size) => ({ type, size, name: 'photo' });

  it('accepts the supported formats', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(validatePhoto(file(type, 1000)), type).toBeNull();
    }
  });

  it('rejects an unsupported type with a message naming the alternatives', () => {
    const message = validatePhoto(file('application/pdf', 1000));
    expect(message).toMatch(/PNG/);
  });

  it('rejects an oversized file and says how big it actually is', () => {
    // "Too large" alone leaves the person guessing at what would fit.
    const message = validatePhoto(file('image/png', MAX_BYTES + 1));
    expect(message).toMatch(/2\.0 MB/);
    expect(message).toMatch(/limit is 2 MB/);
  });

  it('accepts a file exactly at the limit', () => {
    expect(validatePhoto(file('image/png', MAX_BYTES))).toBeNull();
  });

  it('asks for a file when given none', () => {
    expect(validatePhoto(null)).toMatch(/Choose an image/);
  });
});
