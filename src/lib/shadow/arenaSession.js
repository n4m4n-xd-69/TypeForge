import { stepEvent, finalizeOutcome, ROUND_TIME_CAP_MS } from './combat.js';
import { initialRoundState, clampHp, clampFocus, strikeInFlightAt } from './roundState.js';
import { initialMatchState, applyRoundOutcome } from './match.js';
import { createBotState, botTick, BOT_PROFILES } from './bot.js';
import { deckFor, laneForKey, WHIFF_FOCUS_COST } from './laneDeck.js';
import {
  advanceNinja, createNinjaState, ninjaStats, pressureFor, NINJA_ERROR_HP_TENTHS,
} from './ninjaFlow.js';
import { toU32 } from './prng.js';

/**
 * The one contract the arena UI talks to.
 *
 * ## Why this module exists
 *
 * `ShadowArena.jsx` was written against an engine API `trialEngine.js` never
 * exposed — four independent mismatches, documented in
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §2. The visible
 * result was a Trial mode where typing threw `TypeError` on every keystroke, the
 * bot never moved, and HP never changed. Every one of the 298 tests passed
 * throughout, because none of them called the engine the way the component did.
 *
 * So the fix is not a patch, it is a seam: **one facade, one discriminated
 * union, no component reaching into engine internals.** If the shapes ever
 * disagree again, `arenaSession.test.js` fails rather than the game silently
 * doing nothing.
 *
 * ## What it does not do
 *
 * No balance lives here. Both avatars emit the same wire CombatEvent (§8.2) and
 * fold through the same `combat.stepEvent`, so damage, Focus, chain and parry
 * are identical across modes by construction. This module only owns phase,
 * seats, input routing and the bot clock.
 *
 * Seat 0 is always the human, seat 1 always the bot — matching `bot.js`'s
 * hardcoded `botSeat = 1`.
 */

export const AVATARS = { STICKMAN: 'stickman', NINJA: 'ninja' };

export const COUNTDOWN_MS = 3500;
export const ROUNDS_TO_WIN = 2;

/** Focus gate at which the Overdrive phrase replaces the Fight lane. */
const OVERDRIVE_FOCUS = 100;

const PLAYER = 0;
const BOT = 1;

/* ── construction ─────────────────────────────────────────────────────── */

export function createSession({
  avatar = AVATARS.STICKMAN,
  botProfile = 'adept',
  band = 'steel',
  seed = 1,
  playerName = 'Player',
  opponentName = null,
  startedAtMs = 0,
} = {}) {
  const profile = BOT_PROFILES[botProfile] ?? BOT_PROFILES.adept;
  const session = {
    avatar,
    band,
    seed: toU32(seed),
    botProfileId: profile.id,
    playerName,
    opponentName: opponentName ?? profile.name,
    match: initialMatchState(),
    round: 1,
    scores: [0, 0],
    phase: 'countdown',
    roundOutcome: null,
    matchOutcome: null,
  };
  return beginRound(session, 1, startedAtMs);
}

/** Fresh per-round state for whichever avatar is selected. */
function beginRound(session, round, startedAtMs) {
  const roundState = initialRoundState();
  const tCombatStart = startedAtMs + COUNTDOWN_MS;

  const next = {
    ...session,
    round,
    phase: 'countdown',
    roundState,
    events: [],
    roundOutcome: null,
    tStart: startedAtMs,
    tCombatStart,
    bot: createBotState(session.botProfileId, session.seed, round),
    // Stickman
    cardIndex: 0,
    deck: null,
    lockedDeck: null,
    lane: null,
    typed: '',
    cardErrors: 0,
    cardKeystrokes: 0,
    cardStartMs: 0,
    seq: 0,
    // Ninja
    ninja: null,
    pressure: 1,
  };

  if (session.avatar === AVATARS.NINJA) {
    next.ninja = createNinjaState(session.seed, round, tCombatStart);
  } else {
    next.deck = deckFor(session.seed, round, 0, session.band, roundState, PLAYER);
  }
  return next;
}

/* ── stickman helpers ─────────────────────────────────────────────────── */

/**
 * Re-resolve the deck against live state, honouring the Overdrive caching
 * contract `cardResolution.js` documents: once Overdrive fires for a card it
 * must stay until played, so the resolved deck is frozen in `lockedDeck` rather
 * than recomputed (a pure re-resolve would revert it the instant Focus dropped).
 */
function currentDeck(s) {
  if (s.lockedDeck) return s.lockedDeck;
  const deck = deckFor(s.seed, s.round, s.cardIndex, s.band, s.roundState, PLAYER);
  return deck;
}

