import { card } from './wordQueue.js';
import { resolveForPlayer } from './cardResolution.js';
import { stepEvent } from './combat.js';
import { initialRoundState, clampFocus, strikeInFlightAt } from './roundState.js';
import { initialMatchState, applyRoundOutcome } from './match.js';
import { createBotState, botTick } from './bot.js';
import { toU32, seedFrom } from './prng.js';

const COUNTDOWN_MS = 3500;
const ROUND_TIME_LIMIT_MS = 90000;

export function createTrialMatch({
  matchId = 'trial-local',
  seed = 1,
  botProfileId = 'adept',
  band = 'steel',
} = {}) {
  return {
    matchId,
    seed: toU32(seed),
    botProfileId,
    band,
    match: initialMatchState(),
    currentRound: 1,
    rounds: [],
    mirrorStats: { wpm: 50, cleanRate: 0.95, bestWpm: 50 },
  };
}

function initPlayerCard(seed, roundNumber, cardIndex, band, roundState) {
  const basePair = card(seed, roundNumber, cardIndex, band);
  const resolvedPair = resolveForPlayer(seed, roundNumber, cardIndex, basePair, roundState, 0);
  const overdriveLocked = resolvedPair.strikeMove === 'overdrive';

  return {
    cardIndex,
    activePair: resolvedPair,
    overdriveLocked,
    lane: null,
    input: '',
    errors: 0,
    tStart: 0,
    keystrokes: 0,
  };
}

export function createTrialRound(matchState, roundNumber = matchState.currentRound, startTimestampMs = 0) {
  const roundSeed = seedFrom(matchState.seed, roundNumber);
  const tCombatStart = startTimestampMs + COUNTDOWN_MS;
  const initialCombatRoundState = initialRoundState();

  const playerCardState = initPlayerCard(
    matchState.seed,
    roundNumber,
    0,
    matchState.band,
    initialCombatRoundState
  );

  const botState = createBotState(matchState.botProfileId, matchState.seed, roundNumber, {
    mirrorStats: matchState.mirrorStats,
  });

  return {
    matchId: matchState.matchId,
    seed: matchState.seed,
    roundSeed,
    roundNumber,
    band: matchState.band,
    botProfileId: matchState.botProfileId,
    phase: 'countdown', // 'countdown' -> 'combat' -> 'round-over'
    tStartTimestamp: startTimestampMs,
    tCombatStart,
    roundState: initialCombatRoundState,
    playerCardState,
    botState,
    eventsLog: [],
    roundOutcome: null,
  };
}

function checkOverdriveLock(cardState, seed, roundNumber, band, roundState, playerSeat = 0) {
  if (!cardState.activePair) return cardState;
  if (!cardState.overdriveLocked && roundState.focus[playerSeat] === 100) {
    const basePair = card(seed, roundNumber, cardState.cardIndex, band);
    const resolved = resolveForPlayer(seed, roundNumber, cardState.cardIndex, basePair, roundState, playerSeat);
    return {
      ...cardState,
      activePair: resolved,
      overdriveLocked: true,
    };
  }
  return cardState;
}

