# Shadow Battle — Accessibility, Performance & Analytics Polish (Design)

**Status:** Plan 8 (Final Milestone) of the 8-plan Shadow Battle build sequence.
**Source of truth:** `docs/08-PRD-shadow-battle.md` §22 (UI/UX), §27 (Game State), §30 (Performance), §31 (Telemetry & Analytics).

---

## Goal

Deliver full accessibility (ARIA live announcements, high contrast, reduced-motion compliance), input latency performance measurement, and match telemetry hooks for Shadow Battle.

---

## Modules

### 1. `src/modules/shadow/CombatAnnouncer.jsx` (Accessibility)
- Screen-reader accessible live region (`aria-live="polite"` / `aria-atomic="true"`).
- Announces key combat events: Round start, heavy hits, Parry deflections, Overdrive readiness, round and match outcomes.
- Visible toggle or screen-reader-only element (`sr-only`).

### 2. `src/lib/shadow/telemetry.js` (Performance & Analytics)
- Captures input-to-render latency metrics ($p_{95} \le 16\text{ms}, p_{99} \le 33\text{ms}$).
- Tracks match lifecycle events (`shadow_match_start`, `shadow_match_complete`, `shadow_forfeit`).
- Tracks bot difficulty preferences and cosmetic selections.

### 3. Reduced Motion Support in `FighterCanvas.jsx`
- Honors `window.matchMedia('(prefers-reduced-motion: reduce)')`.
- Automatically suppresses screen shake and heavy particle bursts when reduced motion is preferred.

---

## Verification Plan
- `polish.test.js`: Test announcer event formatting, telemetry aggregation, reduced motion detection, and latency quantile calculations.
- Full workspace test suite verification (`npm test`).
