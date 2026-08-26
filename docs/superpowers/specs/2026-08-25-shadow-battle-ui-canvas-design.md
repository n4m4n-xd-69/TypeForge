# Shadow Battle — Battle Screen UI & 60fps Stickman Canvas Animation (Design)

**Status:** Plan 6 of the 8-plan Shadow Battle build sequence.
**Source of truth:** `docs/08-PRD-shadow-battle.md` §14 (Fighter & Stickman System), §19 (HUD & UI Layout), §22 (UI/UX), §24 (Visual & Audio Direction), §25 (Combat Surface), §30 (Rendering Architecture).

---

## Goal

Build the complete battle screen UI, high-performance 60fps canvas-based stickman combat animation system, interactive card typing surface with fork commitment & whiff feedback, HUD meters (HP, Focus with Overdrive aura, Round pips), floating damage text, and match settlement screens for Shadow Battle.

---

## Architecture & Components

### 1. `FighterCanvas.jsx` (60fps Canvas Animation)
- **Decoupled from React:** Uses `requestAnimationFrame` loop reading directly from mutable state/refs without causing React re-renders (PRD §15.3, SB-MP-4).
- **Stickman Skeletal Rig:** Procedural multi-joint stickman figure with head, torso, upper/lower arms, hands, upper/lower legs, and feet.
- **Action State Machine:**
  - `idle`: Dynamic breathing, bobbing stance.
  - `jab`: Fast straight punch / thrust with speed lines.
  - `slash`: Wide swinging blade motion with dynamic colored trail arc.
  - `crush`: Overhead heavy leap and downward slam with ground impact dust.
  - `shuriken`: Rapid flick throw with spinning projectile.
  - `guard`: Braced defensive shield stance.
  - `parry`: Precise deflecting counter-stance with circular ripple effect.
  - `mend`: Channeled restoration glow with ascending sparks.
  - `overdrive`: Blazing full-body aura with multi-hit flurry sequence.
  - `flinch`: Stagger recoil on taking hit.
  - `knockdown`: Defeat fall animation.
- **Side-Color Rule (PRD §14.2):**
  - Left fighter (Self): `--brand` / `#6366f1` / indigo glow.
  - Right fighter (Opponent): `--accent` / `#f43f5e` / crimson-rose glow.
- **Combat FX:** Impact flashes, hitstop frame pauses, ground shockwaves, camera shake.

### 2. `CardLane.jsx` (Combat Typing Surface)
- Renders Strike card (top lane) and Guard card (bottom lane).
- **Fork Commitment:**
  - Uncommitted: Both lanes active.
  - Committed: Selected lane highlighted in high-contrast text; non-selected lane dims.
  - Whiff: Card shakes horizontally with red flash and Focus deduction indicator.
- Overdrive visual transformation when locked (golden fiery border, special typography).
- Opponent preview ghost bar (shows opponent's progress bar in real-time).

### 3. `HpBar.jsx` & `FocusBar.jsx` (Combat HUD)
- **HpBar:**
  - $1000 \to 0$ HP with split delayed ghost bar for punchy damage perception.
  - Score round pips (Best of 3: $\bullet\ \bullet$).
- **FocusBar:**
  - $0 \to 100$ meter with notch at 25 (Mend threshold) and burning aura at 100 (Overdrive ready).

### 4. `DamageFloater.jsx`
- Floating combat feedback: `-240`, `PARRY! 0`, `+3 FOCUS`, `WHIFF -3`, `+120 HP`.

### 5. `MatchSummary.jsx`
- Post-match victory/defeat modal displaying rounds won, final damage dealt/taken, best chain, WPM, accuracy, clean word rate, and Forge Rating changes.

### 6. `ShadowArena.jsx`
- Main container orchestrating input capturing (`keydown`), countdown sequence (3.5s), round timers, combat transitions, and HUD overlays.
- Supports both local Trial mode (`trialEngine.js` + `bot.js`) and live multiplayer (`useShadowRoom.js`).
