import { LANES, getMove } from './moveTable.js';
import {
  CONTEST, computeDamage, reflectedDamage,
  isCritical, precisionFactor, speedFactor, parMs,
} from './damage.js';
import {
  clampHp, clampFocus, nextChainValue, chainMilestoneBonus,
  strikeInFlightAt, deriveContestState, FLAT_ERROR_FOCUS_GAIN, parrySucceeded, initialRoundState,
} from './roundState.js';

/**
 * The public combat reducer (SB-CMB-1) — `stepEvent` is the atomic pure
 * transition, `reduceRound` folds a full log through it. Both take
 * *resolved* events: the wire CombatEvent (§8.2) plus `moveId` and
 * `chars`, which Plan 2's seeded queue resolves from `cardIndex` before
 * events reach this module (see the design doc's "Event resolution
 * seam"). `ikiStats` rides along on `history` entries but is not read
 * here — it's reserved for the anti-cheat plan (§21.2).
 *
 * A subtlety for whoever builds that resolution step (Plan 2): resolving
 * moveId isn't always a pure function of cardIndex alone — SB-MOV-2/SB-MOV-3
 * (Overdrive/Mend substitution) depend on Focus/HP state that only this
 * reducer produces by folding prior events. So full resolution is a fixed
 * point (resolve against the best-known state, fold, re-resolve against the
 * new state, repeat until it stabilizes), not a strict one-pass pipeline —
 * despite `stepEvent`'s own contract wanting the full resolved array up
 * front for its committed-window lookahead. This module doesn't have to
 * solve that; it just needs whoever calls it to know it's not as simple as
 * "resolve once, then fold."
 */

function findSuccessfulParryAgainst(allEvents, strikeEvent) {
  const defender = 1 - strikeEvent.player;
  return (
    allEvents.find((ev) =>
      ev.player === defender && ev.moveId === 'parry' && ev.outcome === 'complete' &&
      strikeInFlightAt(strikeEvent, ev.tEnd)
    ) ?? null
  );
}

function applyStrike(state, event, move, allEvents, damageMul = 1.00) {
  const attacker = event.player;
  const defender = 1 - attacker;
  const duration = Math.max(event.tEnd - event.tStart, 1);

  const parriedBy = findSuccessfulParryAgainst(allEvents, event);
  const contestState = parriedBy
    ? CONTEST.PARRYING
    : deriveContestState(allEvents, defender, event.tEnd);

  const dealt = computeDamage({
    base: move.base, chars: event.chars, actualMs: duration,
    errors: event.errors, chain: state.chain[attacker],
    contestState, guardFactor: move.guardFactor, damageMul,
  });

  const nextHp = [...state.hp];
  nextHp[defender] = clampHp(nextHp[defender] - dealt);

  const nextKoAt = [...state.koAt];
  if (nextHp[defender] === 0 && nextKoAt[defender] == null) nextKoAt[defender] = event.tEnd;

  if (parriedBy) {
    // §10.7: reflections never crit — suppressCrit unconditionally, so a
    // fast/clean strike that would have crit on the primary target can't
    // also crit on the reflection back to the attacker.
    const neutral = computeDamage({
      base: move.base, chars: event.chars, actualMs: duration,
      errors: event.errors, chain: state.chain[attacker],
      contestState: CONTEST.NEUTRAL, guardFactor: move.guardFactor,
      suppressCrit: true, damageMul,
    });
    const reflected = reflectedDamage(neutral);
    nextHp[attacker] = clampHp(nextHp[attacker] - reflected);
    if (nextHp[attacker] === 0 && nextKoAt[attacker] == null) nextKoAt[attacker] = event.tEnd;
  }

  const wasCritical = isCritical(
    precisionFactor(event.errors),
    speedFactor(parMs(event.chars), duration),
  );

  const nextChain = [...state.chain];
  const prevAttackerChain = nextChain[attacker];
  nextChain[attacker] = move.resetsChain ? 0 : nextChainValue(prevAttackerChain, event.errors);
  if (!parriedBy && wasCritical) nextChain[defender] = 0;

  const nextFocus = [...state.focus];
  if (move.focus < 0) {
    nextFocus[attacker] = clampFocus(nextFocus[attacker] + move.focus); // overdrive: spend all
  } else {
    const gain = event.errors === 0 ? move.focus : FLAT_ERROR_FOCUS_GAIN;
    nextFocus[attacker] = clampFocus(nextFocus[attacker] + gain);
  }
  const milestone = chainMilestoneBonus(prevAttackerChain, nextChain[attacker]);
  if (milestone > 0) nextFocus[attacker] = clampFocus(nextFocus[attacker] + milestone);

  return {
    ...state,
    hp: nextHp, focus: nextFocus, chain: nextChain, koAt: nextKoAt,
    history: [...state.history, event],
  };
}

function applyExpiry(state, event) {
  const p = event.player;
  const nextFocus = [...state.focus];
  nextFocus[p] = clampFocus(nextFocus[p] - 5); // §11.2: card expiry
  const nextChain = [...state.chain];
  nextChain[p] = 0; // §11.3: card expiry breaks chain
  return { ...state, focus: nextFocus, chain: nextChain, history: [...state.history, event] };
}

