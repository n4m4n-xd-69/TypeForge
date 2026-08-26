# Shadow Battle — Progression, Achievements & Anti-Cheat Validation (Design)

**Status:** Plan 7 of the 8-plan Shadow Battle build sequence.
**Source of truth:** `docs/08-PRD-shadow-battle.md` §19 (Progression), §20 (Rewards & Achievements), §21 (Anti-Cheat).

---

## Goal

Extend the TypeForge gamification system with Shadow Battle's 10 combat achievements and 4 daily missions, update daily counter tracking, and implement client-side anti-cheat validation functions for event plausibility and IKI variance analysis.

---

## Key Modules

### 1. `src/lib/gamification.js` [EXTEND]
- **Achievements (`ACHIEVEMENTS`):**
  - `shadow-first` (Into the Dark, bronze)
  - `shadow-win` (First Shadow, bronze)
  - `shadow-flawless` (Untouched, silver)
  - `shadow-parry-10` (Read the Blade, silver)
  - `shadow-chain-15` (Unbroken Chain, gold)
  - `shadow-overdrive` (Full Burn, gold)
  - `shadow-comeback` (From the Ashes, gold)
  - `shadow-rank-quench` (Quenched, gold)
  - `shadow-rank-damascus` (Folded Steel, legend)
  - `shadow-win-25` (Duellist, legend)
- **Daily Missions (`MISSION_POOL`):**
  - `shadow-rounds-3` (Win 3 Shadow rounds, 60 XP)
  - `shadow-clean-40` (Land 40 clean words in Shadow Battle, 55 XP)
  - `shadow-parry-3` (Land 3 parries, 65 XP)
  - `shadow-chain-10` (Reach a chain of 10, 50 XP)
- **Daily Counters (`EMPTY_DAY`):**
  - `shadowRoundsWon`, `shadowCleanWords`, `shadowParries`, `shadowChain10`

### 2. `src/lib/shadow/antiCheat.js` [NEW]
- **Per-word plausibility floor (PRD §21.2 #1):**
  - `minPlausibleMs(chars) = 55 + 18 * chars`
- **Rolling rate ceilings (PRD §21.2 #2):**
  - Single card $> 300$ WPM flag
  - 3 consecutive cards $> 220$ WPM flag
- **Inter-keystroke interval (IKI) variance (PRD §21.2 #3):**
  - `isIkiSynthetic(mean, stdev)`: flags if `stdev / mean < 0.08`
- **Event stream integrity:**
  - Sequence monotonicity and timestamp boundary enforcement.

---

## Verification Plan
- `gamification.test.js`: Test all 10 new Shadow achievements against mock state fixtures, and test daily mission assignment.
- `antiCheat.test.js`: Test plausible vs superhuman typing speeds, IKI variance flagging on synthetic scripts, and event boundary validation.