function nextCard(s, roundState) {
  const cardIndex = s.cardIndex + 1;
  const deck = deckFor(s.seed, s.round, cardIndex, s.band, roundState, PLAYER);
  return {
    ...s,
    cardIndex,
    deck,
    lockedDeck: deck.overdrive ? deck : null,
    lane: null,
    typed: '',
    cardErrors: 0,
    cardKeystrokes: 0,
    cardStartMs: 0,
  };
}

/* ── shared resolution ────────────────────────────────────────────────── */

/** Fold one event through the reducer and check for a KO. */
function applyEvent(s, event, damageMul = 1.00) {
  const events = [...s.events, event];
  const roundState = stepEvent(s.roundState, event, events, damageMul);
  return { ...s, events, roundState };
}

function koCheck(s, nowMs) {
  const { hp } = s.roundState;
  if (hp[0] > 0 && hp[1] > 0) return null;
  const finalized = finalizeOutcome(s.roundState, { timeUp: false });
  const winner = finalized.outcome?.winner ?? (hp[0] > hp[1] ? 0 : hp[1] > hp[0] ? 1 : null);
  return {
    winner,
    hpRemaining: [hp[0], hp[1]],
    reason: finalized.outcome?.type === 'double-ko' ? 'double-ko' : 'ko',
    atMs: nowMs,
  };
}

/** Settle a finished round into the match, and decide whether the match is over. */
function settle(s, roundOutcome) {
  const match = applyRoundOutcome(s.match, roundOutcome);
  const scores = [...match.wins];
  const done = match.phase === 'complete';
  return {
    ...s,
    match,
    scores,
    roundOutcome,
    phase: done ? 'match-over' : 'round-over',
    matchOutcome: done
      ? {
        outcome: scores[0] > scores[1] ? 'win' : scores[1] > scores[0] ? 'loss' : 'draw',
        scores,
        rounds: match.roundsPlayed,
      }
      : null,
  };
}

function endResult(s) {
  if (s.phase === 'match-over') {
    return { kind: 'match-end', outcome: s.matchOutcome.outcome, scores: s.scores, roundOutcome: s.roundOutcome };
  }
  return { kind: 'round-end', winner: s.roundOutcome.winner, reason: s.roundOutcome.reason, scores: s.scores };
}

/* ── input ────────────────────────────────────────────────────────────── */

/**
 * Consume one keystroke.
 *
 * @returns {{ session: object, result: object }} `result.kind` is one of
 *   `'noop' | 'progress' | 'lane-commit' | 'whiff' | 'penalty' | 'resolve' | 'round-end' | 'match-end'`.
 */
export function press(session, key, nowMs) {
  if (session.phase !== 'combat') return { session, result: { kind: 'noop' } };
  if (typeof key !== 'string' || key.length !== 1) return { session, result: { kind: 'noop' } };

  return session.avatar === AVATARS.NINJA
    ? pressNinja(session, key, nowMs)
    : pressStickman(session, key, nowMs);
}

function pressStickman(session, key, nowMs) {
  const deck = currentDeck(session);

  /* Uncommitted: the first character picks the lane. */
  if (session.lane === null) {
    const lane = laneForKey(deck, key);
    if (!lane) {
      const focus = [...session.roundState.focus];
      focus[PLAYER] = clampFocus(focus[PLAYER] - WHIFF_FOCUS_COST);
      return {
        session: { ...session, roundState: { ...session.roundState, focus } },
        result: { kind: 'whiff', seat: PLAYER, focusLost: WHIFF_FOCUS_COST },
      };
    }
    const s = {
      ...session,
      deck,
      lockedDeck: deck.overdrive ? deck : session.lockedDeck,
      lane: lane.id,
      typed: lane.word[0],
      cardKeystrokes: 1,
      cardStartMs: nowMs,
    };
    // A one-character word would be complete already; no lane range allows it,
    // but resolving here keeps the invariant local rather than assumed.
    if (s.typed.length === lane.word.length) return resolveStickmanCard(s, lane, nowMs);
    return { session: s, result: { kind: 'lane-commit', lane: lane.id, typed: 1, total: lane.word.length } };
  }

  /* Committed: type the word out. */
  const lane = deck.lanes.find((l) => l.id === session.lane);
  const expected = lane.word[session.typed.length];
  const s = { ...session, cardKeystrokes: session.cardKeystrokes + 1 };

  if (key === expected) {
    s.typed = session.typed + key;
  } else {
    s.cardErrors = session.cardErrors + 1;
    return {
      session: s,
      result: { kind: 'progress', lane: lane.id, typed: s.typed.length, total: lane.word.length, miss: true },
    };
  }

  if (s.typed.length < lane.word.length) {
    return { session: s, result: { kind: 'progress', lane: lane.id, typed: s.typed.length, total: lane.word.length } };
  }
  return resolveStickmanCard(s, lane, nowMs);
}

