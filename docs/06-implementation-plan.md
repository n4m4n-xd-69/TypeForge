# TypeForge — Implementation Plan

**Version:** 1.0
**Date:** 2026-08-23
**Inputs:** `00-codebase-audit` · `01-PRD` · `02-TRD` · `03-app-flow` · `04-design-brief` · `05-data-schema`
**Baseline:** branch `typeforge` @ `8262146` · build passes in 41.24s

---

# PART A — Cross-document reconciliation

Before planning, all five documents were compared against each other and against the codebase. **Nine issues found.** Each has a binding resolution below; the phases assume these resolutions.

## A.1 Contradictions

### X-1 — Leaderboard route: `/ranks` vs `/leaderboard`
`01-PRD.md:1212` says `/leaderboard`. `03-app-flow.md` says `/ranks` in 10 places.
**Resolution: `/ranks`.** Later document, more thoroughly specified, and shorter. PRD §28.4 is superseded.

### X-2 — AI coach route: `/chat` vs `/coach`
PRD keeps `/chat`; app flow renames to `/coach` with a 301.
**Resolution: keep `/chat`.** The rename buys nothing a user can perceive, costs a redirect, and touches the command palette, the FAB and `chat_messages.surface` values. **Rejected as unnecessary churn** — exactly the kind of change the brief says to avoid.

### X-3 — Typing routes nested under `/train`
PRD §28.4 proposes `/train/practice`. App flow §1.1 explicitly rejects it.
**Resolution: flat routes.** `/practice` and `/code` stay. `Train` is a navigation group. Already reasoned in the app flow; recorded here so it is not re-litigated.

### X-4 — Migration numbering disagreement
TRD: `0010_typeforge_cleanup`, `0011_skill_rating`, `0012_quick_match`, `0014_ai_proxy`.
Schema: `0011_typeforge_profiles`, `0013_quick_match`, `0014_ai_proxy`.
**Resolution: the schema document's sequence wins**, because it orders by *risk* rather than by topic:

| # | File | Type |
|---|---|---|
| `0010` | `typeforge_cleanup` — drop 4 dead objects | Destructive · **ships last in MVP** |
| `0011` | `typeforge_profiles` — rating, moderation, deleted cols; `rating_history`; boards | Additive |
| `0012` | `moderation` — `moderation_reports`, `report_content()`, `profile_delete_self()` | Additive |
| `0013` | `quick_match` — `is_public`, `rated`, `rematch_of`, `ready` + 3 RPCs | Additive · **security review** |
| `0014` | `rating_pass` — Elo in `battle_settle()`, `flagged_results` | Behavioural |
| `0015` | `ai_proxy` — drop the client `ai_usage` insert policy | Restrictive |

### X-5 — "Delete `aurora` / `glow-panel` / `liquid-glass`" understates the blast radius
Design brief §C.4 deletes all three. Verified usage: **8 files** — `AppShell` (rail + header), `ChatFab` (×2), `About` (×8 occurrences), `AIChat`, `Landing`, `Onboarding`, `Profile`.
**Resolution:** valid, but it is a Phase 2 task with a real file list, not a CSS deletion. Scheduled explicitly in §Phase 2.

## A.2 Gaps — requirements that cannot be met as written

### G-1 — **The ΔE chart validator does not exist** 🔴
`palette.js:14` instructs *"Re-run the validator before changing any hex."* The design brief §C.1 and QA checklist both require re-running it. **`scripts/` contains only `build-icons.mjs` and `check-contrast.mjs`.** The tool that produced the recorded output is not in the repository.

**Resolution — pick one, in Phase 2:**
- **(a) Recommended.** Extend `check-contrast.mjs` with a CIE ΔE2000 categorical check, making `palette.js`'s instruction executable for the first time. ~80 lines, no dependency.
- (b) Freeze the ramp entirely and change the instruction to say so.

**(a) is chosen.** A comment that tells the next engineer to run a tool that does not exist is worse than no comment.

### G-2 — Landing bundle budget is tighter than it looks 🔴
PRD NFR-PERF-1 caps the landing route at **150 kB gzip**. Measured today: `react` 54.18 + `motion` 38.27 = **92.45 kB before a single line of TypeForge code** — 62% of budget.

Worse: `Primitives.jsx:1` imports framer-motion, and **22 of 57 components import Primitives**. 27 import framer-motion directly.

