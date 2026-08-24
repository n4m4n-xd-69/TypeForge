import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { reduceRound } from './combat.js';

function loadFixtures() {
  const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

function assertPartialMatch(actual, expected, path = '') {
  for (const [key, value] of Object.entries(expected)) {
    const label = path ? `${path}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      assertPartialMatch(actual[key], value, label);
    } else {
      expect(actual[key], label).toEqual(value);
    }
  }
}

describe('combat fixtures', () => {
  for (const fixture of loadFixtures()) {
    it(`${fixture.name} — ${fixture.description}`, () => {
      const result = reduceRound(fixture.events, fixture.options ?? {});
      assertPartialMatch(result, fixture.expected);
    });
  }
});
