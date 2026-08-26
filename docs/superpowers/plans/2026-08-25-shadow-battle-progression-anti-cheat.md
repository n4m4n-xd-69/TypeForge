# Shadow Battle Progression, Achievements & Anti-Cheat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the TypeForge gamification system with Shadow Battle's 10 combat achievements and 4 daily missions, update daily counter tracking, and implement client-side anti-cheat validation functions for event plausibility and IKI variance analysis.

---

## File Structure

**New:**
- `src/lib/shadow/antiCheat.js`
- `src/lib/shadow/antiCheat.test.js`

**Modified:**
- `src/lib/gamification.js`
- `src/lib/gamification.test.js`
- `docs/superpowers/SHADOW_BATTLE_STATUS.md`

---

### Task 1: Gamification Achievements & Daily Missions

**Files:**
- Modify: `src/lib/gamification.js`
- Modify: `src/lib/gamification.test.js`

**Objectives:**
- Add 10 Shadow Battle achievements to `ACHIEVEMENTS`.
- Add 4 Shadow daily missions to `MISSION_POOL`.
- Extend `EMPTY_DAY` with Shadow counter fields.
- Write unit tests in `gamification.test.js` verifying achievements triggers.

- [ ] **Step 1: Update `src/lib/gamification.js`**
- [ ] **Step 2: Update `src/lib/gamification.test.js`**

---

### Task 2: Anti-Cheat Validation Module

**Files:**
- Create: `src/lib/shadow/antiCheat.js`
- Create: `src/lib/shadow/antiCheat.test.js`

**Objectives:**
- Implement `minPlausibleMs`, `checkEventPlausibility`, `isIkiSynthetic`, `validateEventBatch`.
- Unit test all rules with both legitimate and synthetic typing profiles.

- [ ] **Step 1: Create `src/lib/shadow/antiCheat.js`**
- [ ] **Step 2: Create `src/lib/shadow/antiCheat.test.js`**
- [ ] **Step 3: Run `npm test` and verify full suite passes**

---

### Task 3: Status Update & Plan 7 Completion

- [ ] **Step 1: Update `docs/superpowers/SHADOW_BATTLE_STATUS.md` recording Plan 7 completion**
