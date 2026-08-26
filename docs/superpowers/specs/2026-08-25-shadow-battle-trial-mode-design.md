# Shadow Battle — Trial Mode & Bot System (Design)

**Status:** Approved for planning. Plan 3 of the 8-plan Shadow Battle build sequence (see `typeforge-shadow-battle-build` project memory). Plan 0 (mode registry), Plan 1 (combat reducer core), and Plan 2 (word/move queue) are merged to `typeforge`.

**Source of truth:** `docs/08-PRD-shadow-battle.md` §7.1 (Trial mode), §13 (Bot system), §8 (Combat event model), §10.2 (Overdrive stickiness), §12 (Match progression), §19.1 (XP rules).

---

## Goal

Build the first fully-playable, end-to-end combat loop for Shadow Battle: **Trial Mode (play vs. bot)**.
Trial mode runs 100% client-side and offline, wiring:
1. Pure combat reducer from Plan 1 (`combat.js`, `damage.js`, `roundState.js`, `match.js`)
2. Seeded queue and card resolution from Plan 2 (`prng.js`, `phraseTable.js`, `wordQueue.js`, `cardResolution.js`)
3. A realistic, observable-state-only bot simulation with 5 distinct profiles (`Recruit`, `Adept`, `Ronin`, `Shade`, `Mirror`)
4. An event resolution seam with Overdrive stickiness caching per card index
5. A deterministic trial session engine that coordinates player typing, bot ticks, round transitions, and match settlement.

---

## Core Decisions & Architecture

### 1. Bot Behavior Model (§13.2)

The bot plays the exact same game as the human player and emits standard `CombatEvent`s. It never cheats, never modifies damage or HP directly, and only reads observable state.

Each card, the bot executes a 4-phase cycle:
```
1. REACT   -> Wait reactionMs (+ small deterministic jitter) before processing card
2. DECIDE  -> Choose lane ('strike' vs 'guard') using profile policy based ONLY on observable state
3. TYPE    -> Sample completion time from log-normal distribution; sample errors based on cleanRate
4. EMIT    -> Emit a fully-resolved CombatEvent to the combat engine
```

#### Observable State Rule (SB-BOT-9)
The bot's decision policy receives ONLY:
- Own HP, Focus, Chain
- Opponent HP, Focus, Chain
- Opponent card progress (fraction complete `0..1` and committed lane if committed)
- Whether an opponent strike is currently in flight (`strikeInFlightAt`)

The bot NEVER reads:
- Opponent uncommitted cards or future queue indices
- Hidden inputs before they are committed
- Opponent's upcoming Overdrive/Mend state before visible

#### Log-Normal Typing Time Simulation
Human typing times are right-skewed. To prevent robotic pacing:
```
targetMs = parMs(cardChars) * (REF_WPM / botWpm)
actualMs = targetMs * exp(sigma * z)
```
where `z` is a standard normal sample generated via Box-Muller transform using `draw(prngState)`.

#### Error & Penalty Model
Errors are sampled per card: `cleanRoll < cleanRate ? 0 : 1 + floor(extraErrors)`.
When errors occur, the bot pays a realistic correction cost:
```
durationMs = actualMs + (140 + 90 * errors)
```

---

### 2. Bot Profiles (§13.3, §13.4)

| Profile | Difficulty | Mean WPM | Sigma (WPM) | Clean Rate | Reaction Ms | Guard Policy | Parry Policy | Overdrive Policy |
|---|---|---|---|---|---|---|---|---|
| **Recruit** | Easy | 28 | 9 | 0.88 | 700ms | 15% (only if HP < 300) | 0% (never) | Random, 2000ms delay |
| **Adept** | Normal | 45 | 11 | 0.94 | 450ms | 32% | 10% (untimed) | Plays immediately when available |
| **Ronin** | Hard | 65 | 12 | 0.97 | 300ms | 52% | 30% (when strike in flight) | Holds for opening (opponent neutral/committed) |
| **Shade** | Expert | 88 | 14 | 0.99 | 200ms | 68% | 45% (tight timing on in-flight strike) | Holds for committed opponent |
| **Mirror** | Adaptive | dynamic | 10 | dynamic | 260ms | 45% | 25% | Holds for opening |

#### Mirror Adaptive Profile (§13.4)
Recalculated at the **end of each round**:
```
botWpm    = clamp(28, 88, observedPlayerWpm * 0.97)
cleanRate = clamp(0.86, 0.985, observedPlayerCleanRate - 0.01)
```
- Hard clamp: botWpm never exceeds `1.05 * bestPlayerWpmInMatch`.
- Floor: never drops below Recruit (28 WPM).

---

### 3. Event Resolution Seam & Overdrive Stickiness

- **Event Resolution Seam:** Wire `CombatEvent` contains `cardIndex`. Before reaching `stepEvent`, the engine resolves the card to `moveId` and `chars`.
- **Overdrive Stickiness (PRD §10.2):**
  When a player reaches 100 Focus, `resolveForPlayer` overrides their strike slot with Overdrive.
  Because `resolveForPlayer` is a pure function of current `roundState`, if Focus subsequently drops below 100 (e.g. from an opponent strike) before the player finishes the card, Overdrive must NOT vanish.
  **Solution:** The trial engine caches the resolved card pair for the player's active `cardIndex` once Overdrive triggers, preserving it until the card is completed, expired, or the round ends.

---

### 4. Player Input & Typing State Machine

The trial engine tracks Player 0's keystrokes:
1. **Uncommitted State:**
   - Left card: Strike word
   - Right card: Guard word
   - First character disambiguation: By SB-WRD-1, `strikeWord[0].toLowerCase() !== guardWord[0].toLowerCase()`.
   - Matching key commits to `strike` or `guard` lane and starts card timer (`tStart`).
   - Non-matching key triggers **Whiff** (`focus = max(0, focus - 3)`).
2. **Committed State:**
   - Player types remaining characters of committed word.
   - Wrong character: recorded in `errors` count, tracked via `everWrong` mask.
   - Completion: when `cursor === word.length`, emits `CombatEvent` with `outcome: 'complete'`.
   - Expiration: If `elapsedMs - tStart > deadlineMs`, emits `CombatEvent` with `outcome: 'expire'`.

---

### 5. Match Lifecycle & Scoring

- **Match Structure:** Best-of-3 rounds, hard stop at 5 rounds, sudden death if tied 1-1 with draws (§12).
- **Round Lifecycle:**
  1. `COUNTDOWN` (3.5s)
  2. `COMBAT` (active typing & bot execution)
  3. `ROUND_OVER` (triggered on HP <= 0 or 90s timeout)
  4. `ROUND_SUMMARY` (review stats, update Mirror adaptation)
  5. Next round or `MATCH_SUMMARY`
- **Session Payload & Store Integration:**
  Constructs standard session payload via `buildSessionPayload` with:
  - `mode: 'shadow'` (or `shadow-trial`)
  - `kind: 'shadow'` (xpRule kindFactor: 1.20)
  - `meta`: `{ opponentKind: 'bot', botProfile, roundsWon, roundsLost, matchOutcome, ... }`
  - Persists last-used bot profile in `localStorage` under `typeforge:shadow:last_bot_profile`.

---

### 6. Word Bank Content Gap Fix

To satisfy SB-WRD-5 and prevent repetitive words during Mend and Slash draws:
- Add 45 common English 6, 7, and 8-character words to `COMMON` in `src/lib/content.js`.
- Verify all existing 212 tests continue to pass.
