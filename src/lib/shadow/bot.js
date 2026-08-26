import { xorshift32, toU32, draw, seedFrom } from './prng.js';
import { parMs } from './damage.js';
import { card } from './wordQueue.js';
import { resolveForPlayer } from './cardResolution.js';

const REF_WPM = 60;

/**
 * §13 Bot system implementation for Shadow Battle.
 *
 * "The bot plays the game. It does not fake the outcome." (§13.1)
 *
 * Emits standard CombatEvent objects into the combat reducer. Difficulty
 * is entirely modeled through typing speed (log-normal distribution),
 * error generation, reaction latency, and observable-state decision policies.
 */

export const BOT_PROFILES = {
  recruit: {
    id: 'recruit',
    name: 'Recruit',
    difficulty: 'easy',
    wpmMean: 28,
    wpmSigma: 9,
    cleanRate: 0.88,
    reactionMs: 700,
    guardRate: 0.15,
    parryRate: 0,
    overdriveDiscipline: 'delayed',
  },
  adept: {
    id: 'adept',
    name: 'Adept',
    difficulty: 'normal',
    wpmMean: 45,
    wpmSigma: 11,
    cleanRate: 0.94,
    reactionMs: 450,
    guardRate: 0.32,
    parryRate: 0.10,
    overdriveDiscipline: 'immediate',
  },
  ronin: {
    id: 'ronin',
    name: 'Ronin',
    difficulty: 'hard',
    wpmMean: 65,
    wpmSigma: 12,
    cleanRate: 0.97,
    reactionMs: 300,
    guardRate: 0.52,
    parryRate: 0.30,
    overdriveDiscipline: 'opening',
  },
  shade: {
    id: 'shade',
    name: 'Shade',
    difficulty: 'expert',
    wpmMean: 88,
    wpmSigma: 14,
    cleanRate: 0.99,
    reactionMs: 200,
    guardRate: 0.68,
    parryRate: 0.45,
    overdriveDiscipline: 'committed',
  },
  mirror: {
    id: 'mirror',
    name: 'Mirror',
    difficulty: 'adaptive',
    wpmMean: 45,
    wpmSigma: 10,
    cleanRate: 0.94,
    reactionMs: 260,
    guardRate: 0.45,
    parryRate: 0.25,
    overdriveDiscipline: 'opening',
  },
};

/**
 * §13.4 Mirror adaptive profile calculation.
 */
export function computeMirrorProfile(playerWpm, playerCleanRate, bestPlayerWpm = null) {
  let botWpm = playerWpm * 0.97;
  if (bestPlayerWpm != null && bestPlayerWpm > 0) {
    botWpm = Math.min(botWpm, bestPlayerWpm * 1.05);
  }
  botWpm = Math.max(28, Math.min(88, botWpm));

  const cleanRate = Math.max(0.86, Math.min(0.985, playerCleanRate - 0.01));

  return {
    ...BOT_PROFILES.mirror,
    wpmMean: botWpm,
    cleanRate,
  };
}

/**
 * Log-normal duration sampling via Box-Muller normal transform (§13.2).
 */
export function sampleTypingDuration(prngState, botWpm, sigma, charCount) {
  const d1 = draw(prngState);
  const d2 = draw(d1.next);

  const u1 = Math.max(d1.u, 1e-7);
  const u2 = d2.u;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const sigmaLog = Math.max(0.08, sigma / Math.max(botWpm, 10));
  const target = parMs(charCount) * (REF_WPM / Math.max(botWpm, 10));
  const mult = Math.max(0.35, Math.min(3.0, Math.exp(sigmaLog * z)));

  const durationMs = Math.max(50, Math.round(target * mult));
  return { durationMs, nextState: d2.next };
}

/**
 * Error sampling & correction penalty (§13.2).
 */
export function sampleCardErrors(prngState, cleanRate) {
  const d1 = draw(prngState);
  if (d1.u < cleanRate) {
    return { errors: 0, penaltyMs: 0, nextState: d1.next };
  }

  const d2 = draw(d1.next);
  const errors = 1 + Math.floor(d2.u * 2); // 1 or 2 errors
  const penaltyMs = 140 + 90 * errors; // §13.2: + (140 + 90 * errors) ms
  return { errors, penaltyMs, nextState: d2.next };
}

/**
 * Decision policy using OBSERVABLE state only (SB-BOT-9).
 */
export function decideLane(prngState, profile, resolvedPair, roundState, botSeat = 1, opponentStrikeInFlight = false) {
  if (resolvedPair.strikeMove === 'overdrive') {
    return { lane: 'strike', nextState: prngState };
  }

  const botHp = roundState.hp[botSeat];

  if (opponentStrikeInFlight) {
    if (resolvedPair.guardMove === 'parry' && profile.parryRate > 0) {
      const d = draw(prngState);
      if (d.u < profile.parryRate) {
        return { lane: 'guard', nextState: d.next };
      }
      prngState = d.next;
    }

    const dGuard = draw(prngState);
    if (dGuard.u < profile.guardRate) {
      return { lane: 'guard', nextState: dGuard.next };
    }
    return { lane: 'strike', nextState: dGuard.next };
  }

  if (profile.id === 'recruit') {
    // Recruit only guards at HP < 300 (30.0 HP)
    if (botHp < 300) {
      const d = draw(prngState);
      if (d.u < profile.guardRate) {
        return { lane: 'guard', nextState: d.next };
      }
      return { lane: 'strike', nextState: d.next };
    }
    return { lane: 'strike', nextState: prngState };
  }

  const d = draw(prngState);
  if (d.u < profile.guardRate) {
    return { lane: 'guard', nextState: d.next };
  }
  return { lane: 'strike', nextState: d.next };
}

