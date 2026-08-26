import { BOT_PROFILES } from './bot.js';

export const LAST_BOT_PROFILE_KEY = 'typeforge:shadow:last_bot_profile';

const VALID_PROFILES = Object.keys(BOT_PROFILES);

/**
 * §7.1 / SB-BOT-4: Get last-used bot profile with fallback to 'adept'.
 */
export function getStoredBotProfile(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const stored = storage?.getItem(LAST_BOT_PROFILE_KEY);
    if (stored && VALID_PROFILES.includes(stored)) {
      return stored;
    }
  } catch {
    // Storage access failure (e.g. privacy mode) fallback
  }
  return 'adept';
}

/**
 * §7.1 / SB-BOT-4: Set last-used bot profile in storage.
 */
export function setStoredBotProfile(storage = typeof localStorage !== 'undefined' ? localStorage : null, profileId) {
  try {
    if (VALID_PROFILES.includes(profileId)) {
      storage?.setItem(LAST_BOT_PROFILE_KEY, profileId);
    }
  } catch {
    // Ignore storage write failures
  }
}

/**
 * Construct a session payload for Trial Mode compliant with the session contract
 * (SC-A2, SB-BOT-5).
 */
export function buildTrialSessionPayload({ match, run, ts = new Date().toISOString() }) {
  return {
    ts,
    kind: 'shadow',
    mode: 'shadow-trial',
    difficulty: match.band ?? 'steel',
    lang: null,
    wpm: run.wpm,
    accuracy: run.accuracy,
    consistency: run.consistency ?? 0,
    durationSec: run.durationSec,
    chars: run.chars,
    errors: run.errors,
    keyStats: run.keyStats ?? {},
    // Shadow Battle specific meta
    opponentKind: 'bot',
    botProfile: match.botProfileId,
    roundsWon: match.match.wins[0],
    roundsLost: match.match.wins[1],
    draws: match.match.draws,
    roundsPlayed: match.match.roundsPlayed,
    matchWinner: match.match.outcome?.winner ?? null,
    hpRemainingSum: match.match.hpRemainingSum,
  };
}

export const formatTrialSession = buildTrialSessionPayload;