**Resolution:**
1. The landing page must not import `Primitives` or framer-motion. It gets its own minimal component set (Phase 3).
2. `ProgressBar`/`ProgressRing` lose their framer-motion dependency — CSS transitions do the same job (Phase 2). This alone unhooks 22 files.
3. Budget re-measured at each phase gate, not once at the end.

### G-3 — Mobile typing is still unresolved 🟡
`U-4` is open in all five documents. The engine captures `keydown` and has no `compositionstart`/`compositionend` handling.
**Resolution:** Phase 0 task `0.8` runs the test. **The MO-5 decision is made on evidence in Phase 0**, not deferred to Phase 8, because it determines whether Phase 3 designs one Stage or two.

### G-4 — `check-contrast.mjs` duplicates the palette 🟡
The validator hardcodes hex values that must stay in sync with `index.css`. Drift makes it validate a palette that is not shipped.
**Resolution:** Phase 2 — parse the tokens out of `index.css` so there is one source of truth.

## A.3 Unnecessary complexity — removed from scope

| # | Proposed | Verdict |
|---|---|---|
| U-1 | `/chat` → `/coach` rename | **Cut.** X-2 |
| U-2 | `/train/*` nesting | **Cut.** X-3 |
| U-3 | Replacing recharts wholesale | **Cut for MVP.** Module split gets the win; a rewrite of 3 chart types does not pay for itself (TRD T-2) |
| U-4 | Skill radar on the dashboard | **Cut unless its normalisation is stated.** `wpm/110`, `codeRuns/25`, `streak/21` are arbitrary constants presented as objective measurement — DP-2 violation |
| U-5 | Seasons table | **Not built.** Design is season-ready; the migration is documented |
| U-6 | Notifications | **Not built.** Rejected in app flow §2.28 |
| U-7 | Content in the database | **Not built.** Breaks offline-first |

## A.4 Assumptions this plan carries

| # | Assumption | If wrong |
|---|---|---|
| A-1 | No production users whose data loss is catastrophic | Phase 2 becomes the highest-risk phase, not a routine one |
| A-2 | Deployed Supabase schema matches `migrations/` (`U-5`) | Every migration needs a reconciliation step first |
| A-3 | "TypeForge" is available for this use | Phase 1 repeats |
| A-4 | Battlefield backend stays untouched | Phase 5 grows by an order of magnitude |
| A-5 | Existing AI providers stay reachable | AI surfaces degrade to fallbacks — already handled |
| A-6 | Deployment stays Vercel + Supabase | TRD §B.3 and §B.32 change |

---

# PART B — Working discipline

Applied to **every** file touched in every phase.

```
1. READ the whole file, including its comments.
      This codebase documents WHY. Several comments record bugs that
      were expensive to find — sync.js:422-435 records an account
      being zeroed from 790 XP to 0.

2. ASK whether the change is actually required.
      Trace it to a requirement ID. No ID, no change.

3. MAKE the smallest clean change.
      Prefer: add a prop > fork a component.
              extract a module > rewrite a file.
              extend a token > add a one-off value.

4. VERIFY the existing behaviour still holds.
      Run the named test. Not "it looks fine".
```

**Hard rules for the whole programme:**

| Rule | Reason |
|---|---|
| **Never edit `0009_battlefield.sql`** | Every anti-cheat property lives in it |
| **Never change a formula in `typing.js` or `gamification.js`** | Retroactively rewrites user history |
| **Never rename a `sessions` column** | Reopens the identity bug `0006`/`0008` exist to fix |
| **Never remove `hydratedRef` from `sync.js`** | It exists because a real account was zeroed |
| **Rename is case-sensitive and word-boundary anchored** | `keystrokes` is a domain term used 9× in `useTypingEngine.js` |
| **Every phase ends green** | Build passes, tests pass, app runs |

---

# PART C — Phases

## PHASE 0 — Audit & instrumentation

**Objective.** Establish measured baselines and make every later phase verifiable. **Nothing else starts until 0.4 is green.**

**Files.** `package.json` · `vite.config.js` · new `eslint.config.js`, `vitest.config.js`, `.github/workflows/ci.yml` · new `src/**/*.test.js`

**Dependencies.** None.

**Tasks.**

