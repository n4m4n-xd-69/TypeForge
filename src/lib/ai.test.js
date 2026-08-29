import { describe, expect, it } from 'vitest';
import { extractJSON } from './ai.js';

/**
 * The code visualiser reported "Forge answered with something this app could
 * not parse" on replies that were mostly fine — cut off at the token ceiling
 * partway through the analysis shape, which is large enough that providers
 * routinely reach it. The old parser took `indexOf('{')` to `lastIndexOf('}')`
 * and gave up when that failed, discarding every complete field along with the
 * incomplete one.
 *
 * Mirrors supabase/functions/_shared/contracts.repair.test.ts, which covers the
 * server-side copy of the same logic.
 */
describe('extractJSON', () => {
  it('parses a clean object', () => {
    expect(extractJSON('{"a":1,"b":"two"}')).toEqual({ a: 1, b: 'two' });
  });

  it('unwraps a fenced object', () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose around the object', () => {
    expect(extractJSON('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('recovers a reply truncated inside an array of objects', () => {
    const cut = '{"summary":"does a thing","explanation":["one","two"],"flow":[{"id":"n1","step":"start"';
    const r = extractJSON(cut);
    expect(r.summary).toBe('does a thing');
    expect(r.explanation).toEqual(['one', 'two']);
  });

  it('recovers a reply truncated inside a string value', () => {
    const r = extractJSON('{"a":"one","b":"two","c":"the model stopped mid-sent');
    expect(r.a).toBe('one');
    expect(r.b).toBe('two');
  });

  it('drops a trailing comma left by the cut', () => {
    expect(extractJSON('{"a":1,"b":2,')).toEqual({ a: 1, b: 2 });
  });

  it('throws when there is no object at all', () => {
    expect(() => extractJSON('I am sorry, I cannot help with that.')).toThrow();
  });
});
