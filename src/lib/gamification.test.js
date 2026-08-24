import { describe, expect, it } from 'vitest';
import { xpForSession } from './gamification.js';

describe('xpForSession', () => {
  const base = { wpm: 75, accuracy: 95, durationSec: 60 };

  it('matches the pre-refactor numbers for text', () => {
    expect(xpForSession({ ...base, kind: 'text' })).toBe(xpForSession({ ...base }));
  });
  it('matches the pre-refactor numbers for code (1.25x)', () => {
    const text = xpForSession({ ...base, kind: 'text' });
    const code = xpForSession({ ...base, kind: 'code' });
    expect(code).toBe(Math.max(5, Math.round(text * 1.25)));
  });
  it('matches the pre-refactor numbers for battle (1.15x)', () => {
    const text = xpForSession({ ...base, kind: 'text' });
    const battle = xpForSession({ ...base, kind: 'battle' });
    expect(battle).toBe(Math.max(5, Math.round(text * 1.15)));
  });
});