| # | Task | Output |
|---|---|---|
| 0.1 | Install Vitest — shares Vite's config and transform pipeline; Jest would need a second toolchain | `vitest.config.js` |
| 0.2 | Install ESLint + Prettier; resolve or remove the 4 orphan `eslint-disable` directives | Lints clean |
| 0.3 | **Tier-1 tests** — `typing.js` (8 pure fns), `gamification.js` (XP/level/streak/missions), `useTypingEngine` behaviour | Golden values recorded |
| 0.4 | **CI: lint → test → build → size budget** | Pipeline green on a PR |
| 0.5 | Bundle analyser; attribute the 383 kB `index` chunk (`U-3`) | Report committed |
| 0.6 | **Typing latency baseline** — CDP synthetic input at 150 WPM across 200/1000/4000-char passages | p50/p95/p99 recorded |
| 0.7 | axe + Lighthouse baseline on every route | Report committed |
| 0.8 | **Mobile typing test** (`G-3`) — iOS Safari + Android Chrome: OSK, autocorrect, IME | **MO-5 decision made** |
| 0.9 | Dead-code sweep — `problem_progress` path, `cx`/`clsx`, unused exports | List produced, nothing deleted yet |
| 0.10 | Dependency audit — confirm the 7 prod deps against measured usage | Report |

**Acceptance.**
- [ ] `npm run lint`, `npm test`, `npm run build` all pass in CI
- [ ] Tier-1 tests cover every XP/level/streak/metric function with fixed golden values
- [ ] Latency baseline recorded with a pass/fail verdict against PE-1
- [ ] Mobile typing decision **written down** with evidence
- [ ] Bundle attribution shows what the 383 kB chunk contains

**Risks.** Tests written against current behaviour may encode a bug as correct — mitigate by deriving golden values from the documented definitions in `typing.js:5-11`, not from running the code.

**Rollback.** Additive only. Nothing to roll back.

---

## PHASE 1 — Rebrand

**Objective.** Zero user-visible "KeyStroke", zero corrupted `keystrokes` identifiers.

**Files.** `index.html` · `package.json` · `public/site.webmanifest` · `assets/banner.svg` · `src/components/brand/Logo.jsx` · 15 files with brand strings · `scripts/build-icons.mjs`

**Dependencies.** Phase 0 (tests must exist to prove nothing broke).

**Tasks.**

| # | Task | Note |
|---|---|---|
| 1.1 | Design and vectorise the TypeForge mark | Must keep the single-source property that drives favicon + PWA icons |
| 1.2 | Replace `Logo.jsx` geometry and constants | `LOGO_GREEN`/`LOGO_INK` → `LOGO_FORGE`/`LOGO_INK` |
| 1.3 | Wire `build-icons.mjs` into `npm run build` | Fixes D-10; icons currently regenerate manually |
| 1.4 | **The rename** — case-sensitive, word-boundary | Procedure below |
| 1.5 | Metadata: `<title>`, description, manifest, `package.json`, `banner.svg` | |
| 1.6 | OG + Twitter Card tags, canonical | Landing gets real values in Phase 8 |
| 1.7 | Copy pass against the §7.3 voice table | No exclamation marks, no emoji in UI copy |
| 1.8 | Route redirects: `/dashboard`→`/progress`, `/achievements`→`/progress/awards` | `/chat` and `/practice` **unchanged** (X-2, X-3) |

**The rename procedure — 1.4:**
```bash
# 1. Inventory. Case-sensitive, word-boundary. 28 occurrences, 15 files.
grep -rn '\bKeyStroke\b' src index.html public package.json assets

# 2. Record the domain-term count BEFORE touching anything.
grep -rc '\bkeystrokes\?\b' src/components/typing/useTypingEngine.js   # expect 9

# 3. Replace only brand-cased occurrences. Never -i. Never unanchored.

# 4. Corruption check — the count MUST be unchanged.
grep -rc '\bkeystrokes\?\b' src/components/typing/useTypingEngine.js

# 5. Zero brand hits remaining.
grep -rn '\bKeyStroke\b' src index.html public package.json assets   # expect none

# 6. Build + full test suite.
```

> **`keystroke.*` storage keys are NOT touched in this phase.** They are a data migration and belong to Phase 2, shipped alone.
> **`admin@keystroke.ai` in `0004` is NOT renamed.** It is a database identity, not brand copy.

**Acceptance.**
- [ ] `grep -rn '\bKeyStroke\b'` returns nothing outside `docs/`
- [ ] `keystrokes` identifier count unchanged in `useTypingEngine.js`
- [ ] Build passes, all Tier-1 tests pass
- [ ] Favicon and PWA icons regenerate from the new mark
- [ ] Old routes redirect rather than 404

