/**
 * The 8 MVP moves, as data — PRD §10.1. `focus` is the Focus delta on a
 * clean strike completion, or the unconditional delta on completion for
 * guard-lane moves and the two spend moves (overdrive, mend). Positive is
 * a gain; negative is a cost applied on play regardless of `errors`.
 * `guardFactor` is the multiplier §8.4 applies when this move's target is
 * guarding — 0.85 for Shuriken (guard barely reduces it), 0.50 for every
 * other strike, `null` for guard-lane moves (never the attacking move).
 */

export const LANES = { STRIKE: 'strike', GUARD: 'guard' };

export const MOVES = {
  jab: {
    id: 'jab', name: 'Jab', lane: LANES.STRIKE,
    base: 6, focus: 4, committed: false, guardFactor: 0.50,
    resetsChain: false, healsHp: 0,
  },
  slash: {
    id: 'slash', name: 'Slash', lane: LANES.STRIKE,
    base: 10, focus: 6, committed: false, guardFactor: 0.50,
    resetsChain: false, healsHp: 0,
  },
  crush: {
    id: 'crush', name: 'Crush', lane: LANES.STRIKE,
    base: 16, focus: 8, committed: true, guardFactor: 0.50,
    resetsChain: false, healsHp: 0,
  },
  shuriken: {
    id: 'shuriken', name: 'Shuriken', lane: LANES.STRIKE,
    base: 7, focus: 5, committed: false, guardFactor: 0.85,
    resetsChain: false, healsHp: 0,
  },
  overdrive: {
    id: 'overdrive', name: 'Overdrive', lane: LANES.STRIKE,
    base: 30, focus: -100, committed: true, guardFactor: 0.50,
    resetsChain: true, healsHp: 0,
  },
  guard: {
    id: 'guard', name: 'Guard', lane: LANES.GUARD,
    base: 0, focus: 3, committed: false, guardFactor: null,
    resetsChain: false, healsHp: 0,
  },
  parry: {
    id: 'parry', name: 'Parry', lane: LANES.GUARD,
    base: 0, focus: 10, committed: false, guardFactor: null,
    resetsChain: false, healsHp: 0,
  },
  mend: {
    id: 'mend', name: 'Mend', lane: LANES.GUARD,
    base: 0, focus: -25, committed: true, guardFactor: null,
    resetsChain: false, healsHp: 120,
  },
  /**
   * Evade — the Jump lane (9th move, a divergence from §10.1's eight).
   *
   * The Stickman avatar presents three lanes (Fight / Shield / Jump), but the
   * reducer has two. Jump resolves as a GUARD-lane move rather than a third
   * mechanical lane, because a third lane would mean surgery on
   * `stepEvent`'s dispatch and would invalidate the combat fixtures — and
   * because a jump *is* defensive, so nothing is lost by classing it there.
   *
   * `focus: 5` sits deliberately between Guard (+3, cheap and safe) and
   * Parry (+10, high risk / high reward): evading is safer than parrying and
   * worth more than blocking, because it costs you the counter window.
   *
   * See docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §4.1.
   */
  evade: {
    id: 'evade', name: 'Evade', lane: LANES.GUARD,
    base: 0, focus: 5, committed: false, guardFactor: null,
    resetsChain: false, healsHp: 0,
  },
};

export function getMove(id) {
  const move = MOVES[id];
  if (!move) throw new Error(`Unknown move id: ${id}`);
  return move;
}
