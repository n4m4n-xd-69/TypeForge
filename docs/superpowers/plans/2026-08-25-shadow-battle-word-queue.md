# Shadow Battle Word/Move Content System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seeded, deterministic word/move queue for Shadow Battle — `card(seed, round, index, band)` (PRD §9.4) plus the per-player state-dependent overrides (Overdrive, Mend — §10.4). This is Plan 2 of the 8-plan build sequence; Plan 1 (combat reducer core) is merged and this plan is what resolves a wire `CombatEvent`'s `cardIndex` into the `moveId`/`chars` Plan 1's `combat.js` consumes.

**Architecture:** Four new modules in `src/lib/shadow/` — `prng.js` (xorshift32 + draw primitives, split out to avoid a `wordQueue.js`↔`phraseTable.js` import cycle), `phraseTable.js` (the `[NEW]` 60-phrase table for Crush/Overdrive), `wordQueue.js` (the state-independent base queue, shared identically by both players), `cardResolution.js` (the per-player Overdrive/Mend overrides, via independently-salted draws that never touch the shared base stream). Plus a small `content.js` change: export `COMMON`/`HARDER`/`PUNCTUATED` individually, and fix one non-ASCII entry.

**Tech Stack:** Vitest, plain JS, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-shadow-battle-word-queue-design.md` — read it first, it argues every design decision this plan implements. Cross-referenced against `docs/08-PRD-shadow-battle.md` §9, §10.1-10.4.

## Global Constraints

- No `Math.random`, no `Date.now` anywhere in `src/lib/shadow/prng.js`, `phraseTable.js`, `wordQueue.js`, `cardResolution.js` — all "randomness" is `xorshift32` over an explicit seed. Same Deno-safety requirement as Plan 1 (no Node-only/browser-only APIs) — this module set runs in the same Edge Function replay path eventually.
- `card(seed, round, index, band)` takes no `player` parameter and reads no live game state — per SB-WRD-7, both players see the identical base sequence. Only `resolveForPlayer` is player/state-dependent, and its overrides use their own independently-salted PRNG draws (never the shared base stream) specifically so one player's override can never change what a different index or the other player sees.
- Every PRD number (move-type frequencies, band ratios, word-length ranges, the 8-reroll cap) is copied verbatim from §9-§10 — no invented or rounded-off values.
- `content.js`'s existing `WORD_BANKS` export, `randomWords`, `QUOTES`, `PASSAGES`, `DIFFICULTIES`, `DRILLS` and all other exports are untouched — this plan only *adds* three named exports and fixes one data entry.
- **Out of scope:** wiring this into live gameplay (Plan 3); the full §37.2 100,000-pair SB-WRD-1 acceptance run as a CI script (this plan proves the property at a smaller in-suite sample); §9.6 code-like challenges (`[FUTURE]` in the PRD); `DRILLS`-based V1 queues.

---

## File Structure

**New:**
- `src/lib/shadow/prng.js` — `xorshift32(state)`, `toU32(seedOrBigInt)`, `draw(state)`
- `src/lib/shadow/prng.test.js`
- `src/lib/shadow/phraseTable.js` — `phraseFor(u, minChars, maxChars, { requirePunctuation } = {})`
- `src/lib/shadow/phraseTable.test.js`
- `src/lib/shadow/wordQueue.js` — `STRIKE_WEIGHTS`, `GUARD_WEIGHTS`, `WORD_LENGTH_RANGES`, `BANDS`, `SB_WRD_1_FALLBACK`, `pickWeighted`, `wordsInRange`, `pickWord`, `resolveStrikeMove`, `drawWordFor`, `card`
- `src/lib/shadow/wordQueue.test.js`
- `src/lib/shadow/cardResolution.js` — `resolveForPlayer(seed, round, index, basePair, roundState, player)`
- `src/lib/shadow/cardResolution.test.js`

**Modified:**
- `src/lib/content.js` — add `export const COMMON = ...` / `export const HARDER = ...` / `export const PUNCTUATED = ...` (promoting the existing module-private consts to named exports, no change to their values except the em-dash fix below); replace the em dash (`—`, U+2014) entry in `PUNCTUATED` with an ASCII-safe entry in the same style as its neighbors.
- `src/lib/shadow/combat.determinism.test.js` — add `'prng.js'`, `'phraseTable.js'`, `'wordQueue.js'`, `'cardResolution.js'` to the existing `MODULES` array (Plan 1 built this test to be extended exactly this way).

---

### Task 1: `content.js` exports + `prng.js` primitives

**Files:**
- Modify: `src/lib/content.js`
- Create: `src/lib/shadow/prng.js`
- Create: `src/lib/shadow/prng.test.js`

**Interfaces:**
- Produces: `content.js` now exports `COMMON`, `HARDER`, `PUNCTUATED` (arrays of strings) in addition to everything it already exported. `prng.js` exports `xorshift32(state: number) -> number` (32-bit unsigned), `toU32(seedOrBigInt: number | bigint) -> number` (32-bit unsigned), `draw(state: number) -> { u: number, next: number }` (`u` in `[0, 1)`).
- Consumes: nothing (both are leaf changes).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/shadow/prng.test.js
import { describe, it, expect } from 'vitest';
import { xorshift32, toU32, draw } from './prng.js';

describe('xorshift32', () => {
  it('matches a hand-verified reference value', () => {
    // Hand-traced: x=1 -> x^=x<<13 (1^8192=8193) -> x^=x>>>17 (8193>>>17=0,
    // no change) -> x^=x<<5 (8193^262176=270369).
    expect(xorshift32(1)).toBe(270369);
  });

  it('is deterministic: same input always gives the same output', () => {
    expect(xorshift32(42)).toBe(xorshift32(42));
  });

  it('returns an unsigned 32-bit integer', () => {
    const result = xorshift32(0xFFFFFFFF);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(4294967296);
  });

  it('0 is a fixed point (all XOR/shift operations on 0 stay 0) — callers must never seed with a value that reduces to 0', () => {
    expect(xorshift32(0)).toBe(0);
  });
});

describe('toU32', () => {
  it('passes through a small non-negative number unchanged', () => {
    expect(toU32(5)).toBe(5);
  });

  it('accepts a bigint', () => {
    expect(toU32(5n)).toBe(5);
  });

  it('wraps a value larger than 2^32', () => {
    expect(toU32(4294967296n + 5n)).toBe(5);
  });
});

describe('draw', () => {
  it('u is next/2^32, and next matches xorshift32', () => {
    const result = draw(1);
    expect(result.next).toBe(xorshift32(1));
    expect(result.u).toBe(xorshift32(1) / 4294967296);
  });

  it('u is always in [0, 1)', () => {
    for (const seed of [0, 1, 42, 0xFFFFFFFF, 12345]) {
      const { u } = draw(seed);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- prng`