**Risks.** A careless replace corrupts the typing engine (**R-1, Critical**) — mitigated by steps 2 and 4 above, which fail loudly.

**Rollback.** `git revert`. No data touched.

---

## PHASE 2 — Foundation

**Objective.** Tokens, type, components and the storage migration. **The storage migration ships alone.**

**Files.** `src/index.css` · `tailwind.config.js` · `index.html` · new `src/lib/storage/namespace.js` · `store.jsx`, `chatStore.js`, `theme.jsx`, `AppShell.jsx`, `sync.js`, `IntroPanel.jsx` · `components/ui/*` · `components/charts/*` · `scripts/check-contrast.mjs`

**Dependencies.** Phase 0 (tests), Phase 1 (brand identity settled).

### 2A — Tokens & type

| # | Task |
|---|---|
| 2.1 | Replace the colour tokens in `index.css` with the §C.1 palette, both themes |
| 2.2 | Load Space Grotesk + IBM Plex Sans + JetBrains Mono; **8 weights, same budget as today** |
| 2.3 | Type scale, spacing, radius, elevation into `tailwind.config.js` |
| 2.4 | Move Prism token colours into the token system (fixes C-3) |
| 2.5 | Move achievement tier colours into tokens (fixes A-3) |
| 2.6 | **Delete `aurora`, `liquid-glass`, `glow-panel` and all decorative blur orbs** — 8 files (X-5) |
| 2.7 | **`check-contrast.mjs` reads tokens from `index.css`** instead of hardcoding (G-4) |
| 2.8 | **Add ΔE2000 categorical validation** to the script (G-1) — makes `palette.js:14` executable |
| 2.9 | Re-run both validators; record output in `palette.js` |

### 2B — Storage migration — **ships as its own release**

| # | Task |
|---|---|
| 2.10 | `lib/storage/namespace.js` — copy-forward, never move, never overwrite, never throw |
| 2.11 | Call it at module init in `main.jsx`, **before** `StoreProvider` |
| 2.12 | `index.html` pre-paint script reads `typeforge.theme` with a `keystroke.theme` fallback |
| 2.13 | Switch all 6 keys |
| 2.14 | **Test: seed legacy keys → assert full recovery.** Non-negotiable |

### 2C — Components

| # | Task |
|---|---|
| 2.15 | **Remove framer-motion from `ProgressBar`/`ProgressRing`** — CSS transitions. Unhooks 22 files (G-2) |
| 2.16 | Button, Input, Card, Chip, Tabs, Modal, Tooltip, Toast to spec |
| 2.17 | **Split `Charts.jsx`** → `primitives.jsx` (SVG only) + `recharts.jsx`. Update 6 import sites |
| 2.18 | Navigation: 5 items, `NAV_GROUPS` derived from the mode registry |
| 2.19 | **Shell focus mode** — rail, tab bar, FAB actually unmount |
| 2.20 | Delete the cycling tagline (`AppShell.jsx:397-439`) |
| 2.21 | Mode registry + session contract (TRD §B.19); **write the stickman entry as the acceptance test** |

**Acceptance.**
- [ ] `node scripts/check-contrast.mjs` exits 0; ΔE check present and passing
- [ ] **Legacy-key fixture recovers full progress** — the release gate for 2B
- [ ] No theme flash on first load after upgrade
- [ ] `SessionSummary` pulls **0 kB** of recharts
- [ ] `ProgressBar` no longer imports framer-motion
- [ ] All 8 modes expressed by the registry, behaviour unchanged
- [ ] **The stickman registry entry is written and requires no core change** (SC-A5)
- [ ] `aurora`/`liquid-glass`/`glow-panel` return zero grep hits

**Risks.**
- **R-2 (Critical): storage rename wipes progress.** Mitigated by copy-not-move, never-overwrite, idempotence, and 2.14.
- Registry over-abstraction — build only what the stickman entry needs; no speculative fields.

**Rollback.** 2B keeps the `keystroke.*` keys in place for one release, so reverting the build restores the old app reading its own data. **This is why copy-not-move is mandatory.**

---

## PHASE 3 — Core UX

**Objective.** Landing, dashboard, typing Stage, results, statistics, profile.

**Files.** new `modules/landing/*` · `modules/home/*` (from `landing/Landing.jsx`) · `Practice.jsx` · `TypingStage.jsx` · `SessionSummary.jsx` · `Dashboard.jsx`→`Progress.jsx` · `Profile.jsx`

