# Shadow Battle Combat Reducer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/lib/shadow/` — a pure, dependency-free JS module that turns a sorted log of resolved combat events into round and match state, exactly as PRD §8.1 specifies (`combatState = reduce(initialState, sortedEventLog)`). This is Plan 1 of the 8-plan Shadow Battle build sequence; everything downstream (word system, trial mode, backend, multiplayer, battle UI) calls into this module instead of reimplementing combat math.

**Architecture:** Five small modules, each owning one PRD section: `moveTable.js` (§10.1 move data), `damage.js` (§8.3-8.4 damage formula), `roundState.js` (§11 Focus/Chain/contest-state derivation), `combat.js` (the public `stepEvent`/`reduceRound` API composing the above, plus §12.3 round-outcome finalization), `match.js` (§12.3-12.5 round-outcome fold into match state). No React, no DOM, no I/O, no `Math.random`, no `Date.now` — this must run unmodified in a Deno-based Supabase Edge Function later (Plan 4), per the design doc's §36-Q6 resolution.

**Tech Stack:** Vitest (already configured — `vitest.config.js`, `npm test`), plain JS (no TypeScript in this codebase).

**Spec:** `docs/superpowers/specs/2026-08-25-shadow-battle-combat-reducer-design.md` — read it first, it argues the design decisions this plan implements. Cross-referenced against `docs/08-PRD-shadow-battle.md` §8-§12, §36-Q6, §37.1.

## Global Constraints

- No `Math.random`, no `Date.now`, no floating-point accumulation order dependence anywhere in `src/lib/shadow/` (SB-CMB-2). All HP/damage arithmetic is integer tenths of an HP point, rounded once per resolution (SB-CMB-3).
- No Node-only APIs (`Buffer`, `fs`, `crypto` module, etc.) and no browser-only APIs (`window`, `document`) anywhere in `src/lib/shadow/` — it must run unmodified in a Deno Edge Function later.
- `combat.js`'s `stepEvent`/`reduceRound` operate on **resolved** events (wire `CombatEvent` + `moveId` + `chars`), never on word content. `cardIndex` is carried through but never interpreted.
- `ikiStats` is carried on events into `history` but consumed by nothing in this plan — it's reserved for the anti-cheat plan (§21.2). Say so in `combat.js`'s docblock.
- Every PRD number (base damage, Focus deltas, timing constants, clamps) is copied verbatim from §8-§12 — no invented or rounded-off values.
- **Out of scope:** word/card text generation and the seeded xorshift32 queue (§9.4, Plan 2); bot event generation (Plan 3); UI (Plan 6); network transport (Plan 5); deploying the Edge Function (Plan 4); anti-cheat consumption of `ikiStats` (Plan 7); XP/Forge Rating (Plan 7); rematch and room lifecycle (§12.6); forfeit-on-disconnect (§12.3 last row).

---

## File Structure

**New:**
- `src/lib/shadow/moveTable.js` — `LANES`, `MOVES`, `getMove(id)`
- `src/lib/shadow/moveTable.test.js`
- `src/lib/shadow/damage.js` — `CONTEST`, `parMs`, `speedFactor`, `precisionFactor`, `chainMul`, `contestFactor`, `isCritical`, `critMul`, `computeDamage`, `reflectedDamage`
- `src/lib/shadow/damage.test.js`
- `src/lib/shadow/roundState.js` — `TIMING`, `MAX_HP_TENTHS`, `MAX_FOCUS`, `FLAT_ERROR_FOCUS_GAIN`, `CHAIN_MILESTONE_BONUS_FOCUS`, `initialRoundState`, `clampHp`, `clampFocus`, `nextChainValue`, `chainMilestoneBonus`, `strikeInFlightAt`, `parrySucceeded`, `deriveContestState`
- `src/lib/shadow/roundState.test.js`
- `src/lib/shadow/combat.js` — `DOUBLE_KO_WINDOW_MS`, `ROUND_TIME_CAP_MS`, `stepEvent`, `reduceRound`, `finalizeOutcome`
- `src/lib/shadow/combat.test.js`
- `src/lib/shadow/combat.determinism.test.js`
- `src/lib/shadow/fixtures/*.json` — hand-authored event-log-in/state-out vectors
- `src/lib/shadow/combat.fixtures.test.js` — loads and runs every fixture
- `src/lib/shadow/match.js` — `initialMatchState`, `applyRoundOutcome`
- `src/lib/shadow/match.test.js`

**Modified:** none — this plan only adds new, self-contained files.

---

### Task 1: Move table

**Files:**
- Create: `src/lib/shadow/moveTable.js`
- Test: `src/lib/shadow/moveTable.test.js`

**Interfaces:**
- Produces: `LANES = { STRIKE: 'strike', GUARD: 'guard' }`; `MOVES` (object keyed by move id, values `{ id, name, lane, base, focus, committed, guardFactor, resetsChain, healsHp }`); `getMove(id)` (throws on unknown id). `focus` is the Focus delta on a *clean* strike completion (jab/slash/crush/shuriken) or the unconditional delta on completion (guard/parry-on-success/overdrive/mend) — positive is a gain, negative is a cost applied on play regardless of errors. `guardFactor` is the multiplier applied when this move's target is guarding (§8.4); `null` for guard-lane moves, where it's meaningless.
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/moveTable.test.js
import { describe, it, expect } from 'vitest';
import { LANES, MOVES, getMove } from './moveTable.js';

