# Shadow Battle — Avatar Modes & UI Alignment

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Work task-by-task,
> top to bottom. Every task ends with a check that can fail. Stages are ordered so
> that **Stage A must ship before anything else is worth testing** — see §2.

**Goal:** three things, in dependency order.

1. **Make Trial mode actually run.** It does not today (§2 — verified, not inferred).
2. **Two avatar modes** in Shadow Battle:
   - **Stickman** — three typing lanes, **Fight / Shield / Jump**, whose word sets
     rotate after every resolution.
   - **Shadow Ninja** — a continuous paragraph delivered as a scroll; the ninja
     fights while you type it, a wrong character costs you HP, and your output
     scales against the opponent's WPM and accuracy.
3. **Align the Shadow UI** to the language Arena and Battlefield already speak —
   `Card`, `Button`, `Chip`, `.eyebrow`, `Reveal`, the closed spacing scale, and
   colour tokens instead of hardcoded hexes.

---

## 1. Design authority and divergence

- `docs/08-PRD-shadow-battle.md` is the combat authority. §10.1 defines **8 moves
  across 2 lanes**. This plan adds a **9th move (`evade`) and a third *presented*
  lane**, which is a real divergence — recorded in §4.1 with its reasoning.
- `docs/09-PRD-shadow-battle-ui-redesign.md` exists, is untracked, and is
  unimplemented. This plan supersedes it for the hub and HUD surfaces.
- `docs/superpowers/plans/2026-08-25-arena-gate-nav.md` established the Arena gate
  and the `Arena → Battlefield | Shadow Battle` fork. The visual language pinned
  there (tinted icon tile, top rule, eyebrow, `font-display` title, dot beats,
  comparison table) is the target this plan matches Shadow Battle *to*.

---

## 2. Blocking finding: Trial mode is non-functional

**This is verified by reading both files, not inferred.** `ShadowArena.jsx` was
written against an engine API that `trialEngine.js` does not expose. Four
independent mismatches:

| # | Site | What happens |
|---|---|---|
| 1 | `ShadowArena.jsx:121` reads `matchRef.current.currentRoundState.hp[1]` | `currentRoundState` exists **nowhere** in `src/lib/shadow/` — it is a local variable name inside `trialEngine.js` only. The real field is `roundState`, and it lives on the **round** object, not the match. → **`TypeError: Cannot read properties of undefined (reading 'hp')` on the first keypress of every match.** |
| 2 | `ShadowArena.jsx:123` calls `handlePlayerKey(match, key, lane, chars, now)` — 5 args | `trialEngine.js:96` is `handlePlayerKey(roundState, key, timestampMs)` — 3 args, and wants the **round**. Returns `{nextRound, event, whiff}`; the caller switches on `res.type === 'progress'\|'card_complete'\|'whiff'`, which is never set. → **every branch falls through; typing does nothing.** |
| 3 | `trialEngine.js:347` returns `stepTrialRound(round, elapsedMs)` | `stepTrialRound` is **defined nowhere in the repo** (single grep hit: its own call site). → `tickBot` throws `ReferenceError` if reached. |
| 4 | `ShadowArena.jsx:94` guards on `matchRef.current.phase !== 'round_active'` | The match object has no `phase` field, so the guard is always true and `tickBot` is **never reached** — which is the only reason #3 isn't a visible crash. → **the bot never acts. The opponent stands still for the whole match.** |

Net observable behaviour today: countdown runs, `FIGHT!` appears, HP bars sit at
the `?? 1000` fallback forever, the opponent never moves, typing emits console
`TypeError`s and nothing else, and the 90s round timer expires without resolving
because the timeout check lives in `trialEngineTick`, which nothing calls.

`docs/superpowers/SHADOW_BATTLE_STATUS.md` states "100% COMPLETE & RELEASE READY"
and "281 tests, 100% passing". Both are true *and* irrelevant: every test targets
the pure `src/lib/shadow/*` math, and `src/modules/shadow/ui.test.js` only asserts
`toBeDefined()` on the components. **No test ever calls the engine the way the UI
calls it.** That gap is what let this ship. Task A3 closes it.

**Consequence for this plan:** the avatar work is pointless until the bridge is
real, so Stage A comes first and is not optional.

---