**Dependencies.** Phase 2 complete.

| # | Task |
|---|---|
| 3.1 | **Landing at `/`** — own component set, **no `Primitives`, no framer-motion** (G-2). Hero contains a live typing surface |
| 3.2 | `/` → `/home` redirect when local progress exists |
| 3.3 | `/home` dashboard with the **Next-Action banner** — the 6-priority resolution incl. weak-key drill |
| 3.4 | **Stage discipline in `Practice.jsx`** — controls collapse to one bar and fade to 40% on first keystroke |
| 3.5 | **`TypingStage` non-colour state cues** (AX-1). Underline/background only — **never font-weight**, which reflows and moves the caret |
| 3.6 | **`SessionSummary` becomes inline**, not a Modal. `Enter`/`R`/`D` bound |
| 3.7 | Weak keys promoted above the buttons in the result |
| 3.8 | `Progress` — weak keys to position 2; skill radar cut or its normalisation stated (U-4) |
| 3.9 | Profile: real `Switch`, avatar picker collapsed, settings absorbed |
| 3.10 | `aria-live` on run completion (AX-2) |
| 3.11 | **Apply the PO-1 fix ladder only if 0.6 failed** — cache caret ref → memoise spans → window render → CSS caret. Re-measure after each |

**Acceptance.**
- [ ] Landing ≤ **150 kB gzip**, verified in build output
- [ ] Typing states distinguishable **in greyscale** — screenshot proof
- [ ] Zero dropped keystrokes at 150 WPM on a 4000-char passage
- [ ] Result reachable and dismissable by keyboard alone
- [ ] No chrome visible in focus mode
- [ ] Every Practice mode still works; Tier-1 tests green

**Risks.** 3.5 could alter text metrics and move the caret — the underline/background constraint exists to prevent it. 3.11 risks regressing the caret feel; the spring tuning is documented as correct and must not change.

**Rollback.** Per-surface. Each screen is an independent revert.

---

## PHASE 4 — Code practice

**Objective.** Code Stage to the same standard, with syntax/state resolved.

**Files.** `CodeTyping.jsx` · `AISidebar.jsx` · `IntroPanel.jsx` · `TypingStage.jsx` · `lib/prism.js` · `index.css`

**Dependencies.** Phase 3 (Stage contract established).

| # | Task |
|---|---|
| 4.1 | Stage discipline; AI sidebar collapses to a 40px rail during a run |
| 4.2 | **Typing state overrides syntax colour** — precedence `wrong → corrected → current → syntax → pending` (fixes C-2) |
| 4.3 | Verify across all 11 grammars × 2 themes |
| 4.4 | Emit the session contract with `language` |
| 4.5 | Replace the magic `chrome = 210` with measured layout |
| 4.6 | Language/difficulty from the registry — one `DIFFICULTIES` definition (fixes D-5) |

**Acceptance.**
- [ ] A wrong character reads as wrong in **all 11 languages, both themes** — screenshot matrix
- [ ] Code mode fully functional with AI disabled
- [ ] `?lang=` deep link works and clears the param
- [ ] `DIFFICULTIES` has exactly one definition in the codebase

**Risks.** Prism token colours moving into tokens could regress legibility — 4.3 is the gate.

**Rollback.** Single module.

---

## PHASE 5 — Competitive

**Objective.** Battlefield redesigned; Quick Match and rematch added. **The backend is not modified — only extended.**

**Files.** `modules/battle/*` · `lib/battle/api.js` · new `0013_quick_match.sql`

**Dependencies.** Phases 2–3. `0011` applied.

| # | Task |
|---|---|
| 5.1 | Redesign all four phases to the TypeForge language |
| 5.2 | **Promote `whyWon()` to `title-l`** directly under the headline (fixes B-3) |
| 5.3 | **Surface cheat flags inline** with a word — not a hover title (fixes B-4, CH-1) |
| 5.4 | Race track as the centrepiece; own lane 2× height; rivals ≤`--ink-3` at 60% |
| 5.5 | Rank badges as SVG shapes, not emoji |
| 5.6 | `0013` — `is_public`, `rated`, `rematch_of`, `ready` |
| 5.7 | `battle_find_public()` — **takes no PIN input; table policy untouched** |
| 5.8 | Quick Match UI with the 3-step fallback chain incl. the 60s time-trial offer |
| 5.9 | `battle_rematch()` — **must re-run every `battle_create` check**, including the 3-room cap |
| 5.10 | `battle_set_ready()` as an RPC — RLS cannot restrict columns |
| 5.11 | `RaceView` emits the session contract |
| 5.12 | Resolve `U-6`: two tabs, same user, same room |