function resolveStickmanCard(s, lane, nowMs) {
  const hpBefore = [...s.roundState.hp];
  const event = {
    seq: s.seq,
    player: PLAYER,
    round: s.round,
    cardIndex: s.cardIndex,
    moveId: lane.moveId,
    chars: lane.word.length,
    lane: lane.mechanicalLane,
    outcome: 'complete',
    tStart: s.cardStartMs,
    tEnd: nowMs,
    keystrokes: s.cardKeystrokes,
    errors: s.cardErrors,
    ikiStats: [Math.round(Math.max(1, nowMs - s.cardStartMs) / lane.word.length), 15],
  };

  let next = applyEvent({ ...s, seq: s.seq + 1 }, event);
  const damage = hpBefore[BOT] - next.roundState.hp[BOT];
  const healed = next.roundState.hp[PLAYER] - hpBefore[PLAYER];

  const outcome = koCheck(next, nowMs);
  if (outcome) {
    next = settle({ ...next, lockedDeck: null }, outcome);
    return { session: next, result: endResult(next) };
  }

  next = nextCard(next, next.roundState);
  return {
    session: next,
    result: {
      kind: 'resolve',
      seat: PLAYER,
      lane: lane.id,
      moveId: lane.moveId,
      damage,
      healed: healed > 0 ? healed : 0,
      errors: event.errors,
    },
  };
}

function pressNinja(session, key, nowMs) {
  const { next: ninja, result } = advanceNinja(session.ninja, key, nowMs);

  if (result.kind === 'noop') return { session, result: { kind: 'noop' } };

  /* Rule 1: a wrong character costs HP immediately. */
  if (result.kind === 'penalty') {
    const hp = [...session.roundState.hp];
    hp[PLAYER] = clampHp(hp[PLAYER] - result.hpLost);
    let s = { ...session, ninja, roundState: { ...session.roundState, hp } };

    const outcome = koCheck(s, nowMs);
    if (outcome) {
      s = settle(s, outcome);
      return { session: s, result: endResult(s) };
    }
    return {
      session: s,
      result: { kind: 'penalty', seat: PLAYER, hpLost: result.hpLost, char: result.char, expected: result.expected },
    };
  }

  if (result.kind === 'progress') {
    return {
      session: { ...session, ninja },
      result: { kind: 'progress', cursor: ninja.cursor, total: ninja.scroll.text.length },
    };
  }

  /* A beat landed. Scale it against the opponent, then fold it. */
  const stats = ninjaStats(ninja, nowMs);
  const profile = BOT_PROFILES[session.botProfileId] ?? BOT_PROFILES.adept;
  const pressure = pressureFor({
    playerWpm: stats.wpm,
    playerAccuracy: stats.accuracy,
    opponentWpm: profile.wpmMean,
    opponentAccuracy: profile.cleanRate,
  });

  const hpBefore = [...session.roundState.hp];
  let s = applyEvent({ ...session, ninja, pressure }, result.event, pressure);
  const damage = hpBefore[BOT] - s.roundState.hp[BOT];

  const outcome = koCheck(s, nowMs);
  if (outcome) {
    s = settle(s, outcome);
    return { session: s, result: endResult(s) };
  }

  /* Scroll exhausted without a KO: refill so the round can run to the cap. */
  if (ninja.complete) {
    s = { ...s, ninja: createNinjaState(s.seed, s.round * 1000 + s.events.length, nowMs) };
  }

  return {
    session: s,
    result: {
      kind: 'resolve',
      seat: PLAYER,
      moveId: result.event.moveId,
      damage,
      healed: 0,
      errors: result.event.errors,
      pressure,
      beat: result.beat.text,
    },
  };
}

/* ── clock ────────────────────────────────────────────────────────────── */

/**
 * Advance the world. Drives the countdown, the bot and the round time cap.
 *
 * The caller decides the cadence; nothing here assumes a fixed interval, so a
 * dropped frame delays the bot rather than desyncing it.
 */