## 3. Architecture

The load-bearing decision: **an avatar mode is an input surface, not a combat
engine.** Both modes resolve through the *same* tested reducer
(`combat.stepEvent`), by emitting the same wire CombatEvent (§8.2 shape:
`{seq, player, round, cardIndex, moveId, chars, lane, outcome, tStart, tEnd, keystrokes, errors, ikiStats}`).

That buys three things: the 298-test math layer keeps its meaning, damage/focus/
chain/parry stay identical across modes, and a new mode cannot silently invent
its own balance.

```
                     ┌───────────────────────────────┐
                     │  arenaSession.js  (NEW)       │  ← the ONE contract
                     │  create / press / tick / view │    ShadowArena consumes
                     └───────────┬───────────────────┘
                     ┌───────────┴───────────┐
              ┌──────▼──────┐         ┌──────▼──────┐
              │ laneDeck.js │         │ ninjaFlow.js│   (both NEW)
              │  stickman   │         │   ninja     │
              │  3 lanes    │         │  prose flow │
              └──────┬──────┘         └──────┬──────┘
                     └───────────┬───────────┘
                        ┌────────▼────────┐
                        │  UNCHANGED core │  moveTable · damage · roundState
                        │  combat.stepEvent│ combat · match · wordQueue
                        │                 │  cardResolution · prng · bot
                        └─────────────────┘
```

`arenaSession.press()` and `.tick()` both return a **discriminated union** so the
component never inspects engine internals again:

```
{ kind: 'progress',    lane, typed, total }
{ kind: 'lane-commit', lane }
{ kind: 'resolve',     lane, moveId, seat, damage, crit, parried, healed }
{ kind: 'whiff',       seat, focusLost }
{ kind: 'penalty',     seat, hpLost, char }          // ninja wrong-character
{ kind: 'round-end',   winner, reason, scores }
{ kind: 'match-end',   outcome, scores, sessionPayload }
{ kind: 'noop' }
```

---

## 4. Stickman mode — Fight / Shield / Jump

### 4.1 The third lane, and why it is a guard-lane move

The user asked for **Fight, Shield, Jump**. The engine has two mechanical lanes.
Rather than add a third mechanical lane — which would mean surgery on
`combat.stepEvent`'s dispatch and would invalidate `combat.test.js`,
`moveTable.test.js` and the fixtures — **Jump is presented as its own lane but
resolves as a guard-lane move**, `evade`. Jump *is* defensive; nothing is lost.

New entry in `moveTable.js`:

```js
evade: {
  id: 'evade', name: 'Evade', lane: LANES.GUARD,
  base: 0, focus: 5, committed: false, guardFactor: null,
  resetsChain: false, healsHp: 0,
}
```

Focus `+5` sits deliberately between `guard` (+3, cheap and safe) and
`parry` (+10, high risk / high reward): an evade is safer than a parry and worth
more than a guard because it costs you the counter-attack window.

### 4.2 A latent bug this exposes, and must fix

`combat.js:152-156`:

```js
function applyGuardLane(state, event, move, allEvents) {
  if (move.id === 'guard') return applyGuard(...);
  if (move.id === 'parry') return applyParry(...);
  return applyMend(...);          // ← everything else
}
```

The final `return` is an unguarded fall-through. Adding `evade` without touching
this would route it to `applyMend`, which applies `move.healsHp`. `evade` has
`healsHp: 0` so the heal would be zero **by luck, not by design** — and any future
guard-lane move would silently become a heal. Task B1 makes the dispatch explicit
and adds an `evade` branch. This is a real correctness fix, not refactoring.

### 4.3 Rotating key sections

"different sections of keys changes after" → after every resolution the three
lanes are redrawn from the seeded queue, so the keys you reach for move. New
`src/lib/shadow/laneDeck.js`:

