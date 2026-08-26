# Shadow Battle Battle Screen UI & 60fps Stickman Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete battle screen UI, high-performance 60fps canvas-based stickman combat animation system, interactive card typing surface with fork commitment & whiff feedback, HUD meters (HP, Focus with Overdrive aura, Round pips), floating damage text, and match settlement screens for Shadow Battle.

---

## File Structure

**New:**
- `src/modules/shadow/FighterCanvas.jsx`
- `src/modules/shadow/CardLane.jsx`
- `src/modules/shadow/HpBar.jsx`
- `src/modules/shadow/FocusBar.jsx`
- `src/modules/shadow/DamageFloater.jsx`
- `src/modules/shadow/MatchSummary.jsx`
- `src/modules/shadow/ShadowArena.jsx`
- `src/modules/shadow/ui.test.js`

**Modified:**
- `docs/superpowers/SHADOW_BATTLE_STATUS.md`

---

### Task 1: 60fps Stickman Canvas Renderer

**Files:**
- Create: `src/modules/shadow/FighterCanvas.jsx`

**Objectives:**
- Implement multi-joint stickman figure rendering with procedural poses (idle, jab, slash, crush, shuriken, guard, parry, mend, overdrive, flinch, knockdown).
- Side-color rule: P0 in `--brand`, P1 in `--accent`.
- Camera shake, hitsparks, slash trails, and ground impact dust effects.
- High-DPI canvas handling and 60fps `requestAnimationFrame` loop.

- [ ] **Step 1: Create `src/modules/shadow/FighterCanvas.jsx`**

---

### Task 2: HUD Meters, Damage Floaters & Card Lane Surface

**Files:**
- Create: `src/modules/shadow/HpBar.jsx`
- Create: `src/modules/shadow/FocusBar.jsx`
- Create: `src/modules/shadow/DamageFloater.jsx`
- Create: `src/modules/shadow/CardLane.jsx`

**Objectives:**
- `HpBar`: Delayed ghost bar damage drop and round score pips.
- `FocusBar`: Focus level, threshold notches, and pulsing Overdrive aura.
- `DamageFloater`: Floating numbers and battle callouts.
- `CardLane`: Strike & Guard lane cards with active typing cursors, fork commitment dimming, and whiff shake.

- [ ] **Step 1: Create `HpBar.jsx`, `FocusBar.jsx`, `DamageFloater.jsx`**
- [ ] **Step 2: Create `CardLane.jsx`**

---

### Task 3: Match Summary & Integrated Shadow Arena

**Files:**
- Create: `src/modules/shadow/MatchSummary.jsx`
- Create: `src/modules/shadow/ShadowArena.jsx`
- Create: `src/modules/shadow/ui.test.js`

**Objectives:**
- `MatchSummary`: Victory/defeat modal with combat stats, WPM/accuracy breakdown, and Forge Rating changes.
- `ShadowArena`: Full arena controller supporting both local Trial mode and live multiplayer duels.
- `ui.test.js`: Component rendering and combat interaction verification.

- [ ] **Step 1: Create `MatchSummary.jsx`**
- [ ] **Step 2: Create `ShadowArena.jsx`**
- [ ] **Step 3: Create `ui.test.js`**
- [ ] **Step 4: Run `npm test` and verify full suite passes**

---

### Task 4: Status Update & Plan 6 Completion

- [ ] **Step 1: Update `docs/superpowers/SHADOW_BATTLE_STATUS.md` recording Plan 6 completion**