export function tick(session, nowMs) {
  if (session.phase === 'countdown') {
    if (nowMs < session.tCombatStart) return { session, result: { kind: 'noop' } };
    const s = { ...session, phase: 'combat' };
    if (s.avatar === AVATARS.NINJA && s.ninja) {
      s.ninja = { ...s.ninja, startedAtMs: nowMs, beatStartMs: nowMs };
    } else {
      s.cardStartMs = nowMs;
    }
    return { session: s, result: { kind: 'combat-start' } };
  }

  if (session.phase !== 'combat') return { session, result: { kind: 'noop' } };

  const elapsedMs = Math.max(0, nowMs - session.tCombatStart);

  /* Round time cap — §12.2. */
  if (elapsedMs >= ROUND_TIME_CAP_MS) {
    const { hp } = session.roundState;
    const s = settle(session, {
      winner: hp[0] > hp[1] ? 0 : hp[1] > hp[0] ? 1 : null,
      hpRemaining: [hp[0], hp[1]],
      reason: 'timeout',
      atMs: nowMs,
    });
    return { session: s, result: endResult(s) };
  }

  /* Bot. */
  const playerStrikeInFlight = session.events.some(
    (ev) => ev.player === PLAYER && ev.lane === 'strike' && strikeInFlightAt(ev, elapsedMs),
  );
  const { nextBotState, emittedEvents } = botTick(
    session.bot,
    session.roundState,
    {
      hp: session.roundState.hp,
      focus: session.roundState.focus,
      chain: session.roundState.chain,
      strikeInFlight: playerStrikeInFlight,
    },
    elapsedMs,
    session.band,
  );

  let s = { ...session, bot: nextBotState };
  if (emittedEvents.length === 0) return { session: s, result: { kind: 'noop' } };

  const hpBefore = [...s.roundState.hp];
  for (const event of emittedEvents) {
    // Bot events are never pressure-scaled: `pressure` already expresses the
    // player's output *relative to* the bot, so scaling both sides would apply
    // the same ratio twice.
    s = applyEvent(s, { ...event, tEnd: event.tEnd ?? elapsedMs }, 1.00);
  }
  const damage = hpBefore[PLAYER] - s.roundState.hp[PLAYER];

  const outcome = koCheck(s, nowMs);
  if (outcome) {
    s = settle(s, outcome);
    return { session: s, result: endResult(s) };
  }

  const last = emittedEvents[emittedEvents.length - 1];
  return {
    session: s,
    result: { kind: 'resolve', seat: BOT, moveId: last.moveId, damage, healed: 0, errors: last.errors },
  };
}

/** Start the next round after a `round-end`. */
export function nextRound(session, nowMs = 0) {
  if (session.phase !== 'round-over') return session;
  return beginRound(session, session.round + 1, nowMs);
}

/** Restart the whole match, keeping avatar/bot/band. */
export function restart(session, nowMs = 0) {
  return createSession({
    avatar: session.avatar,
    botProfile: session.botProfileId,
    band: session.band,
    seed: session.seed,
    playerName: session.playerName,
    opponentName: session.opponentName,
    startedAtMs: nowMs,
  });
}

/* ── view ─────────────────────────────────────────────────────────────── */

/**
 * The flat, render-ready projection. The component reads **only** this and the
 * result unions — never the session's internals. That is the whole point of the
 * module: the previous UI reached for `match.currentRoundState.hp`, a field that
 * never existed, and nothing caught it.
 */
export function view(session, nowMs = 0) {
  const { hp, focus, chain } = session.roundState;
  const elapsedMs = session.phase === 'countdown'
    ? 0
    : Math.max(0, nowMs - session.tCombatStart);

  const base = {
    avatar: session.avatar,
    phase: session.phase,
    round: session.round,
    scores: session.scores,
    hp: [hp[0], hp[1]],
    focus: [focus[0], focus[1]],
    chain: [chain[0], chain[1]],
    playerName: session.playerName,
    opponentName: session.opponentName,
    overdriveReady: focus[PLAYER] >= OVERDRIVE_FOCUS,
    secondsLeft: Math.max(0, Math.ceil((ROUND_TIME_CAP_MS - elapsedMs) / 1000)),
    countdownLeft: session.phase === 'countdown'
      ? Math.max(0, Math.ceil((session.tCombatStart - nowMs) / 1000))
      : 0,
    roundOutcome: session.roundOutcome,
    matchOutcome: session.matchOutcome,
  };

  if (session.avatar === AVATARS.NINJA) {
    const stats = ninjaStats(session.ninja, Math.max(nowMs, session.tCombatStart + 1));
    return {
      ...base,
      pressure: session.pressure,
      wpm: Math.round(stats.wpm),
      accuracy: Math.round(stats.accuracy * 100),
      scroll: {
        text: session.ninja.scroll.text,
        cursor: session.ninja.cursor,
        beatIndex: session.ninja.beatIndex,
        beats: session.ninja.scroll.beats,
      },
      errorHpCost: NINJA_ERROR_HP_TENTHS,
    };
  }

  const deck = currentDeck(session);
  return {
    ...base,
    deck: {
      overdrive: deck.overdrive,
      lanes: deck.lanes.map((lane) => ({
        id: lane.id,
        moveId: lane.moveId,
        word: lane.word,
        mechanicalLane: lane.mechanicalLane,
        committed: session.lane === lane.id,
        dimmed: session.lane !== null && session.lane !== lane.id,
        typed: session.lane === lane.id ? session.typed.length : 0,
      })),
    },
  };
}
