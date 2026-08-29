import { describe, expect, it } from 'vitest';
import { checkPassage, checkSnippet, extractJSON } from './contracts.ts';

/**
 * Regressions from replies seen in production.
 *
 * Two distinct failures were reported, with separate causes:
 *
 *   1. A JSON envelope reached the typing surface carrying the prompt's own
 *      `"label": "3-5 word description"` placeholder. The prompt showed an
 *      annotated shape, and smaller models copy what they are shown.
 *   2. The code visualiser reported "Forge answered with something this app
 *      could not parse" — a reply cut off at the token ceiling, discarded
 *      whole rather than for the complete fields it did contain.
 *
 * `src/lib/ai.test.js` covers the browser-side copy of the same parser.
 */

describe('extractJSON', () => {
  it('repairs a reply truncated at the token ceiling', () => {
    const truncated =
      '{"summary": "does a thing", "explanation": ["step one", "step two"], "flow": [{"id": "n1", "step": "start"';
    const parsed = extractJSON(truncated);
    expect(parsed).toBeTruthy();
    expect(parsed!.summary).toBe('does a thing');
    expect((parsed!.explanation as string[]).length).toBe(2);
  });

  it('repairs a cut inside a string value', () => {
    const parsed = extractJSON('{"a": "one", "b": "two", "c": "unterminated the model stopped mid');
    expect(parsed!.a).toBe('one');
    expect(parsed!.b).toBe('two');
  });

  it('returns null when there is no object at all', () => {
    expect(extractJSON('I am sorry, I cannot help with that.')).toBeNull();
    expect(extractJSON('')).toBeNull();
  });

  it('unwraps a fenced object', () => {
    expect(extractJSON('```json\n{"a": 1}\n```')?.a).toBe(1);
  });
});

describe('checkPassage', () => {
  const goodText =
    'Steady hands make steady work and the keyboard rewards patience over speed every time.';

  it('rejects a passage whose text is itself a JSON envelope', () => {
    const doubled = JSON.stringify({
      text: '{"text": "Learning code demands steady calm and deliberate craft", "label": "3-5 word description"}',
      label: 'x',
    });
    expect(checkPassage(doubled).ok).toBe(false);
  });

  it('drops an echoed label rather than failing good text', () => {
    const r = checkPassage(
      JSON.stringify({ text: goodText, label: '3-5 word description', author: 'name' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBeNull();
      expect(r.value.meta.author).toBeUndefined();
    }
  });

  it('keeps a real label and author', () => {
    const r = checkPassage(
      JSON.stringify({ text: goodText, label: 'Patience at the keys', author: 'Ada Lovelace' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe('Patience at the keys');
      expect(r.value.meta.author).toBe('Ada Lovelace');
    }
  });
});

describe('checkSnippet', () => {
  it('rejects a snippet whose code is the placeholder', () => {
    expect(checkSnippet(JSON.stringify({ code: 'the snippet', title: 'x' })).ok).toBe(false);
  });
});
