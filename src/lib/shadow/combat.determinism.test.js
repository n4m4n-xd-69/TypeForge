import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// SB-CMB-2: no Math.random, no Date.now, anywhere in the reducer module set.
const MODULES = ['combat.js', 'damage.js', 'roundState.js', 'moveTable.js', 'match.js'];

describe('determinism guard', () => {
  for (const name of MODULES) {
    it(`${name} contains no Math.random or Date.now`, () => {
      const path = fileURLToPath(new URL(`./${name}`, import.meta.url));
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/Math\.random/);
      expect(source).not.toMatch(/Date\.now/);
    });
  }
});
