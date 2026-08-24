import { LANES, MOVES, getMove } from './moveTable.js';
import {
  CONTEST, computeDamage, reflectedDamage,
  isCritical, precisionFactor, speedFactor, parMs,
} from './damage.js';
import {
  clampHp, clampFocus, nextChainValue, chainMilestoneBonus,
  strikeInFlightAt, deriveContestState, FLAT_ERROR_FOCUS_GAIN,
} from './roundState.js';

/**
 * The public combat reducer (SB-CMB-1) — `stepEvent` is the atomic pure
 * transition, `reduceRound` folds a full log through it. Both take
 * *resolved* events: the wire CombatEvent (§8.2) plus `moveId` and
 * `chars`, which Plan 2's seeded queue resolves from `cardIndex` before
 * events reach this module (see the design doc's "Event resolution
 * seam"). `ikiStats` rides along on `history` entries but is not read
 * here — it's reserved for the anti-cheat plan (§21.2).
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

function applyStrike(state, event, move, allEvents) {
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
    contestState, guardFactor: move.guardFactor,
  });

  const nextHp = [...state.hp];
  nextHp[defender] = clampHp(nextHp[defender] - dealt);

  const nextKoAt = [...state.koAt];
  if (nextHp[defender] === 0 && nextKoAt[defender] == null) nextKoAt[defender] = event.tEnd;

  if (parriedBy) {
    const neutral = computeDamage({
      base: move.base, chars: event.chars, actualMs: duration,
      errors: event.errors, chain: state.chain[attacker],
      contestState: CONTEST.NEUTRAL, guardFactor: move.guardFactor,
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

export function stepEvent(state, event, allEvents) {
  if (event.outcome === 'whiff') return applyWhiff(state, event);
  if (event.outcome === 'expire') return applyExpiry(state, event);
  const move = getMove(event.moveId);
  if (move.lane === LANES.STRIKE) return applyStrike(state, event, move, allEvents);
  // Guard-lane 'complete' handling arrives in Task 5.
  throw new Error(`Guard-lane resolution not yet implemented for move: ${event.moveId}`);
}
