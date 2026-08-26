/**
 * §12.2-12.5's round-outcome fold into match state. Pure, no I/O — this
 * is one level up from combat.js's per-round reducer, folding a sequence
 * of already-decided round outcomes rather than raw events. Rematch
 * (§12.6) and forfeit-on-disconnect are not here — see the design doc's
 * scope boundary.
 */

const ROUNDS_TO_WIN = 2; // §12.2
const HARD_STOP_ROUNDS = 5; // §12.3

export function initialMatchState() {
  return {
    wins: [0, 0],
    draws: 0,
    roundsPlayed: 0,
    hpRemainingSum: [0, 0],
    phase: 'in-progress',
    outcome: null,
  };
}

export function applyRoundOutcome(state, roundOutcome) {
  if (!roundOutcome || !Array.isArray(roundOutcome.hpRemaining) || roundOutcome.hpRemaining.length !== 2) {
    throw new Error('applyRoundOutcome requires a roundOutcome with a 2-element hpRemaining array — got: ' + JSON.stringify(roundOutcome));
  }
  if (state.phase === 'complete') {
    throw new Error('applyRoundOutcome called on a completed match');
  }

  if (state.phase === 'sudden-death') {
    if (roundOutcome.winner == null) {
      return { ...state, phase: 'complete', outcome: { type: 'match-draw', winner: null } };
    }
    return { ...state, phase: 'complete', outcome: { type: 'match', winner: roundOutcome.winner } };
  }

  const wins = [...state.wins];
  let draws = state.draws;
  const isDraw = roundOutcome.winner == null;
  if (isDraw) draws += 1;
  else wins[roundOutcome.winner] += 1;

  const roundsPlayed = state.roundsPlayed + 1;
  const hpRemainingSum = [
    state.hpRemainingSum[0] + roundOutcome.hpRemaining[0],
    state.hpRemainingSum[1] + roundOutcome.hpRemaining[1],
  ];

  const next = { ...state, wins, draws, roundsPlayed, hpRemainingSum };

  if (wins[0] >= ROUNDS_TO_WIN || wins[1] >= ROUNDS_TO_WIN) {
    return { ...next, phase: 'complete', outcome: { type: 'match', winner: wins[0] > wins[1] ? 0 : 1 } };
  }

  if (roundsPlayed >= HARD_STOP_ROUNDS) {
    if (hpRemainingSum[0] === hpRemainingSum[1]) {
      return { ...next, phase: 'complete', outcome: { type: 'match-draw', winner: null } };
    }
    return { ...next, phase: 'complete', outcome: { type: 'match', winner: hpRemainingSum[0] > hpRemainingSum[1] ? 0 : 1 } };
  }

  if (wins[0] === 1 && wins[1] === 1 && draws >= 1) {
    return { ...next, phase: 'sudden-death' };
  }

  return next;
}