- `LANE_IDS = ['fight', 'shield', 'jump']`
- `deckFor(seed, round, index, band)` → `{ fight: {moveId, word}, shield: {...}, jump: {...} }`
- `fight` reuses `wordQueue.resolveStrikeMove` + `drawWordFor` (jab/slash/crush/shuriken, Overdrive substituted by `cardResolution.resolveForPlayer`).
- `shield` reuses the guard family (guard/parry/mend, Mend gated exactly as today).
- `jump` is always `evade`, word drawn from `COMMON` in a new `WORD_LENGTH_RANGES.evade = [4, 7]`.
- **Hard invariant:** all three words start with a **distinct** first character,
  case-insensitively — that character is the lane-commit key, so a collision would
  make a lane unreachable. `wordQueue.card()` already does this pairwise for two
  lanes (re-roll up to 8×, then `SB_WRD_1_FALLBACK`); `deckFor` extends it to
  three-way. **This is the single most important assertion in the whole plan** and
  gets a dedicated exhaustive test (Task B3).

### 4.4 Determinism

`deckFor` must be a pure function of `(seed, round, index, band)` and must use
**independently salted** PRNG streams per lane (the pattern `cardResolution.js`
already uses with `OVERDRIVE_SALT` / `MEND_REROLL_SALT`), so adding the jump lane
cannot perturb the fight/shield sequence an existing seed produces.

---

## 5. Shadow Ninja mode — prose flow

### 5.1 The scroll

`src/lib/content.js` exports `PASSAGES` — four multi-sentence prose paragraphs
(151/136/100/138 chars). It has **no consumer anywhere in the repo**;
`docs/07-migration-audit.md:196` records it as unused. It is exactly the prose
source this mode needs, and claiming it costs nothing.

New `src/lib/shadow/ninjaFlow.js`:

- `buildScroll(seed, round)` → `{ text, beats }` where `beats` are the clause
  chunks the text splits into (on sentence and comma boundaries), each carrying
  `{ start, end, chars, moveId }`.
- **Each completed beat emits one CombatEvent** with a `moveId` cycling through
  the strike family weighted by beat length — short beat → `jab`, medium →
  `slash`, long → `crush`, punctuated → `shuriken`. So the ninja's damage math is
  the *existing* damage math; the paragraph is just a different way of choosing
  moves and lengths.
- Overdrive: at `focus === 100` the next beat is promoted to `overdrive` and
  rendered as the scroll igniting.

### 5.2 Wrong character = minus

The user's rule: *"if any character is wrong its minus."* Distinct from stickman's
whiff, which only costs Focus.

- `advanceNinja(state, key, nowMs)`:
  - correct char → cursor advances, `keystrokes++`
  - wrong char → `errors++`, chain breaks, **and an immediate HP penalty on the
    typist** (`NINJA_ERROR_HP_TENTHS = 8`, i.e. 0.8 HP per bad character)
  - the beat's accumulated `errors` still feed `precisionFactor` at resolution, so
    a sloppy beat is punished twice: once immediately, once in reduced output.
    That is intentional — it is what makes accuracy the dominant stat in this mode.
- The penalty is surfaced as `{ kind: 'penalty', seat, hpLost, char }` so the HUD
  can flash the bad character red and the canvas can flinch.

### 5.3 Scaling against the opponent

*"it also depend upon opponent typing speed and accuracy."*
`combat.stepEvent(state, event, allEvents, damageMul)` already takes a damage
multiplier as its 4th argument — no reducer change needed.

```
pressure = clamp( (playerWpm / oppWpm) * (playerAcc / oppAcc), 0.60, 1.60 )
```

- `oppWpm` / `oppAcc` come from the bot profile (`wpmMean`, `cleanRate`) in Trial,
  or from live opponent telemetry in multiplayer.
- `playerWpm` / `playerAcc` are the rolling values over the current round.
- Passed as `damageMul` on the player's outgoing beats **only**. The bot's own
  events are unscaled — otherwise the multiplier would apply twice and compound.
- Clamped both ways so a fast typist cannot one-shot and a slow one is never
  locked out. Exposed in the HUD as a "Pressure ×1.24" readout, because a hidden
  multiplier that decides the match is a bad multiplier.

---

## 6. UI alignment

### 6.1 Verified defects to fix while restyling

