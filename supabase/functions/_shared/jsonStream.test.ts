import { describe, expect, it } from 'vitest';
import { bodyFieldFor, JsonFieldStreamer } from './jsonStream.ts';
import { salvageBody } from './contracts.ts';

/** Feeds a reply through the streamer in arbitrary slices, as SSE does. */
function stream(field: string, chunks: string[]): string {
  const s = new JsonFieldStreamer(field);
  let out = '';
  for (const c of chunks) out += s.push(c);
  return out + s.flush();
}

describe('JsonFieldStreamer', () => {
  it('emits only the field contents, never the envelope', () => {
    const out = stream('text', ['{"text": "A quiet hill stands near the water", "label": "calm"}']);
    expect(out).toBe('A quiet hill stands near the water');
  });

  it('works when the envelope is split across chunk boundaries', () => {
    // The opening brace, the key and the value all arrive in separate frames.
    const out = stream('text', ['{"te', 'xt"', ' : ', '"Steady ', 'hands make ', 'steady work"', ', "label": "x"}']);
    expect(out).toBe('Steady hands make steady work');
  });

  it('decodes escapes rather than passing them through', () => {
    expect(stream('text', ['{"text": "He said \\"go\\" and left"}'])).toBe('He said "go" and left');
    expect(stream('code', ['{"code": "a\\nb\\tc"}'])).toBe('a\nb\tc');
  });

  it('stops at the closing quote and ignores later fields', () => {
    const out = stream('text', ['{"text": "only this", "label": "3-5 word description"}']);
    expect(out).toBe('only this');
  });

  it('falls back to passthrough when the model answers in prose', () => {
    // No envelope: a long plain reply must still reach the user.
    const prose = 'x'.repeat(300);
    expect(stream('text', [prose])).toBe(prose);
  });

  it('picks the right field per kind', () => {
    expect(bodyFieldFor('snippet')).toBe('code');
    expect(bodyFieldFor('passage')).toBe('text');
    expect(bodyFieldFor('quote')).toBe('text');
  });
});

describe('salvageBody', () => {
  it('extracts text from an envelope that failed the quality gate', () => {
    const raw = '{"text": "High above the rushing gorge the wood planks swayed", "label": "x"}';
    expect(salvageBody('passage', raw)).toBe('High above the rushing gorge the wood planks swayed');
  });

  it('keeps code formatting for snippets', () => {
    expect(salvageBody('snippet', '{"code": "const a = 1;\\nconst b = 2;"}')).toBe('const a = 1;\nconst b = 2;');
  });

  it('returns prose unchanged when there is no envelope', () => {
    expect(salvageBody('passage', 'Just some prose.')).toBe('Just some prose.');
  });

  it('returns null when there is nothing usable', () => {
    expect(salvageBody('passage', '{"label": "only a label"}')).toBeNull();
  });
});
