import { describe, it, expect } from 'vitest';
import {
  buildTrialSessionPayload,
  getStoredBotProfile,
  setStoredBotProfile,
  LAST_BOT_PROFILE_KEY,
} from './trialSession.js';
import { createTrialMatch } from './trialEngine.js';
import { xpForSession } from '../gamification.js';

describe('buildTrialSessionPayload — SC-A2, SB-BOT-5', () => {
  it('constructs a session payload with Shadow Battle metadata and vs. bot label', () => {
    let match = createTrialMatch({ seed: 42, botProfileId: 'ronin', band: 'steel' });
    match.match = {
      ...match.match,
      phase: 'complete',
      wins: [2, 1],
      draws: 0,
      roundsPlayed: 3,
      hpRemainingSum: [1200, 800],
      outcome: { type: 'match', winner: 0 },
    };

    const run = {
      wpm: 68,
      accuracy: 97,
      consistency: 85,
      durationSec: 75,
      chars: 420,
      errors: 5,
      keyStats: {},
    };

    const payload = buildTrialSessionPayload({ match, run });
    expect(payload.kind).toBe('shadow');
    expect(payload.wpm).toBe(68);
    expect(payload.accuracy).toBe(97);
    expect(payload.opponentKind).toBe('bot');
    expect(payload.botProfile).toBe('ronin');
    expect(payload.roundsWon).toBe(2);
    expect(payload.roundsLost).toBe(1);
    expect(payload.matchWinner).toBe(0);
  });

  it('calculates valid positive XP awards for Shadow Battle sessions (SC-A4)', () => {
    const xp = xpForSession({ wpm: 60, accuracy: 96, durationSec: 60, kind: 'shadow' });
    expect(Number.isFinite(xp)).toBe(true);
    expect(xp).toBeGreaterThan(0);
  });
});

describe('getStoredBotProfile / setStoredBotProfile — SB-BOT-4', () => {
  it('reads and writes to localStorage correctly with fallback to adept', () => {
    const fakeStorage = new Map();
    const mockStorage = {
      getItem: (k) => fakeStorage.get(k) ?? null,
      setItem: (k, v) => fakeStorage.set(k, String(v)),
    };

    // Default fallback
    expect(getStoredBotProfile(mockStorage)).toBe('adept');

    // Store custom valid profile
    setStoredBotProfile(mockStorage, 'shade');
    expect(fakeStorage.get(LAST_BOT_PROFILE_KEY)).toBe('shade');
    expect(getStoredBotProfile(mockStorage)).toBe('shade');

    // Invalid stored value directly in storage falls back to adept
    mockStorage.setItem(LAST_BOT_PROFILE_KEY, 'corrupted_value');
    expect(getStoredBotProfile(mockStorage)).toBe('adept');
  });
});