export function handlePlayerKey(roundState, key, timestampMs) {
  if (roundState.phase !== 'combat') {
    return { nextRound: roundState, event: null, whiff: false };
  }

  const elapsedMs = Math.max(0, timestampMs - roundState.tCombatStart);
  let nextRoundState = { ...roundState };
  let cardState = { ...nextRoundState.playerCardState };
  let currentRoundState = { ...nextRoundState.roundState };

  // Ensure card exists and check Overdrive lock
  if (!cardState.activePair) {
    cardState = initPlayerCard(
      nextRoundState.seed,
      nextRoundState.roundNumber,
      cardState.cardIndex,
      nextRoundState.band,
      currentRoundState
    );
  } else {
    cardState = checkOverdriveLock(
      cardState,
      nextRoundState.seed,
      nextRoundState.roundNumber,
      nextRoundState.band,
      currentRoundState,
      0
    );
  }

  let event = null;
  let whiff = false;

  // 1. Uncommitted Lane
  if (cardState.lane === null) {
    const strikeInitial = cardState.activePair.strikeWord[0];
    const guardInitial = cardState.activePair.guardWord[0];

    const matchStrike = key.toLowerCase() === strikeInitial.toLowerCase() || key === strikeInitial;
    const matchGuard = key.toLowerCase() === guardInitial.toLowerCase() || key === guardInitial;

    if (matchStrike) {
      cardState.lane = 'strike';
      cardState.input = strikeInitial;
      cardState.tStart = elapsedMs;
      cardState.keystrokes = 1;
    } else if (matchGuard) {
      cardState.lane = 'guard';
      cardState.input = guardInitial;
      cardState.tStart = elapsedMs;
      cardState.keystrokes = 1;
    } else {
      // Whiff! Focus -= 3
      whiff = true;
      const nextFocus = [...currentRoundState.focus];
      nextFocus[0] = clampFocus(nextFocus[0] - 3);
      currentRoundState.focus = nextFocus;
    }
  } else {
    // 2. Committed Lane
    const targetWord = cardState.lane === 'strike' ? cardState.activePair.strikeWord : cardState.activePair.guardWord;
    const cursor = cardState.input.length;
    const expected = targetWord[cursor];

    cardState.keystrokes += 1;

    if (key === expected) {
      cardState.input += key;
    } else {
      cardState.errors += 1;
    }
  }

  // 3. Check for Card Completion
  if (cardState.lane !== null) {
    const targetWord = cardState.lane === 'strike' ? cardState.activePair.strikeWord : cardState.activePair.guardWord;
    if (cardState.input.length === targetWord.length) {
      const tEnd = elapsedMs;
      const moveId = cardState.lane === 'strike' ? cardState.activePair.strikeMove : cardState.activePair.guardMove;

      event = {
        seq: cardState.cardIndex,
        player: 0,
        round: nextRoundState.roundNumber,
        cardIndex: cardState.cardIndex,
        moveId,
        chars: targetWord.length,
        lane: cardState.lane,
        outcome: 'complete',
        tStart: cardState.tStart,
        tEnd,
        keystrokes: cardState.keystrokes,
        errors: cardState.errors,
        ikiStats: [Math.round(Math.max(1, tEnd - cardState.tStart) / targetWord.length), 15],
      };

      const newEventsLog = [...nextRoundState.eventsLog, event];
      currentRoundState = stepEvent(currentRoundState, event, newEventsLog);
      nextRoundState.eventsLog = newEventsLog;

      // Prepare next card
      const nextCardIndex = cardState.cardIndex + 1;
      cardState = initPlayerCard(
        nextRoundState.seed,
        nextRoundState.roundNumber,
        nextCardIndex,
        nextRoundState.band,
        currentRoundState
      );
    }
  }

  nextRoundState.roundState = currentRoundState;
  nextRoundState.playerCardState = cardState;

  // Check HP 0 KO condition
  if (currentRoundState.hp[0] <= 0 || currentRoundState.hp[1] <= 0) {
    let winner = null;
    if (currentRoundState.hp[0] > currentRoundState.hp[1]) winner = 0;
    else if (currentRoundState.hp[1] > currentRoundState.hp[0]) winner = 1;

    nextRoundState.phase = 'round-over';
    nextRoundState.roundOutcome = {
      winner,
      hpRemaining: [currentRoundState.hp[0], currentRoundState.hp[1]],
      reason: 'ko',
    };
  }

  return { nextRound: nextRoundState, event, whiff };
}

