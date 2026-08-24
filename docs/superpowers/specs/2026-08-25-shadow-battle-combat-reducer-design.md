# Shadow Battle — Combat Reducer Core (Design)

**Status:** Approved for planning. This is design doc for **Plan 1** of the
8-plan Shadow Battle build sequence (see
`docs/superpowers/plans/2026-08-24-mode-registry.md`'s successor work,
tracked in project memory `typeforge-shadow-battle-build`). Plan 0 (mode
registry) is merged to `typeforge`; this is the next slice.

**Source of truth:** `docs/08-PRD-shadow-battle.md` §8 (Combat system), §9
(Word system — referenced for boundary only), §10 (Move system), §11
(Health/Focus/Chain), §12 (Round system), §36-Q6, §37.1 (Acceptance
criteria). This design doc does not restate the PRD's numbers; it records
how Plan 1 turns that spec into code, and the decisions the PRD leaves open.

## Goal

Build `src/lib/shadow/` — a pure, dependency-free JS module that turns a
sorted log of `CombatEvent`s into round and match state, exactly as §8.1
specifies: `combatState = reduce(initialState, sortedEventLog)`. No React,
no DOM, no I/O, no `Math.random`, no `Date.now`. This is the highest-leverage
piece of the whole feature — every other plan (word system, trial mode,
backend, multiplayer, battle UI) calls into this module rather than
reimplementing combat math.

## Decisions this design makes (the genuinely open questions)

### 1. §36-Q6 — resolved: Supabase Edge Function, not plpgsql

Server-side authoritative replay will run this exact JS module inside a
Supabase Edge Function (Deno-compatible ESM), **not** a hand-transliterated
plpgsql port. This removes the two-implementation drift risk Q6 warns about
entirely, at zero cost to Plan 1: the module already has to be pure,
deterministic, integer-only — the same constraints a plpgsql port would
need. The one concrete obligation this places on Plan 1: **the module must
stay runnable unmodified in Deno** — no Node-only APIs (`Buffer`, `fs`,
`crypto` module, etc.) and no browser-only APIs (`window`, `document`).
Deploying the Edge Function itself is out of scope for Plan 1 — that's
Plan 4 (backend schema/RPCs). Plan 1 only has to not paint itself into a
corner.

### 2. Scope boundary — single round + a thin match layer