| Finding | Evidence | Fix |
|---|---|---|
| `animate-shake` is a **no-op class** | Used at `CardLane.jsx:32,48`; defined in neither `tailwind.config.js` nor `index.css` (grep: zero hits for `shake`). The whiff shake has never animated. | Add a real `shake` keyframe + `animate-shake` to `tailwind.config.js`. |
| 5 hardcoded hexes | `FighterCanvas.jsx:90,323,325,340` `#38bdf8`; `:353` `#22c55e` | Read `--info` and `--good` from computed style, like `--brand`/`--accent` already are at `:124-126`. |
| Stale doc comment | `FighterCanvas.jsx:8-9` claims "Brand Indigo (#6366f1)" / "Accent Rose (#f43f5e)"; the real tokens are forge orange `255 122 47` and steel blue `79 195 247` (`index.css:48,53`) | Correct the comment to name the tokens, not dead hexes. |
| `variant="outline"` does not exist | `ShadowHub.jsx:185,212,239`; `Button.jsx` `VARIANTS` has no `outline` key, so `VARIANTS['outline']` is `undefined` → those three render with **no background, border or colour**. Two are the sign-in gates. | → `secondary`. |
| Dead chip branch | `ShadowHub.jsx:278` tests `bot.id === 'master'`; `bot.js` ids are `recruit, adept, ronin, shade, mirror` | Map tone off `profile.difficulty` instead. |
| Dead variable | `ShadowHub.jsx:123` `activeBotDef` computed, never read | Delete. |
| Off-scale spacing / raw sizes | `HpBar.jsx:66` `h-5`, `:49` `w-2.5 h-2.5`, `:92` `text-[11px]`; `CardLane.jsx:21` `h-20` (=160px placeholder) | Move onto the closed scale and the `text-2xs`/`text-xs` type scale. |

### 6.2 Target language

Straight from `Arena.jsx` / `Battle.jsx`: `Card` surfaces; a tinted `rounded-md`
icon tile; `.eyebrow` mono labels; `font-display` headings; `font-mono` + `tnum`
for every number; `Reveal` for entrance; `Chip` for status; `Segmented` for the
avatar and mode pickers; `Button` variants only; brand = seat 0, accent = seat 1,
per the Side-Color Rule.

The arena itself stays full-bleed `fixed inset-0` — it is a game surface, not a
document — but its **chrome** (top bar, HUD panels, summary) adopts `Card`,
tokens and the type scale so it reads as the same product.

---

## 7. Tasks

### Stage A — make it run (blocking)

#### Task A1 — `arenaSession.js` facade
**Files:** create `src/lib/shadow/arenaSession.js`
- `createSession({ avatar='stickman', botProfile='adept', band='steel', seed=1, playerName, opponentName })`
- `press(session, key, nowMs)` / `tick(session, nowMs)` / `view(session)` returning §3's union.
- Owns countdown → combat → round-over → match-over, seat 0 = human, seat 1 = bot.
- Delegates to `laneDeck` or `ninjaFlow` on `avatar`.
- [x] Step 1: write it.
- [x] Check: `view()` on a fresh session returns `hp:[1000,1000]`, `focus:[0,0]`, `phase:'countdown'`.

#### Task A2 — remove the broken export
**Files:** modify `src/lib/shadow/trialEngine.js`
- Delete `tickBot` (the `stepTrialRound` ReferenceError). Keep `trialEngineTick`.
- [x] Step 1: delete.
- [x] Check: `rg -n "stepTrialRound" src` → zero hits.

#### Task A3 — the test that would have caught this
**Files:** create `src/lib/shadow/arenaSession.test.js`
- Drive a **full match end-to-end through the facade**: build a session, feed the
  actual correct characters for each lane, assert HP moves, the bot acts, a round
  resolves, and a match completes. This is the integration test whose absence let
  a non-functional mode be called release-ready.
- Regression: assert no export of `trialEngine.js` throws `ReferenceError` when
  called with its documented signature.
- [x] Step 1: write it.
- [x] Check: `npx vitest run src/lib/shadow/arenaSession.test.js` green.

#### Task A4 — rewrite `ShadowArena.jsx` against the facade
**Files:** modify `src/modules/shadow/ShadowArena.jsx`
- Replace all direct `trialEngine` calls with `arenaSession`. No component code
  may read `session` internals — only `view()` and the returned union.
- [x] Step 1: rewrite.
- [x] Check: `npm run build` clean; typing a lane word visibly drops opponent HP.

### Stage B — stickman: three lanes

