# Shadow Battle Accessibility, Performance & Analytics Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver full accessibility (ARIA live announcements, reduced-motion compliance), input latency performance measurement, and match telemetry hooks for Shadow Battle.

---

## File Structure

**New:**
- `src/modules/shadow/CombatAnnouncer.jsx`
- `src/lib/shadow/telemetry.js`
- `src/lib/shadow/polish.test.js`

**Modified:**
- `src/modules/shadow/FighterCanvas.jsx`
- `src/modules/shadow/ShadowArena.jsx`
- `docs/superpowers/SHADOW_BATTLE_STATUS.md`

---

### Task 1: Accessibility Live Announcer & Reduced Motion

**Files:**
- Create: `src/modules/shadow/CombatAnnouncer.jsx`
- Modify: `src/modules/shadow/FighterCanvas.jsx`
- Modify: `src/modules/shadow/ShadowArena.jsx`

**Objectives:**
- Implement `CombatAnnouncer` with `aria-live="polite"` for combat events.
- Integrate reduced motion checks in `FighterCanvas.jsx` to disable camera shake.
- Integrate announcer into `ShadowArena.jsx`.

- [ ] **Step 1: Create `src/modules/shadow/CombatAnnouncer.jsx`**
- [ ] **Step 2: Update `src/modules/shadow/FighterCanvas.jsx` with prefers-reduced-motion check**
- [ ] **Step 3: Update `src/modules/shadow/ShadowArena.jsx` to include announcer**

---

### Task 2: Performance Telemetry & Polish Tests

**Files:**
- Create: `src/lib/shadow/telemetry.js`
- Create: `src/lib/shadow/polish.test.js`

**Objectives:**
- Implement latency measurement utilities ($p_{95}, p_{99}$) and combat analytics event emission.
- Write tests in `polish.test.js` covering accessibility announcer, telemetry calculations, and reduced motion flags.

- [ ] **Step 1: Create `src/lib/shadow/telemetry.js`**
- [ ] **Step 2: Create `src/lib/shadow/polish.test.js`**
- [ ] **Step 3: Run `npm test` and verify full suite passes**

---

### Task 3: Final Wrap-up & Project Milestone Completion

- [ ] **Step 1: Update `docs/superpowers/SHADOW_BATTLE_STATUS.md` recording all 8 plans complete!**
