import { describe, expect, it } from 'vitest';
import {
  IDENTITY_LINE, IDENTITY_PROMPT, IdentityFilter, violates, withIdentity,
} from './identity.ts';

/** Convenience: run a whole answer through the filter in one or more deltas. */
function run(deltas: string[]): { out: string; rewrote: boolean } {
  const f = new IdentityFilter();
  let out = '';
  for (const d of deltas) out += f.push(d);
  out += f.flush();
  return { out, rewrote: f.didRewrite };
}

describe('violates', () => {
  it('catches vendor names', () => {
    for (const s of [
      'I am Nemotron.', 'running on DeepSeek', 'powered by GLM',
      'this is Kimi', 'built on Gemma', 'MiniMax here', 'Qwen speaking',
      'via OpenRouter', 'an NVIDIA model', 'I am Claude', 'ChatGPT here',
    ]) {
      expect(violates(s), s).toBe(true);
    }
  });

  it('catches self-disclosure that names no vendor', () => {
    expect(violates('I am a large language model.')).toBe(true);
    expect(violates("I'm an AI model trained to help.")).toBe(true);
    expect(violates('As an AI language model, I cannot.')).toBe(true);
    expect(violates('I was created by a research lab.')).toBe(true);
  });

  it('does not fire on ordinary typing-coach prose', () => {
    for (const s of [
      'Your accuracy is 94% — try slowing down.',
      'The algorithm behind WPM is simple.',       // "algorithm" contains "glm"
      'Move to step 3 of the drill.',              // "step 3" is not "step-3"
      'Rest your fingers on the home row.',
      'A steady rhythm beats raw speed.',
      'Practice the numbers row for five minutes.',
    ]) {
      expect(violates(s), s).toBe(false);
    }
  });

  it('is word-anchored, not substring matching', () => {
    // The regression these guard: a clamp that blanks half the coach's
    // vocabulary is worse than the leak it prevents.
    expect(violates('algorithmic')).toBe(false);
    expect(violates('stepping')).toBe(false);
    expect(violates('nemophila')).toBe(false);
  });
});

describe('withIdentity', () => {
  it('prepends the identity block', () => {
    expect(withIdentity('Be brief.')).toBe(`${IDENTITY_PROMPT}\n\nBe brief.`);
    expect(withIdentity()).toBe(IDENTITY_PROMPT);
  });
});

describe('IdentityFilter', () => {
  it('passes clean prose through unchanged', () => {
    const text = 'Your accuracy is 94%. Try slowing down. You will speed up again.';
    const { out, rewrote } = run([text]);
    expect(out).toBe(text);
    expect(rewrote).toBe(false);
  });

  it('preserves text across arbitrary delta boundaries', () => {
    const text = 'Keep your wrists level. Breathe. Then go again.';
    const perChar = run(text.split(''));
    expect(perChar.out).toBe(text);
  });

  it('rewrites a sentence that names a vendor', () => {
    const { out, rewrote } = run(['I am powered by Nemotron. Now, your drill.']);
    expect(out).not.toMatch(/nemotron/i);
    expect(out).toContain(IDENTITY_LINE);
    expect(out).toContain('Now, your drill.');
    expect(rewrote).toBe(true);
  });

  it('catches a vendor name split across two deltas', () => {
    // The failure a per-delta scan cannot see.
    const { out } = run(['I run on nemo', 'tron, actually. Anyway.']);
    expect(out).not.toMatch(/nemotron/i);
    expect(out).toContain(IDENTITY_LINE);
  });

  it('catches a name split across many single-character deltas', () => {
    const { out } = run('I am DeepSeek. Hello.'.split(''));
    expect(out).not.toMatch(/deepseek/i);
    expect(out).toContain('Hello.');
  });

  it('only rewrites the offending sentence', () => {
    const { out } = run([
      'Your accuracy is 94%. I am built on GLM. Keep practising.',
    ]);
    expect(out).toContain('Your accuracy is 94%.');
    expect(out).toContain('Keep practising.');
    expect(out).not.toMatch(/\bglm\b/i);
  });

  it('never rewrites inside a fenced code block', () => {
    // A snippet that legitimately mentions llama.cpp must survive intact.
    const src = 'Here is one:\n```c\n#include "llama.cpp"\nint main(){}\n```\nType it.';
    const { out } = run([src]);
    expect(out).toBe(src);
  });

  it('handles a fence arriving in pieces', () => {
    const src = 'Try:\n``' + '`js\nconst gemma = 1;\n``' + '`\nDone.';
    const { out } = run(src.split(''));
    expect(out).toBe(src);
  });

  it('still clamps prose that follows a code block', () => {
    const { out } = run([
      'Here:\n```js\nconst llama = 1;\n```\nI am running on Qwen. Bye.',
    ]);
    expect(out).toContain('const llama = 1;');   // inside the fence, untouched
    expect(out).not.toMatch(/qwen/i);            // outside it, clamped
    expect(out).toContain('Bye.');
  });

  it('does not stall on a very long sentence with no terminator', () => {
    const long = 'word '.repeat(200);
    const f = new IdentityFilter();
    const emitted = f.push(long);
    // Something must come out before flush, or the stream would arrive as a
    // single burst at the end.
    expect(emitted.length).toBeGreaterThan(0);
  });

  it('loses nothing when the stream ends mid-sentence', () => {
    const { out } = run(['An unfinished thought']);
    expect(out).toBe('An unfinished thought');
  });

  it('emits nothing for empty deltas', () => {
    const f = new IdentityFilter();
    expect(f.push('')).toBe('');
    expect(f.flush()).toBe('');
  });

  it('treats a newline as a sentence boundary', () => {
    const f = new IdentityFilter();
    const out = f.push('First line\n');
    expect(out).toBe('First line\n');
  });
});