**Acceptance.**
- [ ] **Every §16.1 security property verified intact** — written threat re-check
- [ ] `set role anon` cannot call any new RPC
- [ ] `select * from battle_rooms where pin = '<known>'` returns **zero rows** for a non-member
- [ ] Rematch cannot exceed the 3-room cap
- [ ] 8-player race produces identical results on all 8 clients
- [ ] Mid-race refresh restores the correct phase
- [ ] Two-tab behaviour defined and tested

**Risks.**
- **R-7 (Critical): Quick Match reintroduces room enumeration.** 5.7's design is the mitigation; the acceptance test is the proof.
- **R-4 (Critical): redesign breaks an anti-cheat property.** Nothing in `0009` is edited; acceptance requires the explicit re-check.

**Rollback.** `0013` is additive — `is_public` defaults `false`, so reverting the client leaves no public rooms. Fully reversible.

---

## PHASE 6 — Progression

**Objective.** Rating, boards, achievements. **XP maths is frozen.**

**Files.** `Achievements.jsx`→`Awards.jsx` · new `modules/ranks/*` · `gamification.js` (**additive only**) · `0011`, `0014`

**Dependencies.** Phase 5 (rating needs real matches).

| # | Task |
|---|---|
| 6.1 | `0011` — rating columns, `rating_history`, `skill_leaderboard`, rebuilt `leaderboard` |
| 6.2 | **Elo pass in `battle_settle()` — built and tested standalone first** |
| 6.3 | Behind `battle_rooms.rated`, default `false` |
| 6.4 | Exclude flagged results from rating (CH-3) |
| 6.5 | `/ranks` with XP and Skill as **separate, labelled** boards |
| 6.6 | **Fix leaderboard row keys** — names are not unique; production has two "Meow" |
| 6.7 | Rating delta always shows an arrow + the reason |
| 6.8 | Awards: three bands, locked badges at full contrast, `opacity-60` removed |
| 6.9 | Achievement progress via an optional `progress()` — additive, existing entries unchanged |

**Acceptance.**
- [ ] **XP for a fixed input set is byte-identical to pre-rebrand** (S-6)
- [ ] Level thresholds unchanged
- [ ] No UI string asserts "XP = rank"
- [ ] Duplicate display names render without row-identity bugs
- [ ] A rating change is explainable from what the UI shows
- [ ] Rating skipped for flagged results — test with a seeded flag

**Risks.** **R-5: altering progression rewrites user history.** Golden-value tests from Phase 0 are the gate. `battle_settle()` runs inside the finish transaction — a bug fails a *match*, hence 6.2's standalone requirement.

**Rollback.** `rated = false` disables the rating pass without a migration.

---

## PHASE 7 — Future architecture

**Objective.** Prove the seams. **Ships no user-visible feature.**

**Files.** `src/app/modes.js` · `session.js` · `lib/battle/useBattleRoom.js` (docs only) · `docs/07-combat-spec.md`

**Dependencies.** Phase 2 (registry), Phase 5 (multiplayer patterns proven).

| # | Task |
|---|---|
| 7.1 | **Write the stickman registry entry** — `scoring: 'contest'`, `maxPlayers: 2`, `realtime: 'event'` |
| 7.2 | Prove it needs **no** change to nav, palette, scoring or `store.jsx` |
| 7.3 | Session contract carries a mode-specific `extra` payload without schema change |
| 7.4 | Add the consecutive-correct counter to `useTypingEngine` — the one new engine value combat needs |
| 7.5 | Document the combat signal contract (design brief §I.1) |
| 7.6 | **Record the open risk:** per-hit resolution may need a stateful server, breaking "no application server" (T-7) |

**Acceptance.**
- [ ] **The stickman entry is expressible with zero core changes** — this is the acceptance test for the entire extensibility programme (SC-A5)
- [ ] Adding a test mode touches only the registry
- [ ] The combat spec names its server-arbitration requirement

**Risks.** If 7.2 fails, the registry is wrong and **must be redesigned before the cycle closes** — that is the point of doing this now rather than in Phase 4 of next year.

**Rollback.** Documentation and one counter. Nothing to revert.

---