describe('moveTable', () => {
  it('defines the 8 MVP moves with their §10.1 values', () => {
    expect(MOVES.jab).toEqual({
      id: 'jab', name: 'Jab', lane: LANES.STRIKE,
      base: 6, focus: 4, committed: false, guardFactor: 0.50,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.slash).toEqual({
      id: 'slash', name: 'Slash', lane: LANES.STRIKE,
      base: 10, focus: 6, committed: false, guardFactor: 0.50,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.crush).toEqual({
      id: 'crush', name: 'Crush', lane: LANES.STRIKE,
      base: 16, focus: 8, committed: true, guardFactor: 0.50,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.shuriken).toEqual({
      id: 'shuriken', name: 'Shuriken', lane: LANES.STRIKE,
      base: 7, focus: 5, committed: false, guardFactor: 0.85,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.overdrive).toEqual({
      id: 'overdrive', name: 'Overdrive', lane: LANES.STRIKE,
      base: 30, focus: -100, committed: true, guardFactor: 0.50,
      resetsChain: true, healsHp: 0,
    });
    expect(MOVES.guard).toEqual({
      id: 'guard', name: 'Guard', lane: LANES.GUARD,
      base: 0, focus: 3, committed: false, guardFactor: null,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.parry).toEqual({
      id: 'parry', name: 'Parry', lane: LANES.GUARD,
      base: 0, focus: 10, committed: false, guardFactor: null,
      resetsChain: false, healsHp: 0,
    });
    expect(MOVES.mend).toEqual({
      id: 'mend', name: 'Mend', lane: LANES.GUARD,
      base: 0, focus: -25, committed: true, guardFactor: null,
      resetsChain: false, healsHp: 120,
    });
  });

  it('getMove returns the move by id', () => {
    expect(getMove('slash').base).toBe(10);
  });

  it('getMove throws on an unknown id', () => {
    expect(() => getMove('spin-kick')).toThrow(/unknown move/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- moveTable`
Expected: FAIL — `Cannot find module './moveTable.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/moveTable.js
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
};

export function getMove(id) {
  const move = MOVES[id];
  if (!move) throw new Error(`Unknown move id: ${id}`);
  return move;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- moveTable`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/moveTable.js src/lib/shadow/moveTable.test.js
git commit -m "feat(shadow): add the §10.1 move table"
```

---

### Task 2: Damage formula

**Files:**
- Create: `src/lib/shadow/damage.js`
- Test: `src/lib/shadow/damage.test.js`

**Interfaces:**
- Consumes: nothing (leaf module — takes plain numbers/enum strings, not `MOVES` entries, so it stays independently testable).
- Produces: `CONTEST` (enum of the 6 §8.4 contest states); `parMs(chars)`; `speedFactor(parMs, actualMs)`; `precisionFactor(errors)`; `chainMul(chain)`; `contestFactor(state, guardFactor?)`; `isCritical(precision, speed)`; `critMul(precision, speed)`; `computeDamage({ base, chars, actualMs, errors, chain, contestState, guardFactor? })` → integer tenths of HP; `reflectedDamage(neutralDamageTenths)` → integer tenths of HP (§10.7's 60% reflection).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/damage.test.js
import { describe, it, expect } from 'vitest';
import {
  CONTEST, parMs, speedFactor, precisionFactor, chainMul, contestFactor,
  isCritical, critMul, computeDamage, reflectedDamage,
} from './damage.js';

describe('parMs', () => {
  it('§8.3: parMs(chars) = 60000 * (chars + 1) / (5 * 60)', () => {
    expect(parMs(7)).toBe(Math.round(60000 * 8 / 300)); // 1600
  });
});

describe('speedFactor', () => {
  it('is 1.00 exactly at par', () => {
    const par = parMs(7);
    expect(speedFactor(par, par)).toBeCloseTo(1.00, 5);
  });

  it('clamps at 1.40 for a much faster completion', () => {
    const par = parMs(7);
    expect(speedFactor(par, par / 3)).toBe(1.40);
  });

  it('clamps at 0.60 for a much slower completion', () => {
    const par = parMs(7);
    expect(speedFactor(par, par * 5)).toBe(0.60);
  });
});

describe('precisionFactor', () => {
  it('§8.4: the 4-tier table', () => {
    expect(precisionFactor(0)).toBe(1.25);
    expect(precisionFactor(1)).toBe(1.00);
    expect(precisionFactor(2)).toBe(0.80);
    expect(precisionFactor(3)).toBe(0.60);
    expect(precisionFactor(9)).toBe(0.60);
  });
});

describe('chainMul', () => {
  it('§11.3: 1 + min(0.05 * chain, 0.50), capping at chain 10', () => {
    expect(chainMul(0)).toBe(1.00);
    expect(chainMul(6)).toBeCloseTo(1.30, 5);
    expect(chainMul(10)).toBe(1.50);
    expect(chainMul(20)).toBe(1.50);
  });
});

describe('contestFactor', () => {
  it('§8.4: the contest-state table, default guardFactor 0.50', () => {
    expect(contestFactor(CONTEST.NEUTRAL)).toBe(1.00);
    expect(contestFactor(CONTEST.GUARDING)).toBe(0.50);
    expect(contestFactor(CONTEST.PARRYING)).toBe(0.00);
    expect(contestFactor(CONTEST.EXPOSED)).toBe(1.25);
    expect(contestFactor(CONTEST.COMMITTED)).toBe(1.50);
    expect(contestFactor(CONTEST.STAGGERED)).toBe(1.35);
  });

  it("Shuriken's guardFactor (0.85) overrides Guarding only", () => {
    expect(contestFactor(CONTEST.GUARDING, 0.85)).toBe(0.85);
    expect(contestFactor(CONTEST.NEUTRAL, 0.85)).toBe(1.00);
  });

  it('throws on an unknown state', () => {
    expect(() => contestFactor('confused')).toThrow(/unknown contest state/i);
  });
});

describe('isCritical / critMul', () => {
  it('§8.4: precision === 1.25 AND speed >= 1.25, both axes, no randomness', () => {
    expect(isCritical(1.25, 1.25)).toBe(true);
    expect(isCritical(1.25, 1.24)).toBe(false);
    expect(isCritical(1.00, 1.40)).toBe(false);
    expect(critMul(1.25, 1.30)).toBe(1.50);
    expect(critMul(1.00, 1.40)).toBe(1.00);
  });
});

// §8.5 worked examples, reproduced exactly (non-reflection rows — the
// reflection row is a combat.js/fixture concern, see Task 5 and Task 7).
describe('computeDamage — §8.5 worked examples', () => {
  it('Clean Slash at par, chain 0, neutral → 12.5', () => {
    const par = parMs(7);
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: par, errors: 0, chain: 0,
      contestState: CONTEST.NEUTRAL,
    });
    expect(tenths).toBe(125);
  });

  it('Same, opponent guarding → 6.3', () => {
    const par = parMs(7);
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: par, errors: 0, chain: 0,
      contestState: CONTEST.GUARDING, guardFactor: 0.50,
    });
    expect(tenths).toBe(63);
  });

  it('Clean Slash 30% under par, chain 6, neutral → Critical → 31.7', () => {
    const par = parMs(7);
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: par / 1.30, errors: 0, chain: 6,
      contestState: CONTEST.NEUTRAL,
    });
    expect(tenths).toBe(317);
  });

  it('Sloppy Crush, over par, opponent guarding → 3.4', () => {
    const par = parMs(12);
    const tenths = computeDamage({
      base: 16, chars: 12, actualMs: par / 0.70, errors: 3, chain: 0,
      contestState: CONTEST.GUARDING, guardFactor: 0.50,
    });
    expect(tenths).toBe(34);
  });

  it('Clean Jab into a committed opponent → 11.3', () => {
    const par = parMs(4);
    const tenths = computeDamage({
      base: 6, chars: 4, actualMs: par, errors: 0, chain: 0,
      contestState: CONTEST.COMMITTED,
    });
    expect(tenths).toBe(113);
  });

  it('Overdrive, clean, at par, chain 10, neutral → 56.3', () => {
    const par = parMs(18);
    const tenths = computeDamage({
      base: 30, chars: 18, actualMs: par, errors: 0, chain: 10,
      contestState: CONTEST.NEUTRAL,
    });
    expect(tenths).toBe(563);
  });

  it('Damage arithmetic is integer tenths — no float ever escapes', () => {
    const tenths = computeDamage({
      base: 10, chars: 7, actualMs: parMs(7), errors: 0, chain: 0,
      contestState: CONTEST.NEUTRAL,
    });
    expect(Number.isInteger(tenths)).toBe(true);
  });
});

describe('reflectedDamage — §10.7', () => {
  it('is 60% of the fully-computed (neutral-contest) incoming damage', () => {
    // A Slash that would have dealt 12.5 HP (125 tenths) at neutral —
    // reflected at 60% = 7.5 HP.
    expect(reflectedDamage(125)).toBe(75);
  });

  it('rounds once, to integer tenths', () => {
    expect(Number.isInteger(reflectedDamage(101))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- damage`
Expected: FAIL — `Cannot find module './damage.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/damage.js
import { CHARS_PER_WORD } from '../typing.js';

/**
 * The §8 damage formula, in integer tenths of an HP point (SB-CMB-3) —
 * every sub-factor is a float, but `computeDamage`/`reflectedDamage` round
 * exactly once, at the end. No `Math.random`, no `Date.now` (SB-CMB-2):
 * every input here is a fact already present on a resolved CombatEvent.
 */

const REF_WPM = 60;

export function parMs(chars) {
  return Math.round((60000 * (chars + 1)) / (CHARS_PER_WORD * REF_WPM));
}

export function speedFactor(parMsValue, actualMs) {
  const raw = parMsValue / Math.max(actualMs, 1);
  return Math.min(1.40, Math.max(0.60, raw));
}

export function precisionFactor(errors) {
  if (errors === 0) return 1.25;
  if (errors === 1) return 1.00;
  if (errors === 2) return 0.80;
  return 0.60;
}

export function chainMul(chain) {
  return 1 + Math.min(0.05 * chain, 0.50);
}

export const CONTEST = {
  NEUTRAL: 'neutral',
  GUARDING: 'guarding',
  PARRYING: 'parrying',
  EXPOSED: 'exposed',
  COMMITTED: 'committed',
  STAGGERED: 'staggered',
};

export function contestFactor(state, guardFactor = 0.50) {
  switch (state) {
    case CONTEST.NEUTRAL: return 1.00;
    case CONTEST.GUARDING: return guardFactor;
    case CONTEST.PARRYING: return 0.00;
    case CONTEST.EXPOSED: return 1.25;
    case CONTEST.COMMITTED: return 1.50;
    case CONTEST.STAGGERED: return 1.35;
    default: throw new Error(`Unknown contest state: ${state}`);
  }
}

export function isCritical(precision, speed) {
  return precision === 1.25 && speed >= 1.25;
}

export function critMul(precision, speed) {
  return isCritical(precision, speed) ? 1.50 : 1.00;
}

export function computeDamage({ base, chars, actualMs, errors, chain, contestState, guardFactor = 0.50 }) {
  const par = parMs(chars);
  const speed = speedFactor(par, actualMs);
  const precision = precisionFactor(errors);
  const chainFactor = chainMul(chain);
  const contest = contestFactor(contestState, guardFactor);
  const crit = critMul(precision, speed);
  const raw = base * speed * precision * chainFactor * contest * crit;
  return Math.round(raw * 10);
}

// §10.7: a reflected strike's damage is 60% of the incoming strike's
// fully-computed damage at NEUTRAL contest (the caller computes that
// value by calling computeDamage with contestState: CONTEST.NEUTRAL).
export function reflectedDamage(neutralDamageTenths) {
  return Math.round(neutralDamageTenths * 0.60);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- damage`
Expected: PASS (all cases, including every §8.5 worked example by literal value)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/damage.js src/lib/shadow/damage.test.js
git commit -m "feat(shadow): add the §8.3-8.4 damage formula, verified against every §8.5 worked example"
```

---

### Task 3: Round state — clamps, Focus/Chain rules, contest-state derivation

**Files:**
- Create: `src/lib/shadow/roundState.js`
- Test: `src/lib/shadow/roundState.test.js`

**Interfaces:**
- Consumes: `LANES, MOVES` from `./moveTable.js`; `CONTEST` from `./damage.js`.
- Produces: `TIMING` (§10.5 constants: `GUARD_DURATION_MS`, `EXPOSED_DURATION_MS`, `STAGGER_DURATION_MS`, `SHURIKEN_TRAVEL_MS`, `INTER_CARD_GAP_MS`); `MAX_HP_TENTHS` (1000), `MAX_FOCUS` (100), `FLAT_ERROR_FOCUS_GAIN` (2), `CHAIN_MILESTONE_STEP` (5), `CHAIN_MILESTONE_BONUS_FOCUS` (5); `initialRoundState()` → `{ hp: [1000,1000], focus: [0,0], chain: [0,0], koAt: [null,null], history: [], outcome: null }`; `clampHp(v)`, `clampFocus(v)`; `nextChainValue(chain, errors)`; `chainMilestoneBonus(prevChain, nextChain)`; `strikeInFlightAt(strikeEvent, tMs)`; `parrySucceeded(allEvents, parryEvent)`; `deriveContestState(allEvents, player, atTimeMs)` (Committed > Guarding > Exposed > Staggered > Neutral priority; does **not** determine Parrying — that's specific to one strike vs. one parry, resolved by `combat.js`).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/roundState.test.js
import { describe, it, expect } from 'vitest';
import { CONTEST } from './damage.js';
import {
  TIMING, MAX_HP_TENTHS, MAX_FOCUS, FLAT_ERROR_FOCUS_GAIN,
  CHAIN_MILESTONE_STEP, CHAIN_MILESTONE_BONUS_FOCUS,
  initialRoundState, clampHp, clampFocus, nextChainValue,
  chainMilestoneBonus, strikeInFlightAt, parrySucceeded, deriveContestState,
} from './roundState.js';

describe('initialRoundState', () => {
  it('§11: HP 100 (1000 tenths), Focus 0, Chain 0, no history, no outcome', () => {
    expect(initialRoundState()).toEqual({
      hp: [1000, 1000], focus: [0, 0], chain: [0, 0],
      koAt: [null, null], history: [], outcome: null,
    });
  });
});

describe('clamps', () => {
  it('clampHp holds to [0, MAX_HP_TENTHS]', () => {
    expect(clampHp(-50)).toBe(0);
    expect(clampHp(MAX_HP_TENTHS + 100)).toBe(MAX_HP_TENTHS);
    expect(clampHp(500)).toBe(500);
  });

  it('clampFocus holds to [0, MAX_FOCUS]', () => {
    expect(clampFocus(-10)).toBe(0);
    expect(clampFocus(150)).toBe(MAX_FOCUS);
    expect(clampFocus(40)).toBe(40);
  });
});

describe('nextChainValue — §11.3', () => {
  it('0 errors: chain grows', () => {
    expect(nextChainValue(4, 0)).toBe(5);
  });
  it('1 error: chain holds (forgiven, but does not grow)', () => {
    expect(nextChainValue(4, 1)).toBe(4);
  });
  it('2+ errors: chain resets to 0', () => {
    expect(nextChainValue(4, 2)).toBe(0);
    expect(nextChainValue(4, 5)).toBe(0);
  });
});

describe('chainMilestoneBonus — §11.2', () => {
  it('crossing a multiple of 5 awards +5 Focus', () => {
    expect(chainMilestoneBonus(4, 5)).toBe(CHAIN_MILESTONE_BONUS_FOCUS);
    expect(chainMilestoneBonus(9, 10)).toBe(CHAIN_MILESTONE_BONUS_FOCUS);
  });
  it('not crossing a multiple of 5 awards nothing', () => {
    expect(chainMilestoneBonus(5, 6)).toBe(0);
    expect(chainMilestoneBonus(4, 0)).toBe(0); // a reset is not a crossing
  });
  it('CHAIN_MILESTONE_STEP is 5', () => {
    expect(CHAIN_MILESTONE_STEP).toBe(5);
  });
});

const strike = (overrides) => ({
  seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'strike',
  outcome: 'complete', tStart: 0, tEnd: 900, keystrokes: 7, errors: 0,
  ikiStats: [120, 15], moveId: 'slash', chars: 7, ...overrides,
});

describe('strikeInFlightAt', () => {
  it('true while tStart <= t < tEnd', () => {
    const s = strike({ tStart: 100, tEnd: 900 });
    expect(strikeInFlightAt(s, 100)).toBe(true);
    expect(strikeInFlightAt(s, 500)).toBe(true);
    expect(strikeInFlightAt(s, 899)).toBe(true);
  });
  it('false before tStart or at/after tEnd', () => {
    const s = strike({ tStart: 100, tEnd: 900 });
    expect(strikeInFlightAt(s, 99)).toBe(false);
    expect(strikeInFlightAt(s, 900)).toBe(false);
  });
});

describe('parrySucceeded — §10.3', () => {
  it('true when an opposing strike is in flight at the parry\'s tEnd', () => {
    const events = [
      strike({ seq: 0, player: 1, moveId: 'crush', tStart: 0, tEnd: 1500 }),
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 100, tEnd: 500, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    expect(parrySucceeded(events, events[1])).toBe(true);
  });

  it('false when no opposing strike is in flight', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 100, tEnd: 500, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    expect(parrySucceeded(events, events[0])).toBe(false);
  });
});

describe('deriveContestState — §8.4 priority: Committed > Guarding > Exposed > Staggered > Neutral', () => {
  it('Neutral with no history', () => {
    expect(deriveContestState([], 0, 1000)).toBe(CONTEST.NEUTRAL);
  });

  it('Guarding for GUARD_DURATION_MS after a completed Guard', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 300, keystrokes: 4, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 4 },
    ];
    expect(deriveContestState(events, 0, 300)).toBe(CONTEST.GUARDING);
    expect(deriveContestState(events, 0, 300 + TIMING.GUARD_DURATION_MS - 1)).toBe(CONTEST.GUARDING);
    expect(deriveContestState(events, 0, 300 + TIMING.GUARD_DURATION_MS)).toBe(CONTEST.NEUTRAL);
  });

  it('Committed for the duration of a Crush/Overdrive/Mend, even mid-move', () => {
    const events = [strike({ player: 0, moveId: 'crush', tStart: 0, tEnd: 1500 })];
    expect(deriveContestState(events, 0, 0)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 750)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 1500)).toBe(CONTEST.COMMITTED);
    expect(deriveContestState(events, 0, 1501)).toBe(CONTEST.NEUTRAL);
  });

  it('Exposed for EXPOSED_DURATION_MS after a failed Parry', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 400, keystrokes: 5, errors: 0, ikiStats: [80, 5], moveId: 'parry', chars: 5 },
    ];
    expect(deriveContestState(events, 0, 400)).toBe(CONTEST.EXPOSED);
    expect(deriveContestState(events, 0, 400 + TIMING.EXPOSED_DURATION_MS)).toBe(CONTEST.NEUTRAL);
  });

  it('a successful Parry does not expose', () => {
    const events = [
      strike({ seq: 0, player: 1, moveId: 'slash', tStart: 0, tEnd: 900 }),
      { seq: 1, player: 0, round: 1, cardIndex: 1, lane: 'guard', outcome: 'complete', tStart: 100, tEnd: 500, keystrokes: 5, errors: 0, ikiStats: [90, 10], moveId: 'parry', chars: 5 },
    ];
    expect(deriveContestState(events, 0, 500)).toBe(CONTEST.NEUTRAL);
  });

  it('Staggered for STAGGER_DURATION_MS after a card expires', () => {
    const events = [
      { ...strike({ player: 0, outcome: 'expire', tStart: 0, tEnd: 600 }) },
    ];
    expect(deriveContestState(events, 0, 600)).toBe(CONTEST.STAGGERED);
    expect(deriveContestState(events, 0, 600 + TIMING.STAGGER_DURATION_MS)).toBe(CONTEST.NEUTRAL);
  });

  it('Committed outranks a concurrent Guarding window', () => {
    const events = [
      { seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 100, keystrokes: 3, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 3 },
      strike({ seq: 1, player: 0, moveId: 'mend', lane: 'guard', tStart: 150, tEnd: 1250 }),
    ];
    // at t=200: both the Guard window (100..1300) and the Mend window (150..1250) cover it
    expect(deriveContestState(events, 0, 200)).toBe(CONTEST.COMMITTED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- roundState`
Expected: FAIL — `Cannot find module './roundState.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/roundState.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- roundState`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/roundState.js src/lib/shadow/roundState.test.js
git commit -m "feat(shadow): add §11 Focus/Chain rules and §8.4 contest-state derivation"
```

---

### Task 4: combat.js — strike-lane resolution and KO tracking

**Files:**
- Create: `src/lib/shadow/combat.js`
- Test: `src/lib/shadow/combat.test.js`

**Interfaces:**
- Consumes: `LANES, MOVES, getMove` from `./moveTable.js`; `CONTEST, computeDamage, reflectedDamage` from `./damage.js`; `clampHp, clampFocus, nextChainValue, chainMilestoneBonus, strikeInFlightAt, deriveContestState, FLAT_ERROR_FOCUS_GAIN` from `./roundState.js`. The test file additionally imports `initialRoundState` from `./roundState.js` directly (to build starting states for `stepEvent` calls) — `combat.js` itself doesn't need it until Task 6's `reduceRound`.
- Produces (this task): `stepEvent(state, event, allEvents)` handling strike-lane `complete`/`expire`/`whiff` outcomes, tracking `koAt`. Guard-lane handling (Task 5) and `reduceRound`/`finalizeOutcome` (Task 6) come in later tasks — this task's tests call `stepEvent` directly with a hand-built `state`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/combat.test.js
import { describe, it, expect } from 'vitest';
import { CONTEST, parMs } from './damage.js';
import { initialRoundState } from './roundState.js';
import { stepEvent } from './combat.js';

const strike = (overrides) => ({
  seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'strike',
  outcome: 'complete', tStart: 0, tEnd: 900, keystrokes: 7, errors: 0,
  ikiStats: [120, 15], moveId: 'slash', chars: 7, ...overrides,
});

describe('stepEvent — strike lane, complete', () => {
  it('a clean Slash at par against a neutral opponent deals 12.5 HP and grants +6 Focus, +1 chain', () => {
    const event = strike({ tEnd: parMs(7) });
    const next = stepEvent(initialRoundState(), event, [event]);
    expect(next.hp).toEqual([1000, 875]); // 1000 - 125
    expect(next.focus).toEqual([6, 0]);
    expect(next.chain).toEqual([1, 0]);
    expect(next.history).toEqual([event]);
  });

  it('a Slash landed with 1 error grants the flat +2 Focus instead of the clean bonus', () => {
    const event = strike({ tEnd: parMs(7), errors: 1 });
    const next = stepEvent(initialRoundState(), event, [event]);
    expect(next.focus).toEqual([2, 0]);
    expect(next.chain).toEqual([0, 0]); // 1 error: held, not grown
  });

  it('2+ errors resets the attacker\'s own chain', () => {
    const state = { ...initialRoundState(), chain: [5, 0] };
    const event = strike({ tEnd: parMs(7), errors: 2 });
    const next = stepEvent(state, event, [event]);
    expect(next.chain).toEqual([0, 0]);
  });

  it('Overdrive spends all Focus and resets the attacker\'s chain, win or not', () => {
    const state = { ...initialRoundState(), focus: [100, 0], chain: [8, 0] };
    const event = strike({ moveId: 'overdrive', chars: 18, tEnd: parMs(18), errors: 0 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([0, 0]);
    expect(next.chain).toEqual([0, 0]);
  });

  it('taking a Critical hit breaks the defender\'s chain', () => {
    const state = { ...initialRoundState(), chain: [0, 4] };
    // clean, well under par -> speed 1.40 -> Critical
    const event = strike({ tEnd: parMs(7) / 2 });
    const next = stepEvent(state, event, [event]);
    expect(next.chain[1]).toBe(0);
  });

  it('a Committed target takes contest x1.50', () => {
    const crushEvent = strike({ player: 1, moveId: 'crush', chars: 12, tStart: 0, tEnd: 1500 });
    const jab = strike({ player: 0, moveId: 'jab', chars: 4, tStart: 200, tEnd: 200 + parMs(4) });
    const next = stepEvent(initialRoundState(), jab, [crushEvent, jab]);
    // §8.5: Clean Jab into a committed opponent -> 11.3 (113 tenths)
    expect(next.hp[1]).toBe(1000 - 113);
  });

  it('a Shuriken vs. a guarding target is reduced only 15%, not 50%', () => {
    // Guard's window is 300..1500; the Shuriken has to resolve inside it,
    // so it starts at t=0 (at par: tEnd = parMs(6) = 1400).
    const guardEvent = { seq: 0, player: 1, round: 1, cardIndex: 0, lane: 'guard', outcome: 'complete', tStart: 0, tEnd: 300, keystrokes: 4, errors: 0, ikiStats: [80, 5], moveId: 'guard', chars: 4 };
    const shurikenEvent = strike({ player: 0, moveId: 'shuriken', chars: 6, tStart: 0, tEnd: parMs(6) });
    const next = stepEvent(initialRoundState(), shurikenEvent, [guardEvent, shurikenEvent]);
    const expectedTenths = Math.round(7 * 1.00 * 1.25 * 1.00 * 0.85 * 1.00 * 10);
    expect(next.hp[1]).toBe(1000 - expectedTenths);
  });
});

describe('stepEvent — strike lane, expire', () => {
  it('costs the expiring player 5 Focus and resets their chain; no damage', () => {
    const state = { ...initialRoundState(), focus: [40, 0], chain: [3, 0] };
    const event = strike({ outcome: 'expire', tEnd: 2000 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([35, 0]);
    expect(next.chain).toEqual([0, 0]);
    expect(next.hp).toEqual([1000, 1000]);
  });
});

describe('stepEvent — whiff', () => {
  it('costs the whiffing player 3 Focus; chain and HP untouched', () => {
    const state = { ...initialRoundState(), focus: [10, 0], chain: [3, 0] };
    const event = strike({ outcome: 'whiff', tEnd: 500 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([7, 0]);
    expect(next.chain).toEqual([3, 0]);
    expect(next.hp).toEqual([1000, 1000]);
  });
});

describe('stepEvent — KO tracking', () => {
  it('records koAt the first time a player\'s HP reaches 0, and never overwrites it', () => {
    let state = { ...initialRoundState(), hp: [1000, 50] };
    const lethal = strike({ moveId: 'crush', chars: 12, tStart: 0, tEnd: parMs(12), errors: 0 });
    state = stepEvent(state, lethal, [lethal]);
    expect(state.hp[1]).toBe(0);
    expect(state.koAt[1]).toBe(lethal.tEnd);

    const overkill = strike({ seq: 1, moveId: 'jab', chars: 4, tStart: 2000, tEnd: 2000 + parMs(4) });
    state = stepEvent(state, overkill, [lethal, overkill]);
    expect(state.hp[1]).toBe(0);
    expect(state.koAt[1]).toBe(lethal.tEnd); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- combat.test`
Expected: FAIL — `Cannot find module './combat.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/combat.js
import { LANES, MOVES, getMove } from './moveTable.js';
import { CONTEST, computeDamage, reflectedDamage } from './damage.js';
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

  const precision = event.errors === 0 ? 1.25 : event.errors === 1 ? 1.00 : event.errors === 2 ? 0.80 : 0.60;
  const par = Math.round((60000 * (event.chars + 1)) / (5 * 60));
  const speed = Math.min(1.40, Math.max(0.60, par / duration));
  const wasCritical = precision === 1.25 && speed >= 1.25;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- combat.test`
Expected: PASS (all strike-lane/expire/whiff/KO cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/combat.js src/lib/shadow/combat.test.js
git commit -m "feat(shadow): stepEvent for strike-lane resolution, expiry, whiff and KO tracking"
```

---

### Task 5: combat.js — guard-lane resolution and Parry reflection

**Files:**
- Modify: `src/lib/shadow/combat.js`
- Modify: `src/lib/shadow/combat.test.js`

**Interfaces:**
- Consumes (new): `parrySucceeded` from `./roundState.js`.
- Produces: `stepEvent` now handles all 8 moves. No new exports.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/shadow/combat.test.js`:

```js
const guardLane = (overrides) => ({
  seq: 0, player: 0, round: 1, cardIndex: 0, lane: 'guard',
  outcome: 'complete', tStart: 0, tEnd: 300, keystrokes: 4, errors: 0,
  ikiStats: [80, 5], moveId: 'guard', chars: 4, ...overrides,
});

describe('stepEvent — Guard', () => {
  it('grants +3 Focus unconditionally and follows the general chain rule', () => {
    const event = guardLane({ errors: 1 });
    const next = stepEvent(initialRoundState(), event, [event]);
    expect(next.focus).toEqual([3, 0]);
    expect(next.chain).toEqual([0, 0]); // 1 error: held
  });
});

describe('stepEvent — Parry', () => {
  it('success: +10 Focus, 0 damage to the parrier, 60% reflected to the attacker', () => {
    const parry = guardLane({ player: 0, moveId: 'parry', tStart: 100, tEnd: 500 });
    const attack = strike({ player: 1, moveId: 'slash', chars: 7, tStart: 0, tEnd: parMs(7) });
    let state = initialRoundState();
    const all = [parry, attack];
    state = stepEvent(state, parry, all);
    state = stepEvent(state, attack, all);
    expect(state.focus[0]).toBe(10);
    expect(state.hp[0]).toBe(1000); // parrier takes 0
    // §8.5: "Any strike into a successful Parry: 0 dealt, ~7.5 taken" (a
    // clean-at-par Slash's neutral damage is 12.5 HP; 60% of that is 7.5)
    expect(state.hp[1]).toBe(1000 - 75);
  });

  it('failure: no Focus gain, and the fighter is Exposed for 600ms', () => {
    const parry = guardLane({ player: 0, moveId: 'parry', tStart: 0, tEnd: 50 });
    let state = stepEvent(initialRoundState(), parry, [parry]);
    expect(state.focus).toEqual([0, 0]);

    // A follow-up strike into the exposed window (50..650) takes contest
    // x1.25 — but it must start strictly after the parry's own tEnd (50).
    // If it started at or before 50 it would itself have been "in flight"
    // when the parry resolved, which would make the parry succeed against
    // it instead (findSuccessfulParryAgainst — Task 4) — the two checks
    // share the same strikeInFlightAt window, so a strike can't be both
    // "not yet started" (making the earlier parry fail) and "in flight"
    // (making it the parry's target) at once. Starting after tEnd, the
    // window (600ms) is still narrower than even the fastest strike's
    // at-par duration (Jab at 3 chars: parMs(3) = 800ms), so this
    // necessarily lands as a Critical too — the assertion computes the
    // expected damage from the actual resulting speed rather than
    // assuming a specific one, so that's accounted for either way.
    const par = parMs(3);
    const punish = strike({ player: 1, moveId: 'jab', chars: 3, tStart: 51, tEnd: 550 });
    state = stepEvent(state, punish, [parry, punish]);
    const speed = Math.min(1.40, Math.max(0.60, par / (punish.tEnd - punish.tStart)));
    const precision = 1.25; // errors: 0
    const crit = precision === 1.25 && speed >= 1.25 ? 1.50 : 1.00;
    const expectedTenths = Math.round(6 * speed * precision * 1.00 * 1.25 * crit * 10);
    expect(state.hp[0]).toBe(1000 - expectedTenths);
  });
});

describe('stepEvent — Mend', () => {
  it('costs 25 Focus and heals 12 HP', () => {
    const state = { ...initialRoundState(), hp: [600, 1000], focus: [40, 0] };
    const event = guardLane({ moveId: 'mend', tStart: 0, tEnd: 1100 });
    const next = stepEvent(state, event, [event]);
    expect(next.focus).toEqual([15, 0]);
    expect(next.hp[0]).toBe(720); // 600 + 120 tenths
  });

  it('never heals past MAX_HP_TENTHS', () => {
    const state = { ...initialRoundState(), hp: [950, 1000], focus: [40, 0] };
    const event = guardLane({ moveId: 'mend', tStart: 0, tEnd: 1100 });
    const next = stepEvent(state, event, [event]);
    expect(next.hp[0]).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- combat.test`
Expected: FAIL — the Guard/Parry/Mend tests hit the `throw` left at the end of `stepEvent`.

- [ ] **Step 3: Write minimal implementation**

First, add `parrySucceeded` to the existing `roundState.js` import at the top of `src/lib/shadow/combat.js` (do not add a second `import` line — extend this one):

```js
import {
  clampHp, clampFocus, nextChainValue, chainMilestoneBonus,
  strikeInFlightAt, deriveContestState, FLAT_ERROR_FOCUS_GAIN, parrySucceeded,
} from './roundState.js';
```

Then replace the end of the file (the `stepEvent` export and everything after `applyWhiff`) with:

```js
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

function applyGuardLane(state, event, move, allEvents) {
  if (move.id === 'guard') return applyGuard(state, event, move);
  if (move.id === 'parry') return applyParry(state, event, move, allEvents);
  return applyMend(state, event, move);
}

export function stepEvent(state, event, allEvents) {
  if (event.outcome === 'whiff') return applyWhiff(state, event);
  if (event.outcome === 'expire') return applyExpiry(state, event);
  const move = getMove(event.moveId);
  if (move.lane === LANES.STRIKE) return applyStrike(state, event, move, allEvents);
  return applyGuardLane(state, event, move, allEvents);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- combat.test`
Expected: PASS (all cases, including Guard/Parry/Mend)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/combat.js src/lib/shadow/combat.test.js
git commit -m "feat(shadow): stepEvent for Guard, Parry (with §10.7 reflection) and Mend"
```

---

### Task 6: combat.js — reduceRound, finalizeOutcome, and the determinism guard

**Files:**
- Modify: `src/lib/shadow/combat.js`
- Modify: `src/lib/shadow/combat.test.js`
- Create: `src/lib/shadow/combat.determinism.test.js`

**Interfaces:**
- Produces: `DOUBLE_KO_WINDOW_MS` (120), `ROUND_TIME_CAP_MS` (90000); `finalizeOutcome(state, { timeUp = false })`; `reduceRound(events, { timeUp = false, initialState } = {})` — sorts by `tEnd`, folds via `stepEvent`, then finalizes. `initialState` is an optional partial override merged over `initialRoundState()`, for test/fixture convenience only (reconnection replays the full log from true initial state per §8.1 — this is not a resume mechanism).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/shadow/combat.test.js`:

```js
import { reduceRound, finalizeOutcome, DOUBLE_KO_WINDOW_MS, ROUND_TIME_CAP_MS } from './combat.js';

describe('finalizeOutcome — §12.3', () => {
  it('a single KO: the other player wins', () => {
    const state = { ...initialRoundState(), koAt: [null, 1500] };
    expect(finalizeOutcome(state, {}).outcome).toEqual({ type: 'ko', winner: 0 });
  });

  it('both KO within the 120ms window: double knockout, a draw', () => {
    const state = { ...initialRoundState(), koAt: [1500, 1500 + DOUBLE_KO_WINDOW_MS] };
    expect(finalizeOutcome(state, {}).outcome).toEqual({ type: 'double-ko', winner: null });
  });

  it('both KO more than 120ms apart: the earlier one lost', () => {
    const state = { ...initialRoundState(), koAt: [1500, 1500 + DOUBLE_KO_WINDOW_MS + 1] };
    expect(finalizeOutcome(state, {}).outcome).toEqual({ type: 'ko', winner: 1 });
  });

  it('time cap reached, HP differs: higher HP wins', () => {
    const state = { ...initialRoundState(), hp: [400, 600] };
    expect(finalizeOutcome(state, { timeUp: true }).outcome).toEqual({ type: 'time', winner: 1 });
  });

  it('time cap reached, HP tied: a round draw', () => {
    const state = { ...initialRoundState(), hp: [400, 400] };
    expect(finalizeOutcome(state, { timeUp: true }).outcome).toEqual({ type: 'time-draw', winner: null });
  });

  it('no KO, time not up: still open', () => {
    expect(finalizeOutcome(initialRoundState(), {}).outcome).toBeNull();
  });

  it('ROUND_TIME_CAP_MS is 90 seconds', () => {
    expect(ROUND_TIME_CAP_MS).toBe(90000);
  });
});

describe('reduceRound', () => {
  it('folds a full event log and finalizes the outcome in one call', () => {
    const event = strike({ tEnd: parMs(7) });
    const result = reduceRound([event]);
    expect(result.hp).toEqual([1000, 875]);
    expect(result.outcome).toBeNull(); // no KO, time not up
  });

  it('sorts by tEnd before folding, regardless of input order', () => {
    // Both strikes are the same player's, against the same opponent, so
    // this is a real discriminator: the second strike's chainMul depends
    // on whether the first (earlier tEnd) has already been folded. If
    // reduceRound folded input-array order instead of tEnd order, the two
    // calls below would disagree (second would see chain 0 in one and
    // chain 1 in the other) instead of matching.
    const first = strike({ seq: 0, player: 0, tStart: 0, tEnd: 500 });
    const second = strike({ seq: 1, player: 0, tStart: 600, tEnd: 1000 });
    const forward = reduceRound([first, second]);
    const reversed = reduceRound([second, first]);
    expect(reversed).toEqual(forward);
    expect(forward.chain[0]).toBe(2); // two clean completions, in tEnd order
  });

  it('accepts an initialState override for test convenience (e.g. pre-loaded Focus)', () => {
    const event = strike({ moveId: 'overdrive', chars: 18, tEnd: parMs(18) });
    const result = reduceRound([event], { initialState: { focus: [100, 0] } });
    expect(result.focus).toEqual([0, 0]);
  });

  it('reports a KO outcome once HP crosses 0', () => {
    const lethal = strike({ moveId: 'crush', chars: 12, tEnd: parMs(12) });
    const result = reduceRound([lethal], { initialState: { hp: [1000, 20] } });
    expect(result.outcome.type).toBe('ko');
    expect(result.outcome.winner).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- combat.test`
Expected: FAIL — `reduceRound`/`finalizeOutcome`/`DOUBLE_KO_WINDOW_MS`/`ROUND_TIME_CAP_MS` are not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/shadow/combat.js`:

```js
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
  const { timeUp = false, initialState } = options;
  const start = initialState ? { ...initialRoundState(), ...initialState } : initialRoundState();
  const sorted = [...events].sort((a, b) => a.tEnd - b.tEnd);
  const folded = sorted.reduce((s, e) => stepEvent(s, e, sorted), start);
  return finalizeOutcome(folded, { timeUp });
}
```

Add `initialRoundState` to the existing `from './roundState.js'` import at the top of `combat.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- combat.test`
Expected: PASS

- [ ] **Step 5: Write the determinism guard test**

```js
// src/lib/shadow/combat.determinism.test.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// SB-CMB-2: no Math.random, no Date.now, anywhere in the reducer module set.
const MODULES = ['combat.js', 'damage.js', 'roundState.js', 'moveTable.js'];

describe('determinism guard', () => {
  for (const name of MODULES) {
    it(`${name} contains no Math.random or Date.now`, () => {
      const path = fileURLToPath(new URL(`./${name}`, import.meta.url));
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/Math\.random/);
      expect(source).not.toMatch(/Date\.now/);
    });
  }
});
```

- [ ] **Step 6: Run the determinism test**

Run: `npm test -- combat.determinism`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/shadow/combat.js src/lib/shadow/combat.test.js src/lib/shadow/combat.determinism.test.js
git commit -m "feat(shadow): reduceRound, §12.3 outcome finalization, and a static determinism guard"
```

---

### Task 7: Fixture suite

**Files:**
- Create: `src/lib/shadow/fixtures/*.json` (one file per fixture, see below)
- Create: `src/lib/shadow/combat.fixtures.test.js`

**Interfaces:**
- Consumes: `reduceRound` from `./combat.js`.
- Produces: nothing new — this is a test-only task proving the design doc's "hand-authored coverage set" against the assembled reducer.

Each fixture is `{ name, description, events, options?, expected }`, where `expected` is a **partial** match — only the keys present are asserted (some fixtures care about `outcome`, others about `hp`/`focus`/`chain`).

- [ ] **Step 1: Write the fixture files**

`src/lib/shadow/fixtures/85-clean-slash-neutral.json`:
```json
{
  "name": "85-clean-slash-neutral",
  "description": "PRD §8.5 row 1 — Clean Slash at par, chain 0, opponent neutral -> 12.5",
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1600, "keystrokes": 7, "errors": 0, "ikiStats": [120, 15], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "hp": [1000, 875], "focus": [6, 0], "chain": [1, 0] }
}
```

`src/lib/shadow/fixtures/85-clean-slash-guarded.json`:
```json
{
  "name": "85-clean-slash-guarded",
  "description": "PRD §8.5 row 2 — same, opponent guarding -> 6.3. The guard event resolves at t=800 so its 1200ms window (800..2000) still covers the Slash's at-par resolution at t=1600 — Guard's own duration is short, but the window has to be timed to still be open when the Slash lands, not centered on when Guard itself completes.",
  "events": [
    { "seq": 0, "player": 1, "round": 1, "cardIndex": 0, "lane": "guard", "outcome": "complete", "tStart": 0, "tEnd": 800, "keystrokes": 4, "errors": 0, "ikiStats": [80, 5], "moveId": "guard", "chars": 4 },
    { "seq": 1, "player": 0, "round": 1, "cardIndex": 1, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1600, "keystrokes": 7, "errors": 0, "ikiStats": [120, 15], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "hp": [1000, 937] }
}
```

`src/lib/shadow/fixtures/85-critical-slash.json`:
```json
{
  "name": "85-critical-slash",
  "description": "PRD §8.5 row 3 — clean Slash 30% under par, chain 6, neutral -> Critical -> 31.7",
  "options": { "initialState": { "chain": [6, 0] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1231, "keystrokes": 7, "errors": 0, "ikiStats": [95, 10], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "hp": [1000, 683] }
}
```

`src/lib/shadow/fixtures/85-sloppy-crush-guarded.json`:
```json
{
  "name": "85-sloppy-crush-guarded",
  "description": "PRD §8.5 row 4 — sloppy Crush, over par, opponent guarding -> 3.4. parMs(12) = 2600; actualMs = 3714 gives speed ~= 0.70 (2600/3714). The guard's window (3000..4200) is timed to still cover the Crush's late resolution at t=3714.",
  "events": [
    { "seq": 0, "player": 1, "round": 1, "cardIndex": 0, "lane": "guard", "outcome": "complete", "tStart": 0, "tEnd": 3000, "keystrokes": 4, "errors": 0, "ikiStats": [80, 5], "moveId": "guard", "chars": 4 },
    { "seq": 1, "player": 0, "round": 1, "cardIndex": 1, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 3714, "keystrokes": 12, "errors": 3, "ikiStats": [280, 40], "moveId": "crush", "chars": 12 }
  ],
  "expected": { "hp": [1000, 966] }
}
```

`src/lib/shadow/fixtures/85-jab-committed.json`:
```json
{
  "name": "85-jab-committed",
  "description": "PRD §8.5 row 5 — clean Jab into a committed opponent -> 11.3. Player 1's Crush (tStart 0, tEnd 2600 = parMs(12), at par) is itself an event that resolves and deals its own damage to player 0 — 16 * 1.00 * 1.25 * 1.00(neutral, chain 0) = 20.0 HP (200 tenths) — so expected.hp[0] is 800, not 1000. The Jab (tStart 500, tEnd 1500 = parMs(4), at par) resolves at t=1500, inside the Crush's committed window [0, 2600].",
  "events": [
    { "seq": 0, "player": 1, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 2600, "keystrokes": 12, "errors": 0, "ikiStats": [300, 20], "moveId": "crush", "chars": 12 },
    { "seq": 1, "player": 0, "round": 1, "cardIndex": 1, "lane": "strike", "outcome": "complete", "tStart": 500, "tEnd": 1500, "keystrokes": 4, "errors": 0, "ikiStats": [180, 10], "moveId": "jab", "chars": 4 }
  ],
  "expected": { "hp": [800, 887] }
}
```

`src/lib/shadow/fixtures/85-overdrive-neutral.json`:
```json
{
  "name": "85-overdrive-neutral",
  "description": "PRD §8.5 row 6 — Overdrive, clean, at par, chain 10, neutral -> 56.3",
  "options": { "initialState": { "focus": [100, 0], "chain": [10, 0] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 3800, "keystrokes": 18, "errors": 0, "ikiStats": [200, 15], "moveId": "overdrive", "chars": 18 }
  ],
  "expected": { "hp": [1000, 437], "focus": [0, 0], "chain": [0, 0] }
}
```

`src/lib/shadow/fixtures/85-parry-reflection.json`:
```json
{
  "name": "85-parry-reflection",
  "description": "PRD §8.5 row 7 — any strike into a successful Parry: 0 dealt, ~7.5 taken",
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "guard", "outcome": "complete", "tStart": 100, "tEnd": 500, "keystrokes": 5, "errors": 0, "ikiStats": [90, 10], "moveId": "parry", "chars": 5 },
    { "seq": 1, "player": 1, "round": 1, "cardIndex": 1, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1600, "keystrokes": 7, "errors": 0, "ikiStats": [120, 15], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "hp": [1000, 925], "focus": [10, 0] }
}
```

`src/lib/shadow/fixtures/shuriken-neutral.json`:
```json
{
  "name": "shuriken-neutral",
  "description": "Shuriken at par, chain 0, neutral opponent -> a plain damage/Focus check for the one strike move not otherwise exercised in this fixture set (Shuriken vs. a guarding target is covered by a combat.test.js unit test in Task 4)",
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1400, "keystrokes": 6, "errors": 0, "ikiStats": [180, 15], "moveId": "shuriken", "chars": 6 }
  ],
  "expected": { "hp": [1000, 912], "focus": [5, 0], "chain": [1, 0] }
}
```

`src/lib/shadow/fixtures/guard-completes-unconditional-focus.json`:
```json
{
  "name": "guard-completes-unconditional-focus",
  "description": "§11.2 — Guard grants +3 Focus unconditionally and follows the general chain rule, verified here through the full reduceRound pipeline rather than a direct stepEvent call (Task 5's unit test covers the latter)",
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "guard", "outcome": "complete", "tStart": 0, "tEnd": 300, "keystrokes": 4, "errors": 0, "ikiStats": [80, 5], "moveId": "guard", "chars": 4 }
  ],
  "expected": { "focus": [3, 0], "chain": [1, 0], "hp": [1000, 1000] }
}
```

`src/lib/shadow/fixtures/mend-heals-and-costs-focus.json`:
```json
{
  "name": "mend-heals-and-costs-focus",
  "description": "§10.1/§11.2 — Mend costs 25 Focus and restores 12 HP, verified here through the full reduceRound pipeline (Task 5's unit test covers the max-HP clamp separately)",
  "options": { "initialState": { "hp": [600, 1000], "focus": [40, 0] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "guard", "outcome": "complete", "tStart": 0, "tEnd": 1100, "keystrokes": 6, "errors": 0, "ikiStats": [180, 10], "moveId": "mend", "chars": 6 }
  ],
  "expected": { "hp": [720, 1000], "focus": [15, 0] }
}
```

`src/lib/shadow/fixtures/ko-single.json`:
```json
{
  "name": "ko-single",
  "description": "One fighter reaches HP <= 0 -> the other wins the round",
  "options": { "initialState": { "hp": [1000, 100] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 3800, "keystrokes": 12, "errors": 0, "ikiStats": [280, 15], "moveId": "crush", "chars": 12 }
  ],
  "expected": { "outcome": { "type": "ko", "winner": 0 } }
}
```

`src/lib/shadow/fixtures/ko-double.json`:
```json
{
  "name": "ko-double",
  "description": "§12.3 — both fighters reach HP <= 0 within the same 120ms window -> double knockout, a round draw",
  "options": { "initialState": { "hp": [80, 80] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1600, "keystrokes": 7, "errors": 0, "ikiStats": [120, 15], "moveId": "slash", "chars": 7 },
    { "seq": 1, "player": 1, "round": 1, "cardIndex": 1, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1660, "keystrokes": 7, "errors": 0, "ikiStats": [120, 15], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "outcome": { "type": "double-ko", "winner": null } }
}
```

`src/lib/shadow/fixtures/time-cap-differs.json`:
```json
{
  "name": "time-cap-differs",
  "description": "§12.3 — 90s cap reached, HP differs -> higher HP wins the round",
  "options": { "timeUp": true, "initialState": { "hp": [700, 400] } },
  "events": [],
  "expected": { "outcome": { "type": "time", "winner": 0 } }
}
```

`src/lib/shadow/fixtures/time-cap-tied.json`:
```json
{
  "name": "time-cap-tied",
  "description": "§12.3 — 90s cap reached, HP identical -> round draw",
  "options": { "timeUp": true, "initialState": { "hp": [550, 550] } },
  "events": [],
  "expected": { "outcome": { "type": "time-draw", "winner": null } }
}
```

`src/lib/shadow/fixtures/chain-holds-on-one-error.json`:
```json
{
  "name": "chain-holds-on-one-error",
  "description": "§11.3 — one error is forgiven: chain holds but does not grow",
  "options": { "initialState": { "chain": [4, 0] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1600, "keystrokes": 7, "errors": 1, "ikiStats": [130, 20], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "chain": [4, 0], "focus": [2, 0] }
}
```

`src/lib/shadow/fixtures/chain-breaks-on-two-errors.json`:
```json
{
  "name": "chain-breaks-on-two-errors",
  "description": "§11.3 — two or more errors breaks the chain",
  "options": { "initialState": { "chain": [7, 0] } },
  "events": [
    { "seq": 0, "player": 0, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "complete", "tStart": 0, "tEnd": 1600, "keystrokes": 7, "errors": 2, "ikiStats": [130, 20], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "chain": [0, 0] }
}
```

`src/lib/shadow/fixtures/staggered-punish.json`:
```json
{
  "name": "staggered-punish",
  "description": "§8.4 — a strike into a target staggered by a recent card expiry takes contest x1.35. Player 1's own Slash expires at t=1600, opening a Staggered window [1600, 2300) on player 1. The Staggered window (700ms) is narrower than a Slash's at-par duration (1600ms), so — same issue as the Exposed case above — the punishing Slash has to start well before the window (t=600) to have room to land inside it (t=2000) without being unrealistically fast: actualMs=1400 gives speed = 1600/1400 ~= 1.143 (not a Critical).",
  "events": [
    { "seq": 0, "player": 1, "round": 1, "cardIndex": 0, "lane": "strike", "outcome": "expire", "tStart": 0, "tEnd": 1600, "keystrokes": 3, "errors": 0, "ikiStats": [200, 30], "moveId": "slash", "chars": 7 },
    { "seq": 1, "player": 0, "round": 1, "cardIndex": 1, "lane": "strike", "outcome": "complete", "tStart": 600, "tEnd": 2000, "keystrokes": 7, "errors": 0, "ikiStats": [140, 10], "moveId": "slash", "chars": 7 }
  ],
  "expected": { "hp": [1000, 807] }
}
```

**A note on how these fixtures were derived, and what to do if one doesn't pass.** Every fixture above was hand-derived from the §8 formula, and the timing windows (guard/exposed/staggered/committed) were traced by hand against §10.5's constants — that tracing is easy to get subtly wrong (a window that looks right but doesn't actually overlap where you think, an "at-par" duration that doesn't fit inside a narrower reaction window). Task 2's `damage.js` tests and Tasks 4-6's `combat.js` tests already independently verify the formula and the mechanics in isolation, so if a fixture here disagrees with the reducer, the fixture's arithmetic or timing is the much likelier suspect, not the reducer. If one fails: recompute `parMs`/`speedFactor`/the window bounds by hand using the same sub-formulas shown in Task 2 and Task 4's tests, fix the JSON's event timings or `expected` block, and re-run — don't adjust `combat.js`/`damage.js` to make a fixture pass unless you can also point to which already-passing unit test it would then have to break.

- [ ] **Step 2: Write the test runner and verify every fixture**

```js
// src/lib/shadow/combat.fixtures.test.js
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { reduceRound } from './combat.js';

function loadFixtures() {
  const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

function assertPartialMatch(actual, expected, path = '') {
  for (const [key, value] of Object.entries(expected)) {
    const label = path ? `${path}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      assertPartialMatch(actual[key], value, label);
    } else {
      expect(actual[key], label).toEqual(value);
    }
  }
}

describe('combat fixtures', () => {
  for (const fixture of loadFixtures()) {
    it(`${fixture.name} — ${fixture.description}`, () => {
      const result = reduceRound(fixture.events, fixture.options ?? {});
      assertPartialMatch(result, fixture.expected);
    });
  }
});
```

Run: `npm test -- combat.fixtures`

Expected: PASS for all fixtures. If any of the seven `85-*` fixtures fails, treat that as a real bug in `combat.js`/`damage.js` and fix the source, not the fixture — those expected values are copied verbatim from §8.5's worked-example table, which is the acceptance bar (§37.1: "Every §8.5 worked example reproduces exactly"). If a non-`85-*` fixture fails, re-derive it per the note above before touching either the fixture or the source.

- [ ] **Step 3: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS — every test file in `src/lib/shadow/`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/shadow/fixtures/ src/lib/shadow/combat.fixtures.test.js
git commit -m "test(shadow): hand-authored fixture suite covering every move, contest state, and round-outcome type"
```

---

### Task 8: match.js — round-outcome fold into match state

**Files:**
- Create: `src/lib/shadow/match.js`
- Test: `src/lib/shadow/match.test.js`

**Interfaces:**
- Consumes: nothing from sibling modules — takes plain `roundOutcome` objects (`{ winner: 0 | 1 | null, hpRemaining: [number, number] }`, matching the `hp`/`outcome.winner` shape `combat.js`'s `reduceRound` already produces) so it stays independently testable.
- Produces: `initialMatchState()` → `{ wins: [0,0], draws: 0, roundsPlayed: 0, hpRemainingSum: [0,0], phase: 'in-progress', outcome: null }`; `applyRoundOutcome(matchState, roundOutcome)` → next `matchState`. `phase` is `'in-progress' | 'sudden-death' | 'complete'`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/match.test.js
import { describe, it, expect } from 'vitest';
import { initialMatchState, applyRoundOutcome } from './match.js';

const outcome = (winner, hpRemaining = [500, 500]) => ({ winner, hpRemaining });

describe('initialMatchState', () => {
  it('starts at 0-0, no draws, in progress', () => {
    expect(initialMatchState()).toEqual({
      wins: [0, 0], draws: 0, roundsPlayed: 0,
      hpRemainingSum: [0, 0], phase: 'in-progress', outcome: null,
    });
  });
});

describe('applyRoundOutcome — §12.2-12.3, best of 3', () => {
  it('2-0: match completes after round 2, no sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    expect(state.phase).toBe('in-progress');
    state = applyRoundOutcome(state, outcome(0));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match', winner: 0 });
  });

  it('2-1: a normal round-3 decider, no sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(1));
    expect(state.phase).toBe('in-progress');
    state = applyRoundOutcome(state, outcome(0));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match', winner: 0 });
  });

  it('§12.4: 1-1-1 (one win each plus a draw) enters sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(null)); // round draw
    state = applyRoundOutcome(state, outcome(1));
    expect(state.wins).toEqual([1, 1]);
    expect(state.draws).toBe(1);
    expect(state.phase).toBe('sudden-death');
  });

  it('a draw at 0-0 does not trigger sudden death', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(null));
    expect(state.phase).toBe('in-progress');
  });

  it('a sudden-death round with a winner completes the match', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(null));
    state = applyRoundOutcome(state, outcome(1));
    expect(state.phase).toBe('sudden-death');
    state = applyRoundOutcome(state, outcome(1));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match', winner: 1 });
  });

  it('a sudden-death round that draws is a match draw', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(null));
    state = applyRoundOutcome(state, outcome(1));
    state = applyRoundOutcome(state, outcome(null));
    expect(state.phase).toBe('complete');
    expect(state.outcome).toEqual({ type: 'match-draw', winner: null });
  });

  it('§12.3: 5 total rounds hard-stops the match and breaks ties on aggregate HP', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(null, [10, 10]));
    state = applyRoundOutcome(state, outcome(null, [20, 5]));
    state = applyRoundOutcome(state, outcome(null, [5, 20]));
    state = applyRoundOutcome(state, outcome(null, [30, 10]));
    expect(state.phase).toBe('in-progress');
    state = applyRoundOutcome(state, outcome(null, [10, 5]));
    expect(state.phase).toBe('complete');
    // sums: p0 = 10+20+5+30+10 = 75, p1 = 10+5+20+10+5 = 50
    expect(state.outcome).toEqual({ type: 'match', winner: 0 });
  });

  it('the 5-round hard stop draws the match if aggregate HP also ties', () => {
    let state = initialMatchState();
    for (let i = 0; i < 5; i += 1) {
      state = applyRoundOutcome(state, outcome(null, [10, 10]));
    }
    expect(state.outcome).toEqual({ type: 'match-draw', winner: null });
  });

  it('throws if called again after the match has completed', () => {
    let state = initialMatchState();
    state = applyRoundOutcome(state, outcome(0));
    state = applyRoundOutcome(state, outcome(0));
    expect(() => applyRoundOutcome(state, outcome(0))).toThrow(/completed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- match`
Expected: FAIL — `Cannot find module './match.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/match.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- match`
Expected: PASS (all cases)

- [ ] **Step 5: Run the whole suite one last time**

Run: `npm test`
Expected: PASS — every test file across `src/lib/shadow/`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shadow/match.js src/lib/shadow/match.test.js
git commit -m "feat(shadow): fold round outcomes into match state (best-of-3, sudden death, 5-round hard stop)"
```

---

## After this plan

`src/lib/shadow/` now has a complete, tested, dependency-free combat reducer with no consumer yet — that's expected, per the design doc's scope boundary. Plan 2 (word/move content system) is next: it builds the seeded xorshift32 queue and is the first thing that will actually call `reduceRound` with real `moveId`/`chars` derived from a `cardIndex`, rather than fixture-supplied values.