/**
 * Create a fresh bot state for a round.
 */
export function createBotState(profileId, seed, round, { mirrorStats } = {}) {
  let profile = BOT_PROFILES[profileId] ?? BOT_PROFILES.adept;
  if (profileId === 'mirror' && mirrorStats) {
    profile = computeMirrorProfile(mirrorStats.wpm, mirrorStats.cleanRate, mirrorStats.bestWpm);
  }

  const initialPrng = seedFrom(toU32(seed), round, 1, 0x424F54);

  return {
    profileId,
    profile,
    seed: toU32(seed),
    round,
    prngState: initialPrng,
    cardIndex: 0,
    seq: 0,
    phase: 'reacting', // 'reacting' -> 'typing' -> 'idle'
    tStart: 0,
    tReactEnd: 0,
    tComplete: 0,
    activePair: null,
    overdriveLocked: false,
    lane: null,
    errors: 0,
  };
}

/**
 * Advance bot simulation by elapsedMs and emit CombatEvent if a card finishes.
 */
export function botTick(botState, roundState, opponentObservable, elapsedMs, band = 'steel') {
  let {
    profile, seed, round, prngState, cardIndex, seq,
    phase, tStart, tReactEnd, tComplete, activePair, overdriveLocked, lane, errors,
  } = botState;

  const emittedEvents = [];
  const botSeat = 1;

  // Initialize first card or next card if needed
  if (!activePair) {
    const basePair = card(seed, round, cardIndex, band);
    activePair = resolveForPlayer(seed, round, cardIndex, basePair, roundState, botSeat);
    overdriveLocked = activePair.strikeMove === 'overdrive';

    tStart = elapsedMs;
    // Reaction phase: reactionMs + jitter
    const dJitter = draw(prngState);
    prngState = dJitter.next;
    const jitter = Math.round((dJitter.u - 0.5) * 60); // +/- 30ms
    const reactionTime = Math.max(40, profile.reactionMs + jitter);

    tReactEnd = tStart + reactionTime;
    phase = 'reacting';
    lane = null;
    errors = 0;
  }

  // Check if Overdrive should stickily lock if Focus hits 100 while active
  if (!overdriveLocked && roundState.focus[botSeat] === 100) {
    const basePair = card(seed, round, cardIndex, band);
    activePair = resolveForPlayer(seed, round, cardIndex, basePair, roundState, botSeat);
    overdriveLocked = activePair.strikeMove === 'overdrive';
  }

  // Transition from reacting to typing
  if (phase === 'reacting' && elapsedMs >= tReactEnd) {
    const opponentStrikeInFlight = Boolean(opponentObservable?.strikeInFlight);
    const decision = decideLane(prngState, profile, activePair, roundState, botSeat, opponentStrikeInFlight);
    lane = decision.lane;
    prngState = decision.nextState;

    const chosenWord = lane === 'strike' ? activePair.strikeWord : activePair.guardWord;
    const charCount = chosenWord.length;

    // Sample duration & errors
    const typing = sampleTypingDuration(prngState, profile.wpmMean, profile.wpmSigma, charCount);
    prngState = typing.nextState;

    const errorSample = sampleCardErrors(prngState, profile.cleanRate);
    prngState = errorSample.nextState;
    errors = errorSample.errors;

    let extraDelay = 0;
    if (activePair.strikeMove === 'overdrive' && profile.overdriveDiscipline === 'delayed') {
      extraDelay = 2000;
    }

    tComplete = tReactEnd + typing.durationMs + errorSample.penaltyMs + extraDelay;
    phase = 'typing';
  }

  // Transition from typing to card completion
  if (phase === 'typing' && elapsedMs >= tComplete) {
    const chosenMove = lane === 'strike' ? activePair.strikeMove : activePair.guardMove;
    const chosenWord = lane === 'strike' ? activePair.strikeWord : activePair.guardWord;

    const event = {
      seq,
      player: botSeat,
      round,
      cardIndex,
      moveId: chosenMove,
      chars: chosenWord.length,
      lane,
      outcome: 'complete',
      tStart: tReactEnd,
      tEnd: tComplete,
      keystrokes: chosenWord.length + errors * 2,
      errors,
      ikiStats: [Math.round((tComplete - tReactEnd) / Math.max(1, chosenWord.length)), 15],
    };

    emittedEvents.push(event);

    // Prepare for next card
    seq += 1;
    cardIndex += 1;
    activePair = null;
    overdriveLocked = false;
    phase = 'idle';
  }

  const nextBotState = {
    ...botState,
    prngState,
    cardIndex,
    seq,
    phase,
    tStart,
    tReactEnd,
    tComplete,
    activePair,
    overdriveLocked,
    lane,
    errors,
  };

  return { nextBotState, emittedEvents };
}