- [x] **Task B1** — `moveTable.js` `evade`; `combat.js` explicit `applyGuardLane` dispatch + `applyEvade`. Check: `moveTable.test.js` + `combat.test.js` still green after their move-count assertions are updated deliberately.
- [x] **Task B2** — `wordQueue.js` `WORD_LENGTH_RANGES.evade = [4,7]`.
- [x] **Task B3** — create `laneDeck.js` + `laneDeck.test.js`. **Exhaustive distinct-first-character test across ≥2000 (seed, round, index) triples** — this invariant is what keeps all three lanes reachable.
- [x] **Task B4** — `CardLane.jsx` → three lanes, restyled, real shake.

### Stage C — shadow ninja

- [x] **Task C1** — create `ninjaFlow.js`: `buildScroll`, `advanceNinja`, `pressureFor`. Claims `PASSAGES`.
- [x] **Task C2** — create `ninjaFlow.test.js`: beat segmentation covers the text exactly (no gaps, no overlaps, concatenation === source), error penalty arithmetic, `pressureFor` clamps at 0.60 and 1.60.
- [x] **Task C3** — create `src/modules/shadow/NinjaScroll.jsx`: the stylish scroll — vertical column, typed chars dimmed, cursor char highlighted, wrong char flashing `bad`, upcoming text fading out. `prefers-reduced-motion` respected.
- [x] **Task C4** — `FighterCanvas.jsx`: `ninja` silhouette (filled hood + trailing scarf), `jump`/`evade` pose, tokens instead of the 5 hexes, corrected header comment.

### Stage D — UI alignment

- [x] **Task D1** — `avatars.js` + `avatars.test.js`: the two avatar definitions as data, mirroring `arena/lanes.js`.
- [x] **Task D2** — rewrite `ShadowHub.jsx` in the site language; `Segmented` avatar picker; fix all three `outline` variants, the dead `'master'` branch and the dead `activeBotDef`.
- [x] **Task D3** — restyle `HpBar.jsx`, `FocusBar.jsx`, `WordBubble.jsx`, `MatchSummary.jsx` onto tokens + the closed scale.
- [x] **Task D4** — `tailwind.config.js`: real `shake` keyframe + `animate-shake`.
- [x] **Task D5** — update `src/modules/arena/lanes.js` Shadow beats to mention both avatars, and its test.

### Stage E — verify

- [x] `npm test` — green, count strictly greater than 298.
- [x] `npm run build` — clean.
- [x] Corruption grep: `rg -n "stepTrialRound|currentRoundState|variant=\"outline\"" src` → zero hits.
- [ ] Manual: both avatars playable start to finish against a bot.

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Three-way first-character collision makes a lane unreachable | **High** without an explicit invariant | Task B3's exhaustive test over ≥2000 triples; `SB_WRD_1_FALLBACK` as the terminal escape |
| Adding `evade` breaks pinned move-count assertions | **Certain** | Update `moveTable.test.js` deliberately, with a comment. Never by loosening |
| `deckFor`'s jump stream perturbs existing fight/shield sequences | Medium | Independent PRNG salts per lane, mirroring `cardResolution.js`; determinism test pins fight/shield output against the pre-change values |
| Ninja double-punishment (instant HP + reduced output) is too harsh | Medium | Both constants (`NINJA_ERROR_HP_TENTHS`, the pressure clamp) live in one place and are tuned by test, not by feel |
| Rewriting `ShadowArena.jsx` loses working VFX wiring | Medium | The canvas imperative API (`triggerAction`/`triggerHit`/`updateState`) is unchanged; only the data source moves |
| Scope: 5 stages, ~16 files | **Certain** | Stages are independently shippable. Stage A alone converts a broken mode into a working one and is worth landing on its own |

---

## 9. Out of scope

- Multiplayer transport for either avatar mode (`useShadowRoom` / `api.js`
  untouched; avatar is a local presentation choice this round).
- `ShadowMark.jsx` (SB-NAV-3) and the nav in-progress dot (SB-NAV-4).
- Rating / anti-cheat changes; `antiCheat.js` and `telemetry.js` untouched.
- Fixing `SHADOW_BATTLE_STATUS.md`'s "release ready" claim — it needs a rewrite
  once Stage A lands, but that is a doc task, not this one.

---

## 10. Outcome

### Verification

