import { describe, expect, it } from 'vitest';
import { getMode, MODE_REGISTRY } from './registry.js';

const REQUIRED_FIELDS = [
  'id', 'name', 'description', 'icon', 'route', 'category',
  'kind', 'scored', 'multiplayer', 'requiresCloud', 'difficulties', 'xpRule',
];

describe('MODE_REGISTRY', () => {
  it('has exactly the 8 existing modes', () => {
    expect(MODE_REGISTRY.map((m) => m.id).sort()).toEqual(
      ['battle', 'code', 'custom', 'drill', 'quote', 'time', 'words', 'zen'].sort(),
    );
  });

  it('every entry has every MR-2-required field', () => {
    for (const mode of MODE_REGISTRY) {
      for (const field of REQUIRED_FIELDS) {
        expect(mode, `${mode.id} is missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it('every id is unique', () => {
    const ids = MODE_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('routes match the existing app routes', () => {
    expect(getMode('time').route).toBe('/practice?mode=time');
    expect(getMode('words').route).toBe('/practice?mode=words');
    expect(getMode('quote').route).toBe('/practice?mode=quote');
    expect(getMode('drill').route).toBe('/practice?mode=drill');
    expect(getMode('custom').route).toBe('/practice?mode=custom');
    expect(getMode('zen').route).toBe('/practice?mode=zen');
    expect(getMode('code').route).toBe('/code');
    expect(getMode('battle').route).toBe('/battle');
  });

  it('zen is the only unscored mode, matching current behaviour', () => {
    expect(MODE_REGISTRY.filter((m) => m.scored === false).map((m) => m.id)).toEqual(['zen']);
  });

  it('battle is the only multiplayer mode', () => {
    expect(MODE_REGISTRY.filter((m) => m.multiplayer).map((m) => m.id)).toEqual(['battle']);
  });

  it('getMode returns undefined for an unknown id', () => {
    expect(getMode('nonexistent')).toBeUndefined();
  });
});