## PHASE 8 — Polish

**Objective.** Motion, states, accessibility, performance, SEO, mobile.

**Files.** Global · `vercel.json` · `public/robots.txt`, `sitemap.xml` · new prerender script

**Dependencies.** Phases 3–6.

| # | Task |
|---|---|
| 8.1 | Motion tokens applied; **only `transform`/`opacity` animated** |
| 8.2 | **Delete `float`, confetti (2 sites), remaining ambient motion** |
| 8.3 | Loading ladder: <100ms nothing · <500ms inline · <3s skeleton. Passage regeneration keeps old text under a shimmer |
| 8.4 | Empty states on all 9 surfaces — explain, instruct, offer the control |
| 8.5 | Error states — `TF###` codes with actionable copy |
| 8.6 | axe in CI, zero criticals, output recorded |
| 8.7 | WCAG 2.2: focus-not-obscured (H-6), target size (H-7) |
| 8.8 | SEO: per-route titles (~20 lines, **no library** — T-3), OG, canonical, robots, sitemap, JSON-LD |
| 8.9 | Prerender `/` and `/about`; CI asserts the files exist and contain expected text |
| 8.10 | Mobile per the Phase 0 decision; tables → stacked lists; nothing primary `hidden` |
| 8.11 | Re-measure every budget |

**Acceptance.**
- [ ] axe: zero criticals on every route, output committed
- [ ] Lighthouse ≥ 90 on landing and typing
- [ ] Zero horizontal scroll at 360/390/768/1024/1440/2560
- [ ] Shared links render a preview card on ≥2 platforms
- [ ] `prefers-reduced-motion` verified on countdown, race track, level-up
- [ ] Landing ≤150 kB gzip, still

**Risks.** Prerendered HTML silently drifting from the app — 8.9's CI assertion is the mitigation.

**Rollback.** Prerender is a build step; removing it falls back to the SPA.

---

## PHASE 9 — QA & release

**Objective.** Prove the release meets the PRD's success criteria.

**Dependencies.** All phases.

| # | Area | Gate |
|---|---|---|
| 9.1 | Functional | Every route, every mode, every phase — manual pass |
| 9.2 | Regression | **No §9 preservation-contract item regressed** (PRE-1…PRE-14) |
| 9.3 | UI | Screenshot matrix: 9 surfaces × 2 themes × 4 breakpoints |
| 9.4 | Responsive | 6 widths, no horizontal scroll |
| 9.5 | Accessibility | axe zero criticals + full keyboard traversal + greyscale proof |
| 9.6 | Performance | Bundle budgets, Lighthouse, **150 WPM latency** |
| 9.7 | Security | Anon RPC probe · PIN enumeration · `/admin` as non-admin · RLS spot-checks |
| 9.8 | Multiplayer | 8-player race · mid-race refresh · host leave · disconnect · two tabs |
| 9.9 | **Migration** | Upgrade from a **real** legacy profile; progress intact |
| 9.10 | Brand | Two greps: zero `KeyStroke`, unchanged `keystrokes` count |

**Acceptance — the PRD's own release blockers:**
- [ ] S-1 no §9 capability regressed
- [ ] S-2 zero user-visible "KeyStroke"
- [ ] S-3 zero corrupted `keystrokes` identifiers
- [ ] S-4 upgrading user loses no progress
- [ ] S-5 every Battlefield security property intact
- [ ] S-6 XP/level/streak byte-identical
- [ ] S-7 WCAG AA both themes, zero criticals
- [ ] S-8 landing ≤150 kB gzip
- [ ] S-9 zero dropped keystrokes at 150 WPM
- [ ] S-10 build passes
- [ ] S-11 stickman entry expressible

**Rollback.** Vercel instant rollback for the client. **Migrations `0010` is the only irreversible step** — hence its staging rehearsal and last-in-sequence position.

---

# PART D — Final full-project audit

Run after Phase 9, before release. Each line is a command or a named artefact, not a judgement call.

## Code health
- [ ] `grep -rn '\bKeyStroke\b' src index.html public package.json assets` → **empty**
- [ ] `keystrokes` identifier count in `useTypingEngine.js` → **9, unchanged**
- [ ] `grep -rn 'aurora\|liquid-glass\|glow-panel'` → **empty**
- [ ] `grep -rn 'Confetti'` → **empty**
- [ ] ESLint: zero errors, zero unused imports
- [ ] `depcheck`: zero unused dependencies
- [ ] `DIFFICULTIES` defined **once**
- [ ] No `console.*` in production output except real errors
- [ ] Dead schema dropped; `sync.js` no longer references it

## Routes & interactions
- [ ] Every route in `App.jsx` reachable; old routes redirect
- [ ] Deep links preserved: `?mode=`, `?lang=`, `/battle/:pin`
- [ ] Command palette reaches every destination
- [ ] ⌘K and ⌘\ work
- [ ] Zero console errors on any route

## Product quality
- [ ] All 6 practice modes, 11 languages, 4 battle phases functional
- [ ] Offline: practice, code, stats, achievements all work with the network off
- [ ] Cloud-disabled build shows **no** cloud UI
- [ ] Guest → email upgrade preserves XP, streak, achievements

## Accessibility & responsive
- [ ] axe zero criticals, output committed
- [ ] Greyscale screenshots prove typing states are distinguishable
- [ ] Full keyboard traversal, no traps; `Tab` is a character inside the Stage
- [ ] Touch targets ≥44px
- [ ] 360→2560px, no horizontal page scroll

## Performance
- [ ] Landing ≤150 kB gzip
- [ ] `SessionSummary` pulls 0 kB recharts
- [ ] Zero dropped keystrokes at 150 WPM
- [ ] Lighthouse ≥90 on landing and typing

## Security
- [ ] Anon cannot call any RPC
- [ ] Rooms not enumerable by PIN **after** Quick Match ships
- [ ] Non-admin `/admin` shows an empty panel, not data
- [ ] Leaderboard exposes exactly 4 columns
- [ ] Data deletion removes cloud rows — verified

## Coherence — the judgement pass
- [ ] Every screen is exactly **one** archetype
- [ ] ≤2 forge elements per viewport
- [ ] One display size per screen
- [ ] No screen reads as generic AI-SaaS or cheap gaming
- [ ] Side-by-side before/after review

---

# PART E — Sequencing

```
PHASE 0  Audit ──────────────── gate: CI green, baselines recorded
   │                                   ▼ nothing starts before this
PHASE 1  Rebrand ────────────── gate: two greps
   │
PHASE 2A Tokens ───────────────┐
PHASE 2B Storage ── SHIPS ALONE┤ gate: legacy fixture recovers
PHASE 2C Components ───────────┘ gate: registry + stickman entry
   │
PHASE 3  Core UX ────────────── gate: 150 kB, greyscale, latency
   │
   ├── PHASE 4  Code ────────── gate: 11 grammars × 2 themes
   ├── PHASE 5  Competitive ─── gate: security re-check      ← 0013
   └── PHASE 6  Progression ─── gate: XP byte-identical      ← 0011, 0014
   │
PHASE 7  Future arch ────────── gate: SC-A5
   │
PHASE 8  Polish ─────────────── gate: axe, Lighthouse, budgets
   │
PHASE 9  QA ─────────────────── gate: 11 PRD release blockers
   │
        0010 (destructive) ──── LAST. After staging rehearsal.
```

**Three ordering rules that are not negotiable:**

1. **Phase 0 gates everything.** Without Tier-1 tests, no later phase is verifiable — a refactor that silently changes the XP formula would ship unnoticed.
2. **Phase 2B ships alone.** If progress goes missing after an upgrade, the cause must be unambiguous. Bundling it with visual changes makes the bisect impossible.
3. **`0010` runs last.** It drops `problem_progress`, which `sync.js:181` still writes to. Dropping it first breaks sync the moment it lands.

**Phases 4, 5 and 6 are parallelisable** once Phase 3 sets the Stage contract — they touch disjoint modules.

---

## Appendix — plan verification

| Check | Result |
|---|---|
| All five documents compared against each other and the code | ✅ Part A |
| Contradictions found, resolved, and binding | ✅ 5 (X-1…X-5) |
| Gaps found where a requirement was unmeetable | ✅ 4 (G-1…G-4), incl. a validator that does not exist |
| Unnecessary complexity cut with reasons | ✅ 7 items |
| Assumptions recorded | ✅ 6 |
| All 10 phases: objective, files, dependencies, tasks, acceptance, risks, rollback | ✅ Part C |
| Final full-project audit covering all 16 requested areas | ✅ Part D |
| Refactor-over-replacement respected | ✅ `0009` untouched; 10 tables unchanged; formulas frozen |
| Every acceptance criterion is a command or artefact, not an opinion | ✅ |