`combat.js` reduces one round's event log to round state (HP/Focus/Chain per
player, event history, round outcome). A sibling `match.js` folds a
*sequence* of round outcomes into match state (§12.3-12.5: which round is
next, sudden-death entry at 1-1-1 or 1-1-after-a-draw, best-of-3-plus-hard-
stop-at-5, match winner/draw). Both are pure and belong in this plan because
neither needs I/O, UI, or network — they're the same kind of function as the
round reducer, just one level up. What's explicitly **not** in `match.js`:
rematch (§12.6, creates a new room — that's room/multiplayer orchestration)
and forfeit-on-disconnect (§12.3's last row — that's a multiplayer-transport
concern, not a pure fold over already-known round outcomes).

### 3. Fixture depth — hand-authored coverage set, not the full 500

§37.1 wants "JS and Postgres reducers produce byte-identical state across a
500-fixture suite" — that's a *parity* check between two implementations.
Plan 1 has only one implementation (the Edge Function deployment is Plan 4),
so a 500-case property-fuzz suite would only be proving the JS reducer
agrees with itself. Instead Plan 1 delivers a hand-authored JSON fixture
set (event log in, expected state out) covering every category below —
the plan sizes this at roughly 15-20 fixtures rather than a larger round
number: each one requires hand-tracing the §10.5 timing windows to make
sure the events actually overlap the way the fixture intends (several
did not, on the first attempt, while writing the plan — see its Task 7
note on how a failing fixture should be re-derived), and that manual
verification cost — not an arbitrary target — is what actually bounds a
*hand-authored* set's size. Coverage breadth matters more than count:
- every move in the table (Jab, Slash, Crush, Shuriken, Overdrive, Guard,
  Parry, Mend)
- every §8.4 contest state (neutral, guarding, guarding-vs-Shuriken,
  parrying, exposed, committed, staggered)
- every §8.5 worked example, reproduced exactly, by literal value
- every round outcome type (KO, time-cap-HP-differs, time-cap-tied-draw,
  double-KO, sudden-death entry at 1-1-1 and at 1-1-after-draw)
- chain build/hold/break rules (0 errors, 1 error, 2+ errors, expiry,
  taking a Critical, playing Overdrive)
- Focus generation and spend, including the Overdrive-unlock-at-100 gate

These fixtures are stored in a format Plan 4 can replay against the Edge
Function deployment to build toward the full 500-case parity bar later —
Plan 1 is not re-litigating that number, just not manufacturing false
confidence from a single implementation.

## Architecture

### File layout — `src/lib/shadow/`

| File | Responsibility |
|---|---|
| `combat.js` | Public API: `initialRoundState()`, `stepEvent(state, event)`, `reduceRound(events)`. Composes the modules below. This is the file SB-CMB-1 names explicitly. |
| `moveTable.js` | §10.1 as data — one entry per move: `id, lane, base, focusClean, focusError, committed, onPlay` (special-case hooks for Overdrive's chain-reset-and-spend-all and Mend's HP restore). A lookup table, not a switch statement, matching the mode-registry pattern from Plan 0. |
| `damage.js` | Pure math from §8.3-8.4: `parMs(chars)`, `speedFactor(parMs, actualMs)`, `precisionFactor(errors)`, `chainMul(chain)`, `contestFactor(targetState, move)`, `critMul(precision, speed)`, and the composed `damage(move, ctx)`. Independently unit-tested against every §8.5 worked example. |
| `roundState.js` | §11 state transitions: Focus gain/spend table, chain increment/reset rules, Ragged threshold (`HP <= 25`), and deriving each player's contest state (neutral/guarding/parrying/exposed/committed/staggered) from event history plus the §10.5 timing constants. |
| `match.js` | §12.3-12.5: round-outcome classification, sudden-death entry condition, the best-of-3-plus-hard-stop-at-5 fold into a match winner or draw. |
| `fixtures/*.json` | Event-log-in/state-out test vectors. |
| `combat.fixtures.test.js` | Runs every fixture; also encodes the full §8.5 worked-example table as literal assertions. |
| `combat.determinism.test.js` | Static guardrail: asserts the module source contains no `Math.random`/`Date.now`. |

### State & event shapes

`CombatEvent` is exactly the §8.2 type — `seq, player, round, cardIndex,
lane, outcome, tStart, tEnd, keystrokes, errors, ikiStats`. `ikiStats` is
carried through onto history entries but **consumed by nothing** in Plan 1
— it's reserved for the anti-cheat plan (§21.2). The module's docblock says
this explicitly so a future reader doesn't mistake it for dead code.

**Event resolution seam.** §8.2's `CombatEvent` is the wire/persistence
shape — it carries `cardIndex`, not a move id or word length, because
resolving `cardIndex` to those requires the seeded queue (§9.4), which is
Plan 2. But the damage formula needs `chars` (for `parMs`) and the move's
identity (for `base`/`focus`/`committed`). So `combat.js` accepts a
**resolved** event: the wire `CombatEvent` plus `moveId` (a key into
`moveTable.MOVES`) and `chars` (word length). Plan 2 is responsible for
producing resolved events from wire events before they reach the reducer
— client-side from its own local queue derivation, server-side from the
Edge Function's replay of the same queue. Plan 1's fixtures specify
`moveId`/`chars` directly, standing in for that resolution step this plan
doesn't own. `combat.js` never looks at word content — only at the one
derived fact (word length) the formula needs.

`RoundState`:
```
{
  hp:      [int, int],   // integer tenths of HP (SB-CMB-3)
  focus:   [int, int],   // integer, 0-100
  chain:   [int, int],   // integer, increments without an internal cap —
                         // chainMul's min(0.05*chain, 0.50) saturates once
                         // chain reaches 10, so higher values are inert for
                         // damage purposes but still counted (display concern,
                         // out of scope here)
  history: CombatEvent[],
  contestState: [state0, state1],  // derived, not stored redundantly — see below
  outcome: null | { type, winner: 0 | 1 | null, decidingEvent },
}
```

`stepEvent(state, event, allEvents)` is the atomic pure transition —
`allEvents` is the full round event array being replayed, not just prior
history. `reduceRound(events, options)` sorts by `tEnd` and folds:
`sorted.reduce((s, e) => stepEvent(s, e, sorted), initialRoundState())`,
then runs a one-time `finalizeOutcome` pass (see below).

**Why `stepEvent` needs the full array, not just history:** detecting that
a struck player was `committed` (mid-Crush/Overdrive/Mend, §8.4) requires
seeing that player's committing event even when its own `tEnd` is *later*
than the strike being resolved — e.g. a Jab lands at t=400 while the
target's Crush (tStart=0, tEnd=1500) is still in flight. A left-fold over
prior history alone can't see that Crush yet. A full replay can, because
the whole log is known upfront. This means `stepEvent`'s contract is
defined for **whole-log (authoritative) replay** — the case that actually
decides match outcomes. True instant local feedback from partial
information (the live client's own "opponent looks mid-swing" read before
that event resolves) is a presentation concern for the battle-screen UI
(Plan 6), which can show a provisional/optimistic number and reconcile
once the authoritative event arrives. Plan 1 does not need to solve
that — it defines the authoritative function.

**Round-outcome finalization is a separate pass, not per-event.** §12.3's
double-knockout rule (both players' HP hits 0 within a 120ms window) is
only decidable once you know no second KO follows within the window — a
single `stepEvent` call can't know that in isolation. `stepEvent` tracks
each player's first zero-HP timestamp (`koAt`) but leaves `outcome: null`;
`finalizeOutcome(state, { timeUp })` runs once after the fold and applies
§12.3's table (double-KO if both `koAt` within 120ms; otherwise the
earlier `koAt` loses; otherwise, if the caller says the 90s cap was
reached, higher HP wins or ties draw; otherwise the round is still open).
`timeUp` is a caller-supplied boolean, not a `Date.now()` read inside the
reducer — it comes from the same `starts_at`-relative clock §12.5 already
uses, so determinism (SB-CMB-2) holds.

Contest state (guarding/parrying/committed/etc.) is a function of recent
history and the timing constants (§10.5), not a separately-mutated field —
this avoids a second source of truth that could drift from the event log
during replay. `stepEvent` recomputes it as part of each transition.

### Determinism guardrails

The fixture suite is the real proof (behavioral). Alongside it, one cheap
static test greps the module source for `Math.random` and `Date.now` and
fails if either appears — belt-and-suspenders for SB-CMB-2, cheap to write,
cheap to keep passing.

## Explicitly out of scope for Plan 1

- Actual word/card text and the seeded xorshift32 queue (§9.4) — Plan 2.
  `cardIndex` stays an opaque, verifiable integer here; nothing in the
  reducer looks at word content.
- Bot event generation (Plan 3), UI (Plan 6), network transport (Plan 5).
- Actually deploying the Edge Function (Plan 4) — Plan 1 only keeps the
  module Deno-safe.
- Anti-cheat consumption of `ikiStats` (Plan 7, §21.2).
- XP/Forge Rating/rewards (Plan 7).
- Rematch and room lifecycle (§12.6) — multiplayer/rooms (Plan 5).
- Forfeit-on-disconnect (§12.3 last row) — that's a transport-layer event
  translated into a round outcome elsewhere, not reducer logic.

## Testing strategy

- `damage.test.js` — every §8.4 sub-formula unit-tested in isolation
  (parMs, speedFactor clamped 0.60-1.40, precisionFactor's 4 tiers,
  chainMul capped at chain 10, each contestFactor row, critMul's dual
  condition).
- `combat.fixtures.test.js` — the ~40-60 event-log fixtures plus the §8.5
  worked-example table verified by literal value.
- `roundState.test.js` — chain build/hold/break, Focus gain/spend table,
  Ragged threshold, contest-state derivation from timing.
- `match.test.js` — round-outcome classification, sudden-death entry,
  best-of-3 fold, the 5-round hard stop and its aggregate-HP tiebreak.
- `combat.determinism.test.js` — the static source-grep guardrail.

Maps to the relevant rows of §37.1 ("Functional — Damage arithmetic is
integer-tenths throughout", "Every §8.5 worked example reproduces exactly",
"Security — no client-submitted value influences HP/damage/Focus/Chain/
outcome" — the last one is true by construction here since the reducer's
only inputs are the typed `CombatEvent` fields). The byte-identical-JS/
Postgres row and the perf/balance rows of §37.1 are out of scope until
Plan 4 gives us a second implementation and Plan 3 gives us bot matches to
gather balance data from.

## Open items carried forward (not blocking Plan 1)

- §36-Q3 (are the §8 constants roughly right) stays open — Plan 1 codifies
  the PRD's current numbers exactly; rebalancing is a data-driven exercise
  for after playtesting, not a Plan 1 concern.
- The exact Deno deployment shape for the Edge Function (bundling, cold
  start, how `shadow_rooms.seed`/`word_table_version` reach it) is Plan 4's
  problem. This design only commits to *not blocking* that path.
