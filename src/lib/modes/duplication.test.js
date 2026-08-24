import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('DIFFICULTIES has exactly one definition', () => {
  it('is only ever array-literal-defined once, in content.js', () => {
    const files = walk(path.resolve('src'));
    const definitions = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /\bDIFFICULTIES\s*=\s*\[/.test(text);
    });
    expect(definitions).toEqual([path.resolve('src/lib/content.js')]);
  });
});