Expected: FAIL — `Cannot find module './prng.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/prng.js
/**
 * The seeded PRNG primitives §9.4 requires — xorshift32, the canonical
 * Marsaglia 32-bit variant, specified exactly (a named algorithm with a
 * written reference implementation, not "use a seeded PRNG"). Every
 * consumer in src/lib/shadow/ builds on `draw`, which turns a 32-bit state
 * into a [0,1) float plus the next state — the same shape whether you're
 * picking a move, a word, or a bank.
 */

export function xorshift32(state) {
  let x = state | 0;
  x ^= x << 13; x |= 0;
  x ^= x >>> 17;
  x ^= x << 5; x |= 0;
  return x >>> 0;
}

// seed is a Postgres bigint at the database boundary; JS bitwise ops
// truncate to 32 bits, so the reduction is explicit here rather than
// left to whatever `| 0` happens to do to an out-of-range bigint.
export function toU32(seedOrBigInt) {
  return Number(BigInt(seedOrBigInt) & 0xFFFFFFFFn) >>> 0;
}

export function draw(state) {
  const next = xorshift32(state);
  return { u: next / 4294967296, next };
}
```

**Then**, modify `src/lib/content.js`: change line 14's declarations so `COMMON`, `HARDER`, `PUNCTUATED` are exported. Find:

```js
const COMMON = `...`.split(' ');
```
```js
const HARDER = `...`.split(' ');
```
```js
const PUNCTUATED = `...`.split(' ');
```

Change each `const` to `export const` (three one-word edits: `const COMMON` → `export const COMMON`, same for `HARDER` and `PUNCTUATED`). Do not change the string literals themselves except the fix below.

In `PUNCTUATED`'s string literal, find the em dash entry — it reads ` — dash,` in the template string (the standalone `—` token between `semi;` and `dash,`). Remove the `—` token entirely (leaving `semi; dash,` — `dash,` already exists as its own entry immediately after it, so deleting the em dash just removes a duplicate-content, non-ASCII token without needing a replacement word). Confirm after editing that `PUNCTUATED` has no non-ASCII characters: every character's code point must be ≤ 126 (printable ASCII).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- prng`
Expected: PASS (all cases)

Also run the full suite once to confirm the `content.js` edit didn't break any existing test that reads `WORD_BANKS`/`PUNCTUATED`-derived content:

Run: `npm test`
Expected: PASS (all files, including everything from Plan 1)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content.js src/lib/shadow/prng.js src/lib/shadow/prng.test.js
git commit -m "feat(shadow): add prng.js primitives; export COMMON/HARDER/PUNCTUATED from content.js and fix a non-ASCII entry"
```

---

### Task 2: `phraseTable.js` — the `[NEW]` 60-phrase table

**Files:**
- Create: `src/lib/shadow/phraseTable.js`
- Create: `src/lib/shadow/phraseTable.test.js`

