import { describe, expect, it } from 'vitest';
import { buildSessionPayload } from './sessionContract.js';

const run = {
  wpm: 74, accuracy: 97.2, consistency: 88, durationSec: 60.4,
  chars: 320, errors: 6, keyStats: { a: { total: 40, wrong: 1 } },
};

describe('buildSessionPayload', () => {
  it('builds the exact 12-field shape for a text mode', () => {
    const payload = buildSessionPayload({ modeId: 'time', difficulty: 'normal', run });
    expect(Object.keys(payload).sort()).toEqual(
      ['accuracy', 'chars', 'consistency', 'difficulty', 'durationSec', 'errors', 'kind', 'keyStats', 'lang', 'mode', 'ts', 'wpm'].sort(),
    );
    expect(payload).toMatchObject({
      kind: 'text', mode: 'time', difficulty: 'normal', lang: null,
      wpm: 74, accuracy: 97.2, consistency: 88, durationSec: 60.4,
      chars: 320, errors: 6, keyStats: run.keyStats,
    });
    expect(new Date(payload.ts).toString()).not.toBe('Invalid Date');
  });

  it('sets kind and lang correctly for the code mode', () => {
    const payload = buildSessionPayload({ modeId: 'code', difficulty: 'hard', run, lang: 'rust' });
    expect(payload.kind).toBe('code');
    expect(payload.lang).toBe('rust');
  });

  it('sets kind correctly for battle, and carries mode-specific meta through untouched', () => {
    const payload = buildSessionPayload({
      modeId: 'battle', difficulty: 'expert', run,
      meta: { roomId: 'abc123', rank: 2 },
    });
    expect(payload.kind).toBe('battle');
    expect(payload.roomId).toBe('abc123');
    expect(payload.rank).toBe(2);
  });

  it('throws for an unregistered mode id', () => {
    expect(() => buildSessionPayload({ modeId: 'not-a-mode', difficulty: 'normal', run })).toThrow();
  });
});