function applyWhiff(state, event) {
  const p = event.player;
  const nextFocus = [...state.focus];
  nextFocus[p] = clampFocus(nextFocus[p] - 3); // §11.2: whiff
  return { ...state, focus: nextFocus, history: [...state.history, event] }; // chain unchanged
}

function applyGuard(state, event, move) {
  const p = event.player;
  const nextFocus = [...state.focus];
  nextFocus[p] = clampFocus(nextFocus[p] + move.focus); // unconditional +3
  const nextChain = [...state.chain];
  nextChain[p] = nextChainValue(nextChain[p], event.errors);
  return { ...state, focus: nextFocus, chain: nextChain, history: [...state.history, event] };
}

function applyParry(state, event, move, allEvents) {
  const p = event.player;
  const succeeded = parrySucceeded(allEvents, event);
  const nextFocus = [...state.focus];
  if (succeeded) nextFocus[p] = clampFocus(nextFocus[p] + move.focus); // +10, only on success
  const nextChain = [...state.chain];
  nextChain[p] = nextChainValue(nextChain[p], event.errors);
  return { ...state, focus: nextFocus, chain: nextChain, history: [...state.history, event] };
}

function applyMend(state, event, move) {
  const p = event.player;
  const nextFocus = [...state.focus];
  nextFocus[p] = clampFocus(nextFocus[p] + move.focus); // -25
  const nextHp = [...state.hp];
  nextHp[p] = clampHp(nextHp[p] + move.healsHp); // +12 HP (120 tenths)
  const nextChain = [...state.chain];
  nextChain[p] = nextChainValue(nextChain[p], event.errors);
  return { ...state, focus: nextFocus, hp: nextHp, chain: nextChain, history: [...state.history, event] };
}

/**
 * Evade (the Jump lane) — Focus and chain only.
 *
 * Mechanically the cheapest guard-lane applier: no HP change either way, no
 * parry lookup, no damage. You gave up the counter window to not be there.
 */
function applyEvade(state, event, move) {
  const p = event.player;
  const nextFocus = [...state.focus];
  nextFocus[p] = clampFocus(nextFocus[p] + move.focus); // unconditional +5
  const nextChain = [...state.chain];
  nextChain[p] = nextChainValue(nextChain[p], event.errors);
  return { ...state, focus: nextFocus, chain: nextChain, history: [...state.history, event] };
}

/**
 * Guard-lane dispatch.
 *
 * Every move id is named explicitly and an unrecognised one throws. This was
 * previously `return applyMend(...)` as an unguarded fall-through, which meant
 * any guard-lane move that wasn't `guard` or `parry` silently became a heal —
 * `evade` only escaped that by having `healsHp: 0`, i.e. by luck rather than by
 * design. `getMove` already throws on an unknown id, so a move reaching here
 * unhandled is a table/dispatch disagreement, and failing loudly is the only
 * safe answer for a function that decides HP.
 */
function applyGuardLane(state, event, move, allEvents) {
  if (move.id === 'guard') return applyGuard(state, event, move);
  if (move.id === 'parry') return applyParry(state, event, move, allEvents);
  if (move.id === 'mend') return applyMend(state, event, move);
  if (move.id === 'evade') return applyEvade(state, event, move);
  throw new Error(`Unhandled guard-lane move: ${move.id}`);
}

export function stepEvent(state, event, allEvents, damageMul = 1.00) {
  if (event.outcome === 'whiff') return applyWhiff(state, event);
  if (event.outcome === 'expire') return applyExpiry(state, event);
  const move = getMove(event.moveId);
  if (move.lane === LANES.STRIKE) return applyStrike(state, event, move, allEvents, damageMul);
  return applyGuardLane(state, event, move, allEvents);
}

export const DOUBLE_KO_WINDOW_MS = 120; // §12.3: "within the same 120ms resolution window"
export const ROUND_TIME_CAP_MS = 90000; // §12.2

export function finalizeOutcome(state, { timeUp = false } = {}) {
  const [ko0, ko1] = state.koAt;

  if (ko0 != null && ko1 != null) {
    if (Math.abs(ko0 - ko1) <= DOUBLE_KO_WINDOW_MS) {
      return { ...state, outcome: { type: 'double-ko', winner: null } };
    }
    return { ...state, outcome: { type: 'ko', winner: ko0 < ko1 ? 1 : 0 } };
  }
  if (ko0 != null) return { ...state, outcome: { type: 'ko', winner: 1 } };
  if (ko1 != null) return { ...state, outcome: { type: 'ko', winner: 0 } };

  if (timeUp) {
    if (state.hp[0] === state.hp[1]) return { ...state, outcome: { type: 'time-draw', winner: null } };
    return { ...state, outcome: { type: 'time', winner: state.hp[0] > state.hp[1] ? 0 : 1 } };
  }

  return state; // still open
}

export function reduceRound(events, options = {}) {
  const { timeUp = false, initialState, damageMul = 1.00 } = options;
  const start = initialState ? { ...initialRoundState(), ...initialState } : initialRoundState();
  const sorted = [...events].sort((a, b) => (a.tEnd - b.tEnd) || (a.player - b.player) || (a.seq - b.seq));
  const folded = sorted.reduce((s, e) => stepEvent(s, e, sorted, damageMul), start);
  return finalizeOutcome(folded, { timeUp });
}
