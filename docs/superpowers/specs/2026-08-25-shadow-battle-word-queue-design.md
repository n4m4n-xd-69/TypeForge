# Shadow Battle — Word/Move Content System (Design)

**Status:** Approved for planning. Plan 2 of the 8-plan Shadow Battle build
sequence (see `typeforge-shadow-battle-build` project memory). Plan 1
(combat reducer core) is merged to `typeforge`.

**Source of truth:** `docs/08-PRD-shadow-battle.md` §9 (Word system), §10.1-10.4
(Move system / card pair composition). This doc records how Plan 2 turns
that spec into code, and the decisions the PRD leaves open.

## Goal

Build the seeded, deterministic queue that turns `(seed, round, index)` into
the card pair a player sees, plus the per-player state-dependent overrides
(Overdrive, Mend) layered on top. This is what Plan 1's `combat.js` docblock
calls the "Event resolution seam" — the thing that resolves a wire
`CombatEvent`'s `cardIndex` into the `moveId`/`chars` the reducer consumes.

## Decisions this design makes

### 1. Two layers, split exactly where state-dependence starts

**Base queue** — `card(seed, round, index)`, no `player` parameter, no live
state. Per §9.4/SB-WRD-7, both players see the *same* base sequence; only
their pacing through it differs. Produces a candidate pair: strike
move+word, guard move+word (candidate weighted across Guard/Parry/**Mend**).
SB-MOV-1 (first-char re-roll), SB-MOV-4 (no consecutive Crush), and SB-MOV-5
(index 0 hardcoded Jab|Guard) all resolve here — none need live state.

**Per-player resolution** — `resolveForPlayer(basePair, roundState, player)`.
The only state-dependent step: if the base pair's guard candidate is Mend
but this player isn't eligible (HP<70 & Focus≥25), swap it for a re-drawn
Guard/Parry pick; if this player's Focus is 100, override the strike slot
with Overdrive. Both players call this against the *same* base pair and can
get *different* actual pairs. PRD §10.2's "stays until played or the round
ends" stickiness for Overdrive is a consumer responsibility, not something
`resolveForPlayer` provides — it is a pure function of the current
`roundState`, so the caller must cache the resolved pair per index once
Overdrive fires rather than re-resolving on every access.

**Why the split matters for correctness, not just cleanliness:** if a
state-dependent reroll consumed the next value from the *shared* base
stream, one player needing a reroll and the other not would desync what
index N+1 even means for each of them — breaking SB-WRD-7's "same sequence"
guarantee. So state-dependent draws never touch the shared stream — see §3.

### 2. `xorshift32` — the exact reference implementation

Canonical Marsaglia 32-bit variant, five lines, unambiguous:

```js
export function xorshift32(state) {
  let x = state | 0;
  x ^= x << 13; x |= 0;
  x ^= x >>> 17;
  x ^= x << 5; x |= 0;
  return x >>> 0; // unsigned 32-bit
}
```

`seed` is a Postgres `bigint`; JS bitwise ops truncate to 32 bits, so the
reduction is explicit, not implicit:

```js
export function toU32(seedOrBigInt) {
  return Number(BigInt(seedOrBigInt) & 0xFFFFFFFFn) >>> 0;
}
```

A **draw** advances the state and yields a float in `[0, 1)`:

```js
function draw(state) {
  const next = xorshift32(state);
  return { u: next / 4294967296, next };
}
```

Everything downstream — weighted move selection, word-index selection,
bank-choice selection — consumes one `draw()` per decision and threads
`next` forward. This sequence has to be pinned exactly (like Plan 1 pinned
`tEnd`-then-`player`-then-`seq` ordering) or two implementations "using the
same algorithm" diverge. The plan writes out the literal call order per
card index — not left to be inferred from prose.

### 3. Salted independent draws for state-dependent overrides

State-dependent draws (Mend-ineligible reroll, Overdrive's word) start a
**separate** stream, seeded independently of the shared base sequence:

```
overrideSeed = toU32(seed) ^ round ^ index ^ (player + 1) ^ SALT
```

`SALT` differs per override kind (`MEND_REROLL_SALT`, `OVERDRIVE_SALT`) so
the two never collide even for the same player/index. This is deliberately
wasteful of entropy (a fresh xorshift32 seed per override, not a shared
running stream) in exchange for the property that matters: a state-dependent
override for player 0 can never perturb what player 1 (or a later index)
draws.

### 4. Move-type frequency vs. word-bank weighting are different dials

Per-move strike/guard frequencies (§10.2/10.3's "~30%/~40%/~18%/~12%" etc.)
are **fixed**, independent of difficulty band:

- Strike candidate: Jab .30, Slash .40, Crush .18, Shuriken .12 (cumulative
  thresholds `[.30, .70, .88, 1.00]`).
- Guard candidate: Guard .45, Parry .25, Mend .30 (cumulative
  `[.45, .70, 1.00]`).
- Guard/Parry-only reroll (Mend ineligible): renormalized `45/70` Guard,
  `25/70` Parry — exact fractions, not rounded percentages, to avoid drift.
- Strike reroll excluding Crush (SB-MOV-4 fired): renormalize Jab/Slash/
  Shuriken's `.30/.40/.12` over their own sum (`.82`).

§9.5's band weighting (Ember/Steel/Damascus COMMON:HARDER:PUNCTUATED
ratios) only matters for the two moves whose bank choice is ambiguous per
§9.3 — **Slash** ("COMMON + HARDER") and **Crush** ("HARDER or phrase
table"). Moves with one fixed bank (Jab/Guard/Parry/Mend→COMMON,
Shuriken→PUNCTUATED) aren't affected by band at all — there's no choice to
weight. For Slash, the band's COMMON:HARDER ratio is renormalized ignoring
PUNCTUATED (Slash never draws punctuated words). For Crush's HARDER-vs-
phrase-table choice, the PRD's band table has no dedicated column — this
design fixes it at a flat 50/50, an explicit judgment call since nothing in
§9.5 speaks to it either way.

Round escalation (R1 base band, R2 +1, R3 +2, capped Damascus, sudden death
always Damascus — §9.5) is applied by the *caller* picking which band's
weighting to pass in per round; the queue itself is band-agnostic per call.

### 5. `content.js` changes

- Add named exports `COMMON`, `HARDER`, `PUNCTUATED` alongside the existing
  `WORD_BANKS` — a one-line addition, `WORD_BANKS`'s own definition is
  unaffected.
- Fix the em dash (`—`, U+2014) entry in `PUNCTUATED` — non-ASCII, violates
  SB-WRD-2. Replace with an ASCII-safe punctuated entry in the same style as
  the list's existing ones (e.g. a hyphenated word or another symbol/digit
  combination already represented elsewhere in the list) — the exact
  replacement word is a plan-level detail, not a design decision.
- No other content.js changes. `DRILLS` stays untouched (V1, not MVP).

### 6. The `[NEW]` phrase table (`phraseTable.js`)

60 phrases, 2-4 words each, assembled from `COMMON`+`HARDER` — generated
once at module load from a **fixed internal seed** (a literal constant,
never the round's own seed), memoized. Deterministic every session, no
separate hand-authored data file to maintain or let drift from the word
banks it's built from.

Two consumers with different constraints (§9.3):
- **Crush** (10-16 chars): any generated phrase in range, single long word
  or two words.
- **Overdrive** (14-24 chars, multi-word, mixed case, **at least one
  punctuation mark**): a length-filtered subset of the same table,
  post-processed at generation time — capitalize the first word (mixed
  case) and, for entries with no punctuation-bearing word already, splice
  in one `PUNCTUATED` entry as one of the phrase's words.

The table is generated once (all 60 entries, mixed lengths) and each
consumer filters by its own length/constraint range at query time — one
table, two views, not two separate generation passes.

### 7. SB-MOV-1's curated fallback list

After 8 failed re-rolls (guard word still shares a first character with the
strike word), fall back to a **curated, hand-picked list**: one short
(2-4 char) word per letter of the alphabet, checked in as a fixed 26-entry
array. Guarantees termination without an unbounded loop. Every entry is a
short (2-4 char), safe, ordinary ASCII lowercase word — some happen to
also appear in `COMMON` (e.g. `a`→"an", `t`→"to"), others are equally
ordinary, safe words that don't (e.g. `l`→"let", `r`→"run"). This was
never achievable as "stays inside `COMMON`": `COMMON` has zero words
starting with j, k, q, r, v, x, or z (seven letters), so a fallback
confined to `COMMON` couldn't cover the alphabet at all.

## Architecture

### File layout — `src/lib/shadow/`

| File | Responsibility |
|---|---|
| `prng.js` | `xorshift32`, `toU32`, `draw` — the three primitives everything else consumes. Split out from `wordQueue.js` specifically so `phraseTable.js` can use the same PRNG without an import cycle (`wordQueue.js` needs `phraseTable.js` for Crush's phrase-table branch; `phraseTable.js` needs the PRNG). |
| `wordQueue.js` | The base `card(seed, round, index, band)` entry point, and the strike/guard weighted-selection + SB-MOV-1/4/5 logic. |
| `cardResolution.js` | `resolveForPlayer(seed, round, index, basePair, roundState, player)` — Overdrive override, Mend-eligibility reroll, both via salted independent draws. |
| `phraseTable.js` | The 60-phrase table, generated once at module load, memoized; `phraseFor(u, minChars, maxChars, { requirePunctuation })` query function. |

**Modified:** `src/lib/content.js` — the two changes in §5 above.

### Determinism guardrails

Same discipline as Plan 1: a static test asserting no `Math.random`/
`Date.now` in any of the three new files (added to Plan 1's existing
`combat.determinism.test.js` `MODULES` list, or a sibling test — task
decides). All three files stay Deno-safe (no Node/browser APIs) per the
§36-Q6 resolution already locked in for the Edge Function replay path.

### Testing strategy

- `wordQueue.test.js` — SB-WRD-1 holds across a large generated sample (the
  PRD's own acceptance bar is 100,000 pairs, §37.2; this plan can size a
  smaller but still-large in-suite sample and note the full 100k run as a
  follow-up script, similar to how Plan 1 scoped its fixture count against
  hand-verification cost rather than an arbitrary target). SB-MOV-4 (no
  consecutive Crush) and SB-MOV-5 (index 0 fixed) checked directly.
  Determinism: same `(seed, round, index)` always produces the same pair,
  across repeated calls and independent of call order for *different*
  indices (no shared mutable state between calls).
- `cardResolution.test.js` — Overdrive fires only at Focus=100 and only
  overrides the strike slot; Mend reroll fires only when ineligible and
  only touches the guard slot; two players resolving the same base pair
  with different states get independently-correct results with no
  cross-contamination (verified by calling both orders and confirming
  player 0's result never depends on whether player 1's resolution ran
  first).
- `phraseTable.test.js` — table is generated once and stable across
  repeated imports (memoization actually memoizes); every entry satisfies
  its own length bounds; the Overdrive-filtered subset satisfies mixed-case
  and punctuation constraints.

## Explicitly out of scope for Plan 2

- Actually wiring this into live gameplay (when a new card pair gets
  requested, how the UI shows it) — Plan 3 (Trial mode) is the first
  consumer.
- The full §37.2 100,000-pair SB-WRD-1 acceptance run as a checked-in
  script/CI step — this plan proves the property holds at a smaller
  in-suite sample; wiring a full acceptance run is a follow-up, likely
  alongside whichever plan sets up CI more broadly.
- Anything from §9.6 (code-like challenges) — explicitly `[FUTURE]` in the
  PRD.
- `DRILLS`-based V1 weakness-targeted queues.