**Interfaces:**
- Consumes: `xorshift32`, `draw` from `./prng.js`; `COMMON`, `HARDER`, `PUNCTUATED` from `../content.js`.
- Produces: `phraseFor(u, minChars, maxChars, { requirePunctuation = false } = {})` — `u` is a `[0,1)` float (the caller's own PRNG draw, this module does not draw on its own behalf beyond building the table once); returns a phrase string satisfying the length/punctuation constraints, or throws if none exists in the generated table (a `[NEW]` table-construction bug, not a caller error).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/phraseTable.test.js
import { describe, it, expect } from 'vitest';
import { phraseFor } from './phraseTable.js';

describe('phraseTable', () => {
  it('phraseFor returns a phrase within the requested length range', () => {
    for (let i = 0; i < 20; i += 1) {
      const u = i / 20;
      const phrase = phraseFor(u, 10, 16);
      expect(phrase.length).toBeGreaterThanOrEqual(10);
      expect(phrase.length).toBeLessThanOrEqual(16);
    }
  });

  it('phraseFor(u, 14, 24, { requirePunctuation: true }) satisfies §9.3\'s Overdrive shape: 14-24 chars, multi-word, mixed case, at least one punctuation mark', () => {
    for (let i = 0; i < 20; i += 1) {
      const u = i / 20;
      const phrase = phraseFor(u, 14, 24, { requirePunctuation: true });
      expect(phrase.length).toBeGreaterThanOrEqual(14);
      expect(phrase.length).toBeLessThanOrEqual(24);
      expect(phrase.split(' ').length).toBeGreaterThanOrEqual(2); // multi-word
      expect(/[A-Z]/.test(phrase)).toBe(true); // mixed case: has an uppercase letter
      expect(/[a-z]/.test(phrase)).toBe(true); // and a lowercase letter
      expect(/[^A-Za-z0-9 ]/.test(phrase)).toBe(true); // at least one punctuation mark
    }
  });

  it('is deterministic: the same u always returns the same phrase', () => {
    expect(phraseFor(0.37, 10, 16)).toBe(phraseFor(0.37, 10, 16));
  });

  it('every phrase in the table is ASCII printable (SB-WRD-2)', () => {
    for (let i = 0; i < 60; i += 1) {
      const phrase = phraseFor(i / 60, 1, 24);
      for (const ch of phrase) {
        expect(ch.codePointAt(0)).toBeLessThanOrEqual(126);
      }
    }
  });

  it('throws a clear error if no phrase satisfies an impossible range', () => {
    expect(() => phraseFor(0.5, 1, 1)).toThrow(/no phrase/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- phraseTable`
Expected: FAIL — `Cannot find module './phraseTable.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/phraseTable.js
import { xorshift32, draw } from './prng.js';
import { COMMON, HARDER, PUNCTUATED } from '../content.js';

/**
 * The §9.1 [NEW] phrase table: 60 two-to-four-word combinations assembled
 * from COMMON+HARDER, generated once from a FIXED internal seed (never the
 * round's own seed — this table is the same for every match) and memoized.
 * Crush (§9.3, 10-16 chars) and Overdrive (14-24 chars, multi-word, mixed
 * case, >=1 punctuation mark) both query this same table by length range;
 * Overdrive additionally requires punctuation, satisfied at generation
 * time by splicing in a PUNCTUATED entry for phrases that don't already
 * have one.
 */

const TABLE_SEED = 0xC0FFEE; // fixed, arbitrary, never a live round seed
const TABLE_SIZE = 60;
const SOURCE_WORDS = [...COMMON, ...HARDER];

function buildTable() {
  const phrases = [];
  let state = xorshift32(TABLE_SEED);
  for (let i = 0; i < TABLE_SIZE; i += 1) {
    const wordCountDraw = draw(state); state = wordCountDraw.next;
    const wordCount = 2 + Math.floor(wordCountDraw.u * 3); // 2, 3, or 4

    const words = [];
    for (let w = 0; w < wordCount; w += 1) {
      const wordDraw = draw(state); state = wordDraw.next;
      words.push(SOURCE_WORDS[Math.floor(wordDraw.u * SOURCE_WORDS.length)]);
    }

    // Mixed case: capitalize the first word.
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);

    // Ensure at least one punctuation-bearing token, for phrases that
    // will need to satisfy Overdrive's requirePunctuation query.
    const hasPunctuation = words.some((w) => /[^A-Za-z0-9]/.test(w));
    if (!hasPunctuation) {
      const punctDraw = draw(state); state = punctDraw.next;
      const punctIndexDraw = draw(state); state = punctIndexDraw.next;
      const punctWord = PUNCTUATED[Math.floor(punctIndexDraw.u * PUNCTUATED.length)];
      const insertAt = Math.floor(punctDraw.u * words.length);
      words.splice(insertAt, 0, punctWord);
    }

    phrases.push(words.join(' '));
  }
  return phrases;
}

let cachedTable = null;
function table() {
  if (!cachedTable) cachedTable = buildTable();
  return cachedTable;
}

export function phraseFor(u, minChars, maxChars, { requirePunctuation = false } = {}) {
  const candidates = table().filter((p) => {
    if (p.length < minChars || p.length > maxChars) return false;
    if (requirePunctuation && !/[^A-Za-z0-9 ]/.test(p)) return false;
    return true;
  });
  if (candidates.length === 0) {
    throw new Error(`No phrase in the table satisfies [${minChars}, ${maxChars}]${requirePunctuation ? ' with punctuation' : ''}`);
  }
  return candidates[Math.floor(u * candidates.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- phraseTable`
Expected: PASS. If the punctuation or ASCII assertions fail, the issue is almost certainly a specific `PUNCTUATED` entry (e.g. one with a code point > 126, or one whose only "punctuation" is itself non-ASCII) — inspect which phrase failed and trace it back to the source word, don't loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/phraseTable.js src/lib/shadow/phraseTable.test.js
git commit -m "feat(shadow): add the §9.1 60-phrase table for Crush/Overdrive"
```

---

### Task 3: `wordQueue.js` — move selection (SB-MOV-4, SB-MOV-5)

**Files:**
- Create: `src/lib/shadow/wordQueue.js`
- Create: `src/lib/shadow/wordQueue.test.js`

**Interfaces:**
- Consumes: `xorshift32`, `toU32`, `draw` from `./prng.js`.
- Produces (this task): `STRIKE_WEIGHTS`, `GUARD_WEIGHTS` (data), `pickWeighted(u, weights)`, `resolveStrikeMove(seed, round, index, band)` — returns `{ move, state }` where `state` is the PRNG state after this decision, ready for the next draw. Word selection and the full `card()` entry point are later tasks — this task's tests call `resolveStrikeMove` directly.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/wordQueue.test.js
import { describe, it, expect } from 'vitest';
import { xorshift32, toU32 } from './prng.js';
import { STRIKE_WEIGHTS, GUARD_WEIGHTS, pickWeighted, resolveStrikeMove } from './wordQueue.js';

describe('STRIKE_WEIGHTS / GUARD_WEIGHTS — §10.2/10.3, fixed regardless of band', () => {
  it('strike weights are the PRD\'s ~30/40/18/12 and sum to 1', () => {
    expect(STRIKE_WEIGHTS).toEqual({ jab: 0.30, slash: 0.40, crush: 0.18, shuriken: 0.12 });
    const total = Object.values(STRIKE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('guard weights are the PRD\'s ~45/25/30 and sum to 1', () => {
    expect(GUARD_WEIGHTS).toEqual({ guard: 0.45, parry: 0.25, mend: 0.30 });
    const total = Object.values(GUARD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});

describe('pickWeighted', () => {
  it('picks by cumulative threshold, in object key order', () => {
    const weights = { a: 0.5, b: 0.3, c: 0.2 };
    expect(pickWeighted(0.0, weights)).toBe('a');
    expect(pickWeighted(0.49, weights)).toBe('a');
    expect(pickWeighted(0.5, weights)).toBe('b');
    expect(pickWeighted(0.79, weights)).toBe('b');
    expect(pickWeighted(0.8, weights)).toBe('c');
    expect(pickWeighted(0.999, weights)).toBe('c');
  });

  it('renormalizes weights that don\'t sum to 1', () => {
    const weights = { a: 45, b: 25 }; // sums to 70, not 1
    expect(pickWeighted(0.0, weights)).toBe('a');
    expect(pickWeighted(45 / 70 + 0.001, weights)).toBe('b');
  });
});

describe('resolveStrikeMove — SB-MOV-5', () => {
  it('index 0 is always jab, for any seed/round', () => {
    expect(resolveStrikeMove(1, 1, 0, 'ember').move).toBe('jab');
    expect(resolveStrikeMove(999, 3, 0, 'damascus').move).toBe('jab');
  });
});

describe('resolveStrikeMove — determinism', () => {
  it('the same (seed, round, index, band) always resolves to the same move', () => {
    const a = resolveStrikeMove(12345, 2, 7, 'steel').move;
    const b = resolveStrikeMove(12345, 2, 7, 'steel').move;
    expect(a).toBe(b);
  });
});

describe('resolveStrikeMove — SB-MOV-4: Crush never appears twice consecutively', () => {
  it('scans a long run of indices for a seed/round and finds no crush-crush adjacency', () => {
    let prevMove = null;
    for (let index = 0; index < 200; index += 1) {
      const { move } = resolveStrikeMove(777, 1, index, 'damascus'); // Damascus favors harder content, a reasonable stress case
      if (prevMove === 'crush') {
        expect(move).not.toBe('crush');
      }
      prevMove = move;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wordQueue`
Expected: FAIL — `Cannot find module './wordQueue.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/wordQueue.js
import { xorshift32, toU32, draw } from './prng.js';

/**
 * The §9.4 base seeded queue. `card(seed, round, index, band)` (assembled
 * in a later task) takes no `player` and reads no live state — per
 * SB-WRD-7 both players see the identical base sequence; only pacing
 * differs. State-dependent overrides (Overdrive, Mend) live in
 * cardResolution.js, on their own independently-salted draws that never
 * touch this module's shared stream.
 */

// §10.2 — fixed strike-lane frequencies, independent of difficulty band.
export const STRIKE_WEIGHTS = { jab: 0.30, slash: 0.40, crush: 0.18, shuriken: 0.12 };
// §10.3 — fixed guard-lane candidate frequencies (Mend is a candidate
// here; cardResolution.js gates it on live HP/Focus per player).
export const GUARD_WEIGHTS = { guard: 0.45, parry: 0.25, mend: 0.30 };

export function pickWeighted(u, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w / total;
    if (u < acc) return key;
  }
  return entries[entries.length - 1][0];
}

// SB-MOV-5 (index 0 is always Jab|Guard) and SB-MOV-4 (Crush never twice
// consecutively) both resolve here. SB-MOV-4 needs the previous index's
// strike move, resolved by recursing on index-1 — bounded by the round's
// own card count (tens, not thousands), so this is cheap in practice even
// without memoization across separate top-level calls.
export function resolveStrikeMove(seed, round, index, band) {
  const state = xorshift32(toU32(seed) ^ round ^ index);
  if (index === 0) return { move: 'jab', state };

  const prevMove = resolveStrikeMove(seed, round, index - 1, band).move;
  const { u, next } = draw(state);
  const weights = prevMove === 'crush'
    ? { jab: STRIKE_WEIGHTS.jab, slash: STRIKE_WEIGHTS.slash, shuriken: STRIKE_WEIGHTS.shuriken }
    : STRIKE_WEIGHTS;
  return { move: pickWeighted(u, weights), state: next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- wordQueue`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/wordQueue.js src/lib/shadow/wordQueue.test.js
git commit -m "feat(shadow): strike-move selection with SB-MOV-4 (no consecutive Crush) and SB-MOV-5 (index 0 fixed)"
```

---

### Task 4: `wordQueue.js` — word selection (band weighting, bank filtering)

**Files:**
- Modify: `src/lib/shadow/wordQueue.js`
- Modify: `src/lib/shadow/wordQueue.test.js`

**Interfaces:**
- Consumes (new): `COMMON`, `HARDER`, `PUNCTUATED` from `../content.js`; `phraseFor` from `./phraseTable.js`.
- Produces (this task): `WORD_LENGTH_RANGES`, `BANDS` (data); `wordsInRange(bank, min, max)`, `pickWord(u, list)`, `drawWordFor(move, state, band)` — returns `{ word, state }`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/shadow/wordQueue.test.js`:

```js
import { WORD_LENGTH_RANGES, BANDS, wordsInRange, pickWord, drawWordFor } from './wordQueue.js';

describe('WORD_LENGTH_RANGES — §9.3', () => {
  it('matches the PRD\'s per-move length bands', () => {
    expect(WORD_LENGTH_RANGES).toEqual({
      jab: [3, 5], slash: [6, 9], crush: [10, 16], shuriken: [4, 8],
      guard: [2, 4], parry: [3, 5], mend: [6, 8],
    });
  });
});

describe('BANDS — §9.5', () => {
  it('matches the PRD\'s Ember/Steel/Damascus COMMON:HARDER ratios', () => {
    expect(BANDS.ember).toEqual({ common: 75, harder: 20 });
    expect(BANDS.steel).toEqual({ common: 55, harder: 33 });
    expect(BANDS.damascus).toEqual({ common: 35, harder: 45 });
  });
});

describe('wordsInRange', () => {
  it('filters a bank to words within [min, max] length, inclusive', () => {
    const bank = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    expect(wordsInRange(bank, 2, 4)).toEqual(['bb', 'ccc', 'dddd']);
  });
});

describe('pickWord', () => {
  it('picks by fractional index into the list', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(pickWord(0.0, list)).toBe('a');
    expect(pickWord(0.24, list)).toBe('a');
    expect(pickWord(0.25, list)).toBe('b');
    expect(pickWord(0.99, list)).toBe('d');
  });
});

describe('drawWordFor', () => {
  it('jab/guard/parry/mend draw from COMMON, within their length range', () => {
    for (const move of ['jab', 'guard', 'parry', 'mend']) {
      const { word } = drawWordFor(move, 12345, 'steel');
      const [min, max] = WORD_LENGTH_RANGES[move];
      expect(word.length).toBeGreaterThanOrEqual(min);
      expect(word.length).toBeLessThanOrEqual(max);
    }
  });

  it('shuriken draws from PUNCTUATED, within its length range', () => {
    const { word } = drawWordFor('shuriken', 999, 'ember');
    const [min, max] = WORD_LENGTH_RANGES.shuriken;
    expect(word.length).toBeGreaterThanOrEqual(min);
    expect(word.length).toBeLessThanOrEqual(max);
  });

  it('slash draws from COMMON or HARDER (band-weighted), within its length range', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const { word } = drawWordFor('slash', seed, 'damascus');
      const [min, max] = WORD_LENGTH_RANGES.slash;
      expect(word.length).toBeGreaterThanOrEqual(min);
      expect(word.length).toBeLessThanOrEqual(max);
    }
  });

  it('crush draws from HARDER or the phrase table, within its length range', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const { word } = drawWordFor('crush', seed, 'ember');
      const [min, max] = WORD_LENGTH_RANGES.crush;
      expect(word.length).toBeGreaterThanOrEqual(min);
      expect(word.length).toBeLessThanOrEqual(max);
    }
  });

  it('returns a state usable for the next draw', () => {
    const { state } = drawWordFor('jab', 1, 'ember');
    expect(Number.isInteger(state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wordQueue`
Expected: FAIL — `WORD_LENGTH_RANGES`/`BANDS`/`wordsInRange`/`pickWord`/`drawWordFor` not exported yet.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/shadow/wordQueue.js` (after the existing imports, add two more):

```js
import { COMMON, HARDER, PUNCTUATED } from '../content.js';
import { phraseFor } from './phraseTable.js';
```

Append:

```js
// §9.3 — per-move word-length ranges.
export const WORD_LENGTH_RANGES = {
  jab: [3, 5], slash: [6, 9], crush: [10, 16], shuriken: [4, 8],
  guard: [2, 4], parry: [3, 5], mend: [6, 8],
};

// §9.5 — band ratios. Only `common`/`harder` are kept: the queue only
// consults this for Slash's COMMON-vs-HARDER choice (the one place a
// move's bank is genuinely ambiguous per §9.3 and covered by a stated
// PRD ratio) — Crush's HARDER-vs-phrase-table choice has no PRD-stated
// ratio and is fixed at 50/50 by design-doc ruling, not read from here.
export const BANDS = {
  ember: { common: 75, harder: 20 },
  steel: { common: 55, harder: 33 },
  damascus: { common: 35, harder: 45 },
};

export function wordsInRange(bank, min, max) {
  return bank.filter((w) => w.length >= min && w.length <= max);
}

export function pickWord(u, list) {
  return list[Math.floor(u * list.length)];
}

// Draws exactly one word (plus, for crush/slash, one preceding bank-choice
// draw) for the given move, returning the next PRNG state so the caller
// can keep consuming the same stream.
export function drawWordFor(move, state, band) {
  const [min, max] = WORD_LENGTH_RANGES[move] ?? WORD_LENGTH_RANGES.crush;

  if (move === 'crush') {
    const bankPick = draw(state);
    const wordPick = draw(bankPick.next);
    if (bankPick.u < 0.5) {
      const list = wordsInRange(HARDER, min, max);
      return { word: pickWord(wordPick.u, list), state: wordPick.next };
    }
    return { word: phraseFor(wordPick.u, min, max), state: wordPick.next };
  }

  if (move === 'slash') {
    const bankPick = draw(state);
    const ratio = BANDS[band].common / (BANDS[band].common + BANDS[band].harder);
    const bank = bankPick.u < ratio ? COMMON : HARDER;
    const list = wordsInRange(bank, min, max);
    const wordPick = draw(bankPick.next);
    return { word: pickWord(wordPick.u, list), state: wordPick.next };
  }

  if (move === 'shuriken') {
    const list = wordsInRange(PUNCTUATED, min, max);
    const wordPick = draw(state);
    return { word: pickWord(wordPick.u, list), state: wordPick.next };
  }

  // jab, guard, parry, mend — single-bank COMMON.
  const list = wordsInRange(COMMON, min, max);
  const wordPick = draw(state);
  return { word: pickWord(wordPick.u, list), state: wordPick.next };
}
```

Note `drawWordFor`'s first parameter to the test calls above is a raw seed number (e.g. `drawWordFor('jab', 12345, 'steel')`), not a pre-derived `xorshift32` state — that's fine, `draw()` accepts any 32-bit integer as a starting state, and the tests only care about the resulting word's shape, not about matching a specific downstream sequence.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- wordQueue`
Expected: PASS. If a length assertion fails, check the specific bank/range combination first — `WORD_BANKS`' underlying `COMMON`/`HARDER`/`PUNCTUATED` content is fixed (Task 1 only touched one entry), so an empty-candidate-list crash would mean a `WORD_LENGTH_RANGES` value doesn't actually have any matching words in the relevant bank; re-derive the range from §9.3 rather than loosening the bank.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/wordQueue.js src/lib/shadow/wordQueue.test.js
git commit -m "feat(shadow): word selection per move, with §9.5 band-weighted bank choice for Slash"
```

---

### Task 5: `wordQueue.js` — assembling `card()`, SB-WRD-1 re-roll + curated fallback

**Files:**
- Modify: `src/lib/shadow/wordQueue.js`
- Modify: `src/lib/shadow/wordQueue.test.js`

**Interfaces:**
- Produces: `SB_WRD_1_FALLBACK` (data); `card(seed, round, index, band)` — returns `{ strikeMove, strikeWord, guardMove, guardWord }`. This is the module's public entry point; `resolveStrikeMove`/`drawWordFor`/`pickWeighted`/etc. from Tasks 3-4 remain exported too, for `cardResolution.js` (Task 6) to reuse.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/shadow/wordQueue.test.js`:

```js
import { SB_WRD_1_FALLBACK, card } from './wordQueue.js';

describe('SB_WRD_1_FALLBACK', () => {
  it('has one entry per letter a-z, each 2-4 ASCII lowercase letters', () => {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const word = SB_WRD_1_FALLBACK[letter];
      expect(word).toBeDefined();
      expect(word.length).toBeGreaterThanOrEqual(2);
      expect(word.length).toBeLessThanOrEqual(4);
      expect(word[0]).toBe(letter);
    }
  });
});

describe('card — SB-MOV-5: index 0 is always Jab | Guard', () => {
  it('across several seeds/rounds', () => {
    for (const seed of [1, 42, 999]) {
      const pair = card(seed, 1, 0, 'ember');
      expect(pair.strikeMove).toBe('jab');
      expect(pair.guardMove).toBe('guard');
    }
  });
});

describe('card — SB-WRD-1: strike and guard cards never share a first character', () => {
  it('holds across a large generated sample', () => {
    let violations = 0;
    for (let round = 1; round <= 3; round += 1) {
      for (let index = 0; index < 500; index += 1) {
        const pair = card(7, round, index, 'steel');
        if (pair.strikeWord[0].toLowerCase() === pair.guardWord[0].toLowerCase()) {
          violations += 1;
        }
      }
    }
    expect(violations).toBe(0);
  });
});

describe('card — determinism', () => {
  it('the same (seed, round, index, band) always returns the same pair', () => {
    const a = card(555, 2, 10, 'damascus');
    const b = card(555, 2, 10, 'damascus');
    expect(a).toEqual(b);
  });

  it('is independent of call order across different indices', () => {
    const forward = [0, 1, 2, 3].map((i) => card(88, 1, i, 'ember'));
    const backward = [3, 2, 1, 0].map((i) => card(88, 1, i, 'ember')).reverse();
    expect(forward).toEqual(backward);
  });
});

describe('card — SB-WRD-7: no player parameter, callable identically for "both players"', () => {
  it('card() has arity 4 (seed, round, index, band) — no player slot', () => {
    expect(card.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wordQueue`
Expected: FAIL — `SB_WRD_1_FALLBACK`/`card` not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/shadow/wordQueue.js`:

```js
// SB-MOV-1's curated, hand-picked fallback — one short (2-4 char) word per
// starting letter, used only after 8 failed re-rolls. Guarantees SB-WRD-1
// termination without an unbounded loop.
export const SB_WRD_1_FALLBACK = {
  a: 'an', b: 'by', c: 'can', d: 'day', e: 'each', f: 'for', g: 'go',
  h: 'he', i: 'in', j: 'jam', k: 'key', l: 'let', m: 'may', n: 'new',
  o: 'one', p: 'put', q: 'quiz', r: 'run', s: 'see', t: 'to', u: 'use',
  v: 'van', w: 'was', x: 'xray', y: 'you', z: 'zap',
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

// A fallback word guaranteed to differ from strikeFirstChar: walk to the
// next letter in the alphabet (wrapping z -> a) and use its fallback.
// SB_WRD_1_FALLBACK's own words each start with their own key letter, so
// this can never collide with strikeFirstChar.
function fallbackGuardWord(strikeFirstChar) {
  const idx = ALPHABET.indexOf(strikeFirstChar.toLowerCase());
  const nextLetter = ALPHABET[(idx + 1) % ALPHABET.length];
  return SB_WRD_1_FALLBACK[nextLetter];
}

export function card(seed, round, index, band) {
  const { move: strikeMove, state: afterStrikeMove } = resolveStrikeMove(seed, round, index, band);
  const { word: strikeWord, state: afterStrikeWord } = drawWordFor(strikeMove, afterStrikeMove, band);

  let guardMove;
  let stateAfterGuardMove;
  if (index === 0) {
    guardMove = 'guard'; // SB-MOV-5
    stateAfterGuardMove = afterStrikeWord;
  } else {
    const guardPick = draw(afterStrikeWord);
    guardMove = pickWeighted(guardPick.u, GUARD_WEIGHTS);
    stateAfterGuardMove = guardPick.next;
  }

  let { word: guardWord, state } = drawWordFor(guardMove, stateAfterGuardMove, band);

  // SB-MOV-1 / SB-WRD-1: re-roll the guard word up to 8 times if it shares
  // the strike word's first character (case-insensitive).
  let attempts = 0;
  while (
    guardWord[0].toLowerCase() === strikeWord[0].toLowerCase() &&
    attempts < 8
  ) {
    const rerolled = drawWordFor(guardMove, state, band);
    guardWord = rerolled.word;
    state = rerolled.state;
    attempts += 1;
  }
  if (guardWord[0].toLowerCase() === strikeWord[0].toLowerCase()) {
    guardWord = fallbackGuardWord(strikeWord[0]);
  }

  return { strikeMove, strikeWord, guardMove, guardWord };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- wordQueue`
Expected: PASS (all cases, including the 1500-pair SB-WRD-1 sample)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/wordQueue.js src/lib/shadow/wordQueue.test.js
git commit -m "feat(shadow): assemble card() — SB-WRD-1 re-roll with a curated fallback, completing the base queue"
```

---

### Task 6: `cardResolution.js` — per-player Overdrive/Mend overrides

**Files:**
- Create: `src/lib/shadow/cardResolution.js`
- Create: `src/lib/shadow/cardResolution.test.js`

**Interfaces:**
- Consumes: `xorshift32`, `toU32`, `draw` from `./prng.js`; `phraseFor` from `./phraseTable.js`; `wordsInRange`, `pickWord`, `WORD_LENGTH_RANGES` from `./wordQueue.js`.
- Produces: `resolveForPlayer(seed, round, index, basePair, roundState, player)` — returns a new `{ strikeMove, strikeWord, guardMove, guardWord }`, overriding `basePair`'s fields only where this player's live state requires it. `roundState` is the same shape Plan 1's `combat.js` produces (`{ hp: [t0,t1], focus: [f0,f1], ... }`, HP in integer tenths).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/shadow/cardResolution.test.js
import { describe, it, expect } from 'vitest';
import { card } from './wordQueue.js';
import { resolveForPlayer } from './cardResolution.js';

function stateWith(overrides) {
  return { hp: [1000, 1000], focus: [0, 0], ...overrides };
}

describe('resolveForPlayer — Overdrive (§10.2)', () => {
  it('overrides the strike slot when this player\'s Focus is exactly 100', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [100, 0] });
    const resolved = resolveForPlayer(1, 1, 5, base, state, 0);
    expect(resolved.strikeMove).toBe('overdrive');
    expect(resolved.strikeWord.length).toBeGreaterThanOrEqual(14);
    expect(resolved.strikeWord.length).toBeLessThanOrEqual(24);
  });

  it('does not override at Focus 99', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [99, 0] });
    const resolved = resolveForPlayer(1, 1, 5, base, state, 0);
    expect(resolved.strikeMove).toBe(base.strikeMove);
  });

  it('never touches the guard slot', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [100, 0] });
    const resolved = resolveForPlayer(1, 1, 5, base, state, 0);
    expect(resolved.guardMove).toBe(base.guardMove);
    expect(resolved.guardWord).toBe(base.guardWord);
  });

  it('only affects the player whose Focus is 100', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [100, 0] });
    const resolvedForPlayer1 = resolveForPlayer(1, 1, 5, base, state, 1);
    expect(resolvedForPlayer1.strikeMove).toBe(base.strikeMove);
  });
});

describe('resolveForPlayer — Mend (§10.3-10.4, SB-MOV-3)', () => {
  it('keeps a Mend candidate when this player is eligible (HP<70 tenths=700 and Focus>=25)', () => {
    // Search for a seed/index whose base guard candidate is Mend, so the
    // test genuinely exercises the "kept" branch rather than vacuously
    // passing because the candidate was never Mend to begin with.
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull(); // sanity: found a Mend candidate to test against
    const state = stateWith({ hp: [600, 1000], focus: [30, 0] }); // HP 60.0, Focus 30 -- eligible
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.guardMove).toBe('mend');
    expect(resolved.guardWord).toBe(base.guardWord);
  });

  it('rerolls to Guard or Parry when this player is not eligible', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull();
    const state = stateWith({ hp: [1000, 1000], focus: [30, 0] }); // HP 100.0 -- not <70, ineligible
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(['guard', 'parry']).toContain(resolved.guardMove);
    const [min, max] = { guard: [2, 4], parry: [3, 5] }[resolved.guardMove];
    expect(resolved.guardWord.length).toBeGreaterThanOrEqual(min);
    expect(resolved.guardWord.length).toBeLessThanOrEqual(max);
  });

  it('never touches the strike slot', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    const state = stateWith({ hp: [1000, 1000], focus: [30, 0] });
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.strikeMove).toBe(base.strikeMove);
    expect(resolved.strikeWord).toBe(base.strikeWord);
  });

  it('leaves a non-Mend candidate (Guard/Parry) completely alone', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove !== 'mend') { base = candidate; break; }
      index += 1;
    }
    const state = stateWith({ hp: [50, 1000], focus: [90, 0] }); // eligible-looking, irrelevant since candidate isn't Mend
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.guardMove).toBe(base.guardMove);
    expect(resolved.guardWord).toBe(base.guardWord);
  });
});

describe('resolveForPlayer — salted draws never desync the shared base sequence', () => {
  it('resolving for player 0 does not change what card() itself returns for the next index', () => {
    const base5 = card(9, 1, 5, 'ember');
    resolveForPlayer(9, 1, 5, base5, stateWith({ focus: [100, 0] }), 0);
    const base6Before = card(9, 1, 6, 'ember');
    resolveForPlayer(9, 1, 5, base5, stateWith({ focus: [100, 0] }), 0); // resolve again
    const base6After = card(9, 1, 6, 'ember');
    expect(base6After).toEqual(base6Before);
  });

  it('two players resolving the same base pair with different states never contaminate each other', () => {
    const base = card(9, 1, 5, 'ember');
    const p0Resolved = resolveForPlayer(9, 1, 5, base, stateWith({ focus: [100, 40] }), 0);
    const p1Resolved = resolveForPlayer(9, 1, 5, base, stateWith({ focus: [100, 40] }), 1);
    // player 1 has the same Focus (40, not 100) regardless of resolving
    // player 0 first -- re-resolve player 1 alone and confirm it matches.
    const p1Alone = resolveForPlayer(9, 1, 5, base, stateWith({ focus: [100, 40] }), 1);
    expect(p1Resolved).toEqual(p1Alone);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cardResolution`
Expected: FAIL — `Cannot find module './cardResolution.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/shadow/cardResolution.js
import { xorshift32, toU32, draw } from './prng.js';
import { phraseFor } from './phraseTable.js';
import { wordsInRange, pickWord, WORD_LENGTH_RANGES } from './wordQueue.js';
import { COMMON } from '../content.js';

/**
 * §10.4's state-dependent card overrides (Overdrive, Mend) — the only
 * player/state-dependent step in the whole word system. Both overrides
 * draw from their own independently-salted PRNG stream (never the shared
 * base-sequence stream wordQueue.js uses), so resolving for one player at
 * one index can never change what a different index, or the other
 * player's own resolution, produces. `roundState` uses the same shape
 * Plan 1's combat.js reducer state does: HP in integer tenths.
 */

const OVERDRIVE_SALT = 0x4F564552; // 'OVER'
const MEND_REROLL_SALT = 0x4D454E44; // 'MEND'

function overrideSeed(seed, round, index, player, salt) {
  return toU32(seed) ^ round ^ index ^ (player + 1) ^ salt;
}

export function resolveForPlayer(seed, round, index, basePair, roundState, player) {
  let { strikeMove, strikeWord, guardMove, guardWord } = basePair;

  const focus = roundState.focus[player];
  const hp = roundState.hp[player]; // integer tenths

  if (focus === 100) {
    const state = xorshift32(overrideSeed(seed, round, index, player, OVERDRIVE_SALT));
    const wordPick = draw(state);
    strikeMove = 'overdrive';
    strikeWord = phraseFor(wordPick.u, 14, 24, { requirePunctuation: true });
  }

  if (guardMove === 'mend' && !(hp < 700 && focus >= 25)) {
    const state = xorshift32(overrideSeed(seed, round, index, player, MEND_REROLL_SALT));
    const movePick = draw(state);
    guardMove = movePick.u < (0.45 / 0.70) ? 'guard' : 'parry';
    const wordPick = draw(movePick.next);
    const [min, max] = WORD_LENGTH_RANGES[guardMove];
    guardWord = pickWord(wordPick.u, wordsInRange(COMMON, min, max));
  }

  return { strikeMove, strikeWord, guardMove, guardWord };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cardResolution`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/lib/shadow/cardResolution.js src/lib/shadow/cardResolution.test.js
git commit -m "feat(shadow): per-player Overdrive/Mend overrides via independently-salted draws"
```

---

### Task 7: Extend the determinism guard

**Files:**
- Modify: `src/lib/shadow/combat.determinism.test.js`

**Interfaces:**
- No new exports. This task only widens Plan 1's existing static guard test's coverage.

- [ ] **Step 1: Write the failing test**

Modify `src/lib/shadow/combat.determinism.test.js`'s `MODULES` array — find:

```js
const MODULES = ['combat.js', 'damage.js', 'roundState.js', 'moveTable.js'];
```

Replace with:

```js
const MODULES = [
  'combat.js', 'damage.js', 'roundState.js', 'moveTable.js',
  'prng.js', 'phraseTable.js', 'wordQueue.js', 'cardResolution.js',
];
```

This alone is the "test" for this task — the existing `it.each`-style loop (from Plan 1) already asserts no `Math.random`/`Date.now` per module in the array; adding four more filenames extends that same assertion to them.

- [ ] **Step 2: Run test to verify it fails first, for the right reason**

Since the four new modules already exist and are already clean (no `Math.random`/`Date.now` — verify this holds; if any of the four somehow does contain one of those strings, even in a comment as happened once in Plan 1, this step will genuinely fail and that's the signal to fix the module's comment wording, not the test), this step may actually pass immediately rather than fail. That's fine — the meaningful verification here is Step 3's confirmation that removing one module from the array and re-adding it would have failed (proving the loop genuinely iterates the array rather than being hardcoded to the original four). Skip a contrived RED step; go straight to running the test.

Run: `npm test -- combat.determinism`
Expected: PASS — 8 cases (4 original + 4 new), all green.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS — every test file across `src/lib/shadow/`, Plan 1's and Plan 2's combined.

- [ ] **Step 4: Commit**

```bash
git add src/lib/shadow/combat.determinism.test.js
git commit -m "test(shadow): extend the determinism guard to prng.js, phraseTable.js, wordQueue.js, cardResolution.js"
```

---

## After this plan

`src/lib/shadow/` now has a complete word/move content system with no consumer yet — same deliberate scope boundary Plan 1 left. Plan 3 (Trial mode) is the first plan that actually calls `card()`/`resolveForPlayer()` from a running game loop, turning their output into the `moveId`/`chars` fields Plan 1's `combat.js` expects on a resolved `CombatEvent`.