export function trialEngineTick(roundState, timestampMs) {
  let nextRound = { ...roundState };

  // Countdown phase
  if (nextRound.phase === 'countdown') {
    if (timestampMs >= nextRound.tCombatStart) {
      nextRound.phase = 'combat';
    } else {
      return { nextRound, roundEnded: false, roundOutcome: null };
    }
  }

  if (nextRound.phase === 'combat') {
    const elapsedMs = Math.max(0, timestampMs - nextRound.tCombatStart);
    let currentCombatState = { ...nextRound.roundState };

    // Check player Overdrive lock
    nextRound.playerCardState = checkOverdriveLock(
      nextRound.playerCardState,
      nextRound.seed,
      nextRound.roundNumber,
      nextRound.band,
      currentCombatState,
      0
    );

    // Check 90s Round Timer Timeout
    if (elapsedMs >= ROUND_TIME_LIMIT_MS) {
      let winner = null;
      if (currentCombatState.hp[0] > currentCombatState.hp[1]) winner = 0;
      else if (currentCombatState.hp[1] > currentCombatState.hp[0]) winner = 1;

      nextRound.phase = 'round-over';
      nextRound.roundOutcome = {
        winner,
        hpRemaining: [currentCombatState.hp[0], currentCombatState.hp[1]],
        reason: 'timeout',
      };
      return { nextRound, roundEnded: true, roundOutcome: nextRound.roundOutcome };
    }

    // Tick Bot
    const playerStrikeInFlight = nextRound.eventsLog.some((ev) =>
      ev.player === 0 && ev.lane === 'strike' && strikeInFlightAt(ev, elapsedMs)
    );

    const opponentObservable = {
      hp: currentCombatState.hp,
      focus: currentCombatState.focus,
      chain: currentCombatState.chain,
      strikeInFlight: playerStrikeInFlight,
    };

    const { nextBotState, emittedEvents } = botTick(
      nextRound.botState,
      currentCombatState,
      opponentObservable,
      elapsedMs,
      nextRound.band
    );
    nextRound.botState = nextBotState;

    if (emittedEvents.length > 0) {
      let newEventsLog = [...nextRound.eventsLog];
      for (const botEvent of emittedEvents) {
        newEventsLog.push(botEvent);
        currentCombatState = stepEvent(currentCombatState, botEvent, newEventsLog);
      }
      nextRound.eventsLog = newEventsLog;
      nextRound.roundState = currentCombatState;
    }

    // Check KO
    if (currentCombatState.hp[0] <= 0 || currentCombatState.hp[1] <= 0) {
      let winner = null;
      if (currentCombatState.hp[0] > currentCombatState.hp[1]) winner = 0;
      else if (currentCombatState.hp[1] > currentCombatState.hp[0]) winner = 1;

      nextRound.phase = 'round-over';
      nextRound.roundOutcome = {
        winner,
        hpRemaining: [currentCombatState.hp[0], currentCombatState.hp[1]],
        reason: 'ko',
      };
      return { nextRound, roundEnded: true, roundOutcome: nextRound.roundOutcome };
    }
  }

  const roundEnded = nextRound.phase === 'round-over';
  return { nextRound, roundEnded, roundOutcome: nextRound.roundOutcome };
}

export function settleRoundOutcome(matchState, roundOutcome) {
  const nextMatch = applyRoundOutcome(matchState.match, roundOutcome);
  return {
    ...matchState,
    match: nextMatch,
    currentRound: matchState.currentRound + 1,
    rounds: [...matchState.rounds, roundOutcome],
  };
}

/** Convenience wrapper for UI integration */
export function initTrialMatch({ botProfile = 'adept', band = 'steel', seed = 1 } = {}) {
  const match = createTrialMatch({ botProfileId: botProfile, band, seed });
  const round = createTrialRound(match, 1, 0);
  return {
    match,
    round,
    activeCard: round.playerCardState.activePair,
    bot: round.botState,
  };
}

export function startTrialRound(match, roundNumber = match.currentRound) {
  return createTrialRound(match, roundNumber, 0);
}

/*
 * `tickBot(round, elapsedMs)` used to live here and read:
 *
 *     return stepTrialRound(round, elapsedMs);
 *
 * `stepTrialRound` was never defined anywhere in the repo — a repo-wide grep
 * found exactly one hit, that call site. Any caller reaching it got a
 * `ReferenceError`. `ShadowArena.jsx` did call it, on a 100ms interval, but
 * guarded the call on `match.phase === 'round_active'` — a field the match
 * object does not have — so the guard was permanently true and the bot simply
 * never acted. That is why a hard ReferenceError presented as "the opponent
 * stands still".
 *
 * Removed rather than repaired: `trialEngineTick(roundState, timestampMs)`
 * above is the real, tested tick, and the arena now drives everything through
 * `arenaSession.js` instead. See
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §2.
 */
