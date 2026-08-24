import { LANES, MOVES } from './moveTable.js';
import { CONTEST } from './damage.js';

/**
 * §11 (Health/Focus/Chain) state helpers and §10.5's timing constants,
 * used to derive a player's contest state (§8.4) from event history —
 * "guarding" and friends are windows computed from past events, not a
 * separately-mutated field, so there is no second source of truth that
 * could drift from the event log on replay.
 */

export const TIMING = {
  GUARD_DURATION_MS: 1200,
  EXPOSED_DURATION_MS: 600,
  STAGGER_DURATION_MS: 700,
  SHURIKEN_TRAVEL_MS: 200,
  INTER_CARD_GAP_MS: 120,
};

export const MAX_HP_TENTHS = 1000; // 100.0 HP, §11.1
export const MAX_FOCUS = 100; // §11.2
export const FLAT_ERROR_FOCUS_GAIN = 2; // §11.2: a strike landed with 1+ errors
export const CHAIN_MILESTONE_STEP = 5; // §11.2: "every 5"
export const CHAIN_MILESTONE_BONUS_FOCUS = 5;

export function initialRoundState() {
  return {
    hp: [MAX_HP_TENTHS, MAX_HP_TENTHS],
    focus: [0, 0],
    chain: [0, 0],
    koAt: [null, null],
    history: [],
    outcome: null,
  };
}

export function clampHp(value) {
  return Math.min(MAX_HP_TENTHS, Math.max(0, value));
}

export function clampFocus(value) {
  return Math.min(MAX_FOCUS, Math.max(0, value));
}

// §11.3: one error is forgiven (chain holds but does not grow); two or
// more breaks it; zero grows it.
export function nextChainValue(chain, errors) {
  if (errors === 0) return chain + 1;
  if (errors === 1) return chain;
  return 0;
}

// §11.2: a chain milestone (every 5) is worth a +5 Focus bonus — this
// fires only when incrementing crosses a new multiple of 5, not on every
// completion past one, and not on a reset.
export function chainMilestoneBonus(prevChain, nextChain) {
  if (nextChain <= prevChain) return 0;
  const prevMilestones = Math.floor(prevChain / CHAIN_MILESTONE_STEP);
  const nextMilestones = Math.floor(nextChain / CHAIN_MILESTONE_STEP);
  return nextMilestones > prevMilestones ? CHAIN_MILESTONE_BONUS_FOCUS : 0;
}

// A strike is "in flight and unresolved" for §10.3's Parry check during
// [tStart, tEnd) — resolved (no longer in flight) exactly at tEnd.
export function strikeInFlightAt(strikeEvent, tMs) {
  return strikeEvent.tStart <= tMs && tMs < strikeEvent.tEnd;
}

// §10.3: a Parry succeeds if it completes while an opposing strike is in
// flight and unresolved.
export function parrySucceeded(allEvents, parryEvent) {
  const opponent = 1 - parryEvent.player;
  return allEvents.some((ev) => {
    const move = MOVES[ev.moveId];
    return (
      ev.player === opponent &&
      move?.lane === LANES.STRIKE &&
      strikeInFlightAt(ev, parryEvent.tEnd)
    );
  });
}

// §8.4's contest-state table, minus Parrying — a successful Parry is
// resolved per-strike by combat.js (it needs the specific strike event
// being defended against, not just "is this player parrying right now").
// Committed, Guarding and Exposed are "mutually exclusive by
// construction" per the PRD; this priority order is the tie-break if
// game flow ever produces an overlap anyway.
export function deriveContestState(allEvents, player, atTimeMs) {
  const isCommitted = allEvents.some((ev) => {
    const move = MOVES[ev.moveId];
    return (
      ev.player === player && ev.outcome === 'complete' && move?.committed &&
      ev.tStart <= atTimeMs && atTimeMs <= ev.tEnd
    );
  });
  if (isCommitted) return CONTEST.COMMITTED;

  const isGuarding = allEvents.some((ev) =>
    ev.player === player && ev.moveId === 'guard' && ev.outcome === 'complete' &&
    ev.tEnd <= atTimeMs && atTimeMs < ev.tEnd + TIMING.GUARD_DURATION_MS
  );
  if (isGuarding) return CONTEST.GUARDING;

  const isExposed = allEvents.some((ev) =>
    ev.player === player && ev.moveId === 'parry' && ev.outcome === 'complete' &&
    !parrySucceeded(allEvents, ev) &&
    ev.tEnd <= atTimeMs && atTimeMs < ev.tEnd + TIMING.EXPOSED_DURATION_MS
  );
  if (isExposed) return CONTEST.EXPOSED;

  const isStaggered = allEvents.some((ev) =>
    ev.player === player && ev.outcome === 'expire' &&
    ev.tEnd <= atTimeMs && atTimeMs < ev.tEnd + TIMING.STAGGER_DURATION_MS
  );
  if (isStaggered) return CONTEST.STAGGERED;

  return CONTEST.NEUTRAL;
}