| Check | Result |
|---|---|
| `npm test` | **388 passed / 31 files**, up from 298 / 28. Run three times consecutively, identical each time |
| `npm run build` | Clean, no new warnings |
| Chunks | `ShadowArena` 18.87 kB gzip, `ShadowHub` 4.33 kB gzip — both still lazy |
| Dead references | `stepTrialRound` / `tickBot` / the phantom `currentRoundState` field: zero live hits (remaining matches are comments and regression tests naming them) |
| `variant="outline"` | Zero live hits |
| Hardcoded hexes in `src/modules/shadow` | Zero |
| Mojibake sweep | Zero (see the caution below) |

### Two bugs found and fixed that were not in the original brief

1. **SB-WRD-1 was silently voided by the Mend re-roll** (`cardResolution.js`).
   `wordQueue.card()` guarantees the strike and guard words start with
   different characters — that character is how a lane is committed to, so a
   collision makes a lane unreachable. The Mend gate then re-drew `guardWord`
   from a different bank without re-checking. Measured over 2250 cards:
   `card()` produced **0** collisions, the re-roll fired **630** times and
   produced **23** collisions — about **1 card in 100 across all play**, each one
   a card where the player could not choose to defend. Example: base
   `planet`/`morning`(mend) re-rolled to `planet`/`part`, so `p` always
   took Strike. Fixed at the root with a salted re-roll walk plus a deterministic
   terminal escape; re-measured at **0 collisions across 6750 cards** with 1929
   re-rolls. This was a shipped bug in the two-lane mode, independent of the
   avatar work, and it was found by the three-lane reachability sweep.
2. **`applyGuardLane`'s unguarded fall-through** (`combat.js`). `if guard /
   if parry / return applyMend(...)` meant *any* other guard-lane move became a
   heal. `evade` only escaped that by having `healsHp: 0` — by luck, not
   design. Now every id is named and an unrecognised one throws.

### Deliberate test updates

Four pinned assertions moved, each with a comment stating why, never by
loosening: `moveTable.test.js` (8 → 9 moves, plus the count is now an
assertion rather than only a test *name*), `wordQueue.test.js`
(`WORD_LENGTH_RANGES` gains `evade`), `cardResolution.test.js` (new SB-WRD-1
sweep), `arena/lanes.js` copy.

### A flaky test, caught and fixed

The two large sweeps initially exceeded vitest's 5s default timeout under
parallel load — passing alone, failing in the full suite. Cause:
`wordQueue.resolveStrikeMove` recurses on `index - 1` to enforce SB-MOV-4, so
a sweep is O(n²) in the index bound. Re-shaped to spread across rounds instead
(12 × 40 rather than 5 × 150), same card count at roughly a tenth of the work,
plus an explicit 20s timeout. Full-suite runtime dropped from 210s to 75s. A
flaky test on the most important invariant in the module is worse than no test.

### Caution for future work in this repo

**Do not use PowerShell `Get-Content`/`Set-Content` for find-and-replace on
source files.** PS 5.1 reads as ANSI by default, so UTF-8 em dashes and `§`
round-trip into mojibake (`â€”`, `Â§`). It corrupted `FighterCanvas.jsx` and
this plan file once each; both were repaired by a CP1252→UTF-8 byte round-trip
and verified with an `rg 'â€|Â§'` sweep. Prefer the editing tools, or an
explicit `[System.Text.Encoding]`.

### Not done

- `MatchSummary.jsx` still carries off-scale values (`max-w-lg`, `gap-4`,
  `rounded-xl`, `p-6`). It is a modal, so it was the lowest-visibility
  surface; `HpBar`, `FocusBar`, `CardLane`, `ShadowHub` and
  `ShadowArena` were all brought onto the scale.
- `WordBubble.jsx` was **deleted**: the CardLane rewrite orphaned it, and its
  imperative direct-DOM-mutation design is the thing the rewrite moved away
  from. Leaving it would invite someone to wire it back in.
- **Browser QA.** The `chrome-devtools` MCP tools were unavailable and the test
  environment is `node` with no jsdom, so nothing rendered in a browser. Both
  avatars are proven playable *through the facade* by
  `arenaSession.test.js` — typing damages the opponent, the bot acts and
  damages the player, rounds and matches settle — but the pixels have not been
  looked at. That is the one open item in Stage E.