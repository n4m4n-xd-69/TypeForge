# Shadow Battle Trial Mode & Bot System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete, deterministic, offline-first Trial Mode engine (play vs. bot) for Shadow Battle. This connects Plan 1's combat reducer (`combat.js`, `damage.js`, `roundState.js`, `match.js`) and Plan 2's deterministic word queue (`prng.js`, `phraseTable.js`, `wordQueue.js`, `cardResolution.js`) with a realistic 5-profile bot simulation (`bot.js`) and trial session coordinator (`trialEngine.js`).

**Architecture:**
- `src/lib/content.js`: Expanded `COMMON` word list to eliminate Mend/Slash repetition gap.
- `src/lib/shadow/bot.js`: 5 bot profiles (`Recruit`, `Adept`, `Ronin`, `Shade`, `Mirror`), log-normal typing duration model, error generation, and observable-state decision policies.
- `src/lib/shadow/bot.test.js`: Test suite covering bot timing, decision heuristics, error rates, and state isolation.
- `src/lib/shadow/trialEngine.js`: State machine managing player keystrokes (fork commitment, input validation, whiff/expire), card resolution caching (Overdrive stickiness), bot tick orchestration, combat event folding, and match lifecycle.
- `src/lib/shadow/trialEngine.test.js`: Deterministic match & round simulation tests.
- `src/lib/shadow/trialSession.js`: Store/session payload integration, XP calculation, and local preference persistence (`typeforge:shadow:last_bot_profile`).

**Tech Stack:** Vitest, plain JavaScript, runtime-neutral (Deno/Node/Browser compatible).

---

## File Structure

**New:**
- `src/lib/shadow/bot.js`
- `src/lib/shadow/bot.test.js`
- `src/lib/shadow/trialEngine.js`
- `src/lib/shadow/trialEngine.test.js`
- `src/lib/shadow/trialSession.js`
- `src/lib/shadow/trialSession.test.js`

**Modified:**
- `src/lib/content.js` — add 45 common 6, 7, and 8-character words to `COMMON`.
- `src/lib/shadow/wordQueue.test.js` — add checks for 6-8 char COMMON word density.
- `src/lib/shadow/combat.determinism.test.js` — add new shadow modules to determinism check list.

---

### Task 1: Word Bank Content Gap Fix (`src/lib/content.js`)

**Files:**
- Modify: `src/lib/content.js`
- Modify: `src/lib/shadow/wordQueue.test.js`

**Objectives:**
- Add 45 common natural English 6–8 letter words to `COMMON` (e.g. `action`, `animal`, `answer`, `bridge`, `change`, `circle`, `danger`, `direct`, `energy`, `engine`, `family`, `father`, `flight`, `forest`, `ground`, `growth`, `island`, `letter`, `liquid`, `market`, `master`, `memory`, `minute`, `moment`, `motion`, `nation`, `nature`, `object`, `person`, `planet`, `pocket`, `record`, `region`, `result`, `rhythm`, `season`, `secret`, `shadow`, `signal`, `silver`, `simple`, `sister`, `source`, `spring`, `square`, `station`, `stream`, `street`, `strike`, `summer`, `symbol`, `system`, `target`, `theory`, `travel`, `valley`, `vector`, `vision`, `volume`, `weapon`, `weight`, `window`, `winter`, `yellow`).
- Ensure `wordsInRange(COMMON, 6, 8).length >= 40`.

- [ ] **Step 1: Update `src/lib/content.js`**
- [ ] **Step 2: Add test asserting sufficient 6-8 char words in `src/lib/shadow/wordQueue.test.js`**
- [ ] **Step 3: Run `npm test` and verify full suite passes**

---

### Task 2: Bot System & Profiles (`src/lib/shadow/bot.js` & `bot.test.js`)

**Files:**
- Create: `src/lib/shadow/bot.js`
- Create: `src/lib/shadow/bot.test.js`

**Interfaces:**
- `BOT_PROFILES`: Object mapping `recruit`, `adept`, `ronin`, `shade`, `mirror` to configuration objects:
  - `name`, `difficulty`, `wpmMean`, `wpmSigma`, `cleanRate`, `reactionMs`, `guardRate`, `parryRate`, `overdriveDiscipline`
- `createBotState(profileId, seed, round, { mirrorStats } = {}) -> BotState`
- `botTick(botState, roundState, opponentObservable, elapsedMs, band) -> { nextState, emittedEvents: CombatEvent[] }`
- `sampleTypingDuration(prngState, botWpm, sigma, charCount) -> { durationMs, nextState }`
- `computeMirrorProfile(playerWpm, playerCleanRate, bestPlayerWpm) -> BotProfile`

- [ ] **Step 1: Write `src/lib/shadow/bot.test.js` with comprehensive assertions**
  - Verify log-normal distribution properties
  - Verify reaction times and error generation
  - Verify observable state isolation (no unobservable fields read)
  - Verify profile-specific lane choice and Overdrive behavior
  - Verify Mirror adaptation formulas and clamping (§13.4)
- [ ] **Step 2: Implement `src/lib/shadow/bot.js`**
- [ ] **Step 3: Run `npm test src/lib/shadow/bot.test.js` and verify passing**

---

### Task 3: Trial Engine & Input State Machine (`src/lib/shadow/trialEngine.js` & `trialEngine.test.js`)

**Files:**
- Create: `src/lib/shadow/trialEngine.js`
- Create: `src/lib/shadow/trialEngine.test.js`

**Interfaces:**
- `createTrialMatch(config: { seed, botProfileId, band, matchId }) -> TrialMatchState`
- `startRound(matchState) -> TrialRoundState`
- `handlePlayerInput(roundState, key, timestampMs) -> { nextRoundState, event: CombatEvent | null, whiff: boolean }`
- `engineTick(roundState, timestampMs) -> { nextRoundState, roundEnded: boolean, roundOutcome: object | null }`
- `resolveActiveCard(roundState, player) -> ResolvedCard` (with Overdrive stickiness caching)
- `resolveWireEvent(roundState, wireEvent) -> ResolvedCombatEvent`

- [ ] **Step 1: Write `src/lib/shadow/trialEngine.test.js`**
  - Test fork commitment on first key
  - Test whiff on wrong first key (Focus -3)
  - Test card completion and CombatEvent generation
  - Test Overdrive caching stickiness when Focus changes mid-card
  - Test 3.5s countdown and 90s round timer / HP 0 end condition
  - Test best-of-3 / sudden death match flow
- [ ] **Step 2: Implement `src/lib/shadow/trialEngine.js`**
- [ ] **Step 3: Run `npm test src/lib/shadow/trialEngine.test.js` and verify passing**

---

### Task 4: Trial Session Reporting & Persistence (`src/lib/shadow/trialSession.js` & `trialSession.test.js`)

**Files:**
- Create: `src/lib/shadow/trialSession.js`
- Create: `src/lib/shadow/trialSession.test.js`
- Modify: `src/lib/shadow/combat.determinism.test.js`

**Interfaces:**
- `buildTrialSessionResult(matchState, playerMetrics) -> SessionPayload`
  - Complies with `buildSessionPayload` and `stickmanExpressibility.test.js`
  - Includes `mode: 'shadow'`, `kind: 'shadow'`, `meta: { opponentKind: 'bot', botProfile, roundsWon, roundsLost, matchOutcome, hpRemainingSum }`
- `getStoredBotProfile(storage) -> string`
- `setStoredBotProfile(storage, profileId) -> void`

- [ ] **Step 1: Write `src/lib/shadow/trialSession.test.js`**
  - Verify session payload shape & XP calculation with `kindFactor: 1.20`
  - Verify local storage persistence of last-used bot profile
- [ ] **Step 2: Implement `src/lib/shadow/trialSession.js`**
- [ ] **Step 3: Update `combat.determinism.test.js` with new modules**
- [ ] **Step 4: Run full test suite `npm test` and verify 100% pass rate**

---

### Task 5: Status Update & Handoff

- [ ] **Step 1: Update `docs/superpowers/SHADOW_BATTLE_STATUS.md` recording Plan 3 completion**
- [ ] **Step 2: Verify git status and clean state**
