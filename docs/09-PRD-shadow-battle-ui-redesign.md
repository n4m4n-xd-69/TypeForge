# Shadow Battle UI Redesign — Product Requirements Document

**Version:** 2.0  
**Date:** 2026-08-25  
**Status:** Design complete · awaiting approval  
**Supersedes:** Original Shadow Battle UI (Plans 6 + 8 of the `08-PRD-shadow-battle.md`)  
**Audience:** product design · frontend · QA  

---

## 1. Problem Statement

The current Shadow Battle UI has several critical issues:

1. **Not full-screen** — the arena renders inside a constrained `max-w-4xl` container with padding, wasting screen estate and breaking immersion.
2. **Words are below the fighters** — the typing cards sit at the bottom, disconnected from the combat action. Words should appear *above* the characters like speech/action bubbles.
3. **Hardcoded dark theme** — `bg-zinc-950`, `bg-black/50`, `text-white/40` bypass the design system. In light mode, the arena is a jarring black box.
4. **No network status indicator** — Battlefield shows `Live` / `Reconnecting` with `Wifi` / `WifiOff` icons. Shadow Battle shows nothing.
5. **Bot matches require network** — the current ShadowHub calls `ensureAccount()` for Trial Mode, but bot play should work entirely offline.
6. **Visual mismatch with Battlefield** — Battlefield uses the project's `Card`, `Chip`, `ProgressBar`, `Avatar`, `Reveal`, `Counter`, `Confetti` component library and CSS tokens (`bg-bg`, `text-ink`, `border-line`). Shadow Battle uses raw Tailwind with custom colors.
7. **Keyboard response not optimized** — `handlePlayerKey` runs through React state updates before visual feedback appears. The typing input loop should be decoupled from React's reconciliation.

---

## 2. Design Principles

Inherited from Battlefield (`src/modules/battle/`) and the TypeForge design system:

| Principle | Battlefield Reference | Shadow Battle Application |
|---|---|---|
| **Use design tokens, not raw colors** | `text-ink`, `bg-surface`, `border-line` everywhere | Replace all `bg-zinc-*`, `bg-black/*`, `text-white/*` with token classes |
| **Theme follows system** | Battlefield renders correctly in both light and dark | Arena bg adapts: dark → `bg-bg` (near-black), light → `bg-bg` (warm-neutral) |
| **Card + Chip + ProgressBar** | `RaceView.jsx` uses `Card`, `Chip`, `ProgressBar` for the typing surface and race track | HUD panels, HP bars, Focus bars, Card Lane cards all use `Card` |
| **Connection status is always visible** | `RaceView.jsx` line 142–149: `Wifi`/`WifiOff` + `Live`/`Reconnecting` | Top-right of arena HUD shows same indicator + ping latency |
| **Compact header readout** | `LiveStats compact` shows WPM, accuracy in a chip bar | Shadow arena HUD shows round, timer, WPM, accuracy in the same compact format |
| **Counter for animated numbers** | `ResultsView.jsx` uses `<Counter>` for podium WPM | Match Summary uses `<Counter>` for damage dealt, WPM, accuracy |
| **Confetti on victory** | `ResultsView.jsx` fires `<Confetti>` on top-3 finish | Shadow Battle fires confetti on match win |
| **Reveal for staggered entrance** | Every section in Battlefield uses `<Reveal>` with `delay` | Hub cards, lobby, and results all use `Reveal` |

---

## 3. Requirements

### 3.1 Full-Screen Immersive Arena (SBR-FS)

> [!IMPORTANT]
> When the arena is active (countdown, combat, round-end), the game occupies the **full viewport** — no navbar, no sidebar, no page margins.

| ID | Requirement | Priority |
|---|---|---|
| SBR-FS-1 | When phase enters `countdown`, `active`, or `round_end`, mount a `position: fixed; inset: 0; z-index: 50` overlay that covers the entire viewport. | P0 |
| SBR-FS-2 | Provide an **ESC** key and a small X button (top-left) to exit full-screen back to the hub. | P0 |
| SBR-FS-3 | The full-screen container uses `bg-bg` so it inherits the current theme. | P0 |
| SBR-FS-4 | The `FighterCanvas` resizes to fill the available horizontal space (min 800px, max viewport width minus HUD padding). Height scales proportionally at 9:16 or uses `min(45vh, 400px)`. | P0 |
| SBR-FS-5 | All HUD elements (HP bars, Focus bars, Round/Timer, Card Lane) are positioned with CSS grid inside the full-screen overlay. | P0 |

**Layout wireframe (portrait of the full-screen arena):**

```
┌─────────────────────────────────────────────────────────────────┐
│ [X Exit]                    ROUND 1 · 87s              [🟢 Live 23ms] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ Player HP ──────────┐              ┌─ Opponent HP ────────┐ │
│  │ ████████████░░░░░ 780│              │ ░░░████████████░ 650 │ │
│  │ Focus: ██████░ 64    │              │ Focus: ████░░░ 42    │ │
│  └──────────────────────┘              └──────────────────────┘ │
│                                                                 │
│         ┌── SLASH ──┐          ┌── GUARD ──┐                    │
│         │ "dragon"  │          │ "shield"  │                    │
│         └───────────┘          └───────────┘                    │
│              ↕ Words float above characters                     │
│                                                                 │
│     🧍‍♂️ ─────────── ARENA CANVAS ─────────── 🧍‍♂️              │
│     (Player)                              (Opponent)            │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  WPM: 72 · Accuracy: 96% · Chain: 5x · Clean: 94%             │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Words-Above-Characters (SBR-WAC)

> [!IMPORTANT]
> The typing cards (Strike + Guard) render as floating word bubbles **above the player's stickman character**, not in a bottom panel.

| ID | Requirement | Priority |
|---|---|---|
| SBR-WAC-1 | Two word cards float above the player character (left side of canvas). Strike card on the left, Guard card on the right, connected by a subtle "choice fork" divider. | P0 |
| SBR-WAC-2 | Each card shows the **move name badge** (e.g., `SLASH`, `GUARD`, `PARRY`, `MEND`) and the **word to type** in large monospace font. | P0 |
| SBR-WAC-3 | Typing the first character commits to that lane. The uncommitted card fades to `opacity-20` and scales to `scale-90`. The committed card gets a glowing border (`ring-2 ring-brand` for strike, `ring-2 ring-accent` for guard). | P0 |
| SBR-WAC-4 | Character-by-character progress is shown with the typed portion in `text-good` (green), the active cursor character highlighted with `bg-brand/20 rounded`, and remaining characters in `text-ink-3`. | P0 |
| SBR-WAC-5 | On card completion, the word bubble does a brief "burst" animation (scale 1.1 → 1.0 with a flash) and a new card pair spawns. | P1 |
| SBR-WAC-6 | Overdrive card replaces both cards with a single, larger, golden-glowing card spanning the full width above the character. | P0 |
| SBR-WAC-7 | Opponent's current word card appears as a **ghost bubble** above the opponent character — showing the move name badge but with the word obscured (dots or blur), and a small progress bar. | P1 |

### 3.3 Theme-Aware Rendering (SBR-TH)

> [!IMPORTANT]
> Every Shadow Battle surface respects the theme system. If the user's theme is light, backgrounds are light. If dark, backgrounds are dark.

| ID | Requirement | Priority |
|---|---|---|
| SBR-TH-1 | Replace all hardcoded `bg-zinc-*`, `bg-black/*`, `text-white/*` classes with design-system tokens: `bg-bg`, `bg-surface`, `bg-raised`, `text-ink`, `text-ink-2`, `text-ink-3`, `border-line`, `border-line-strong`. | P0 |
| SBR-TH-2 | The `FighterCanvas` reads CSS custom properties from the document root and uses them for background clear color, fighter colors, and effect colors. | P0 |
| SBR-TH-3 | The canvas background is transparent (`clearRect` to transparent), and the container `div` provides the background via `bg-bg` or `bg-surface`. | P0 |
| SBR-TH-4 | Fighter colors remain fixed: Player = `--brand` token, Opponent = `--accent` token. These are theme-aware by definition (orange in dark, deep-orange in light for brand; steel-blue in dark, deep-blue in light for accent). | P0 |
| SBR-TH-5 | HP bar, Focus bar, damage floaters, and match summary use `bg-surface`, `border-line`, `text-ink` tokens — not raw colors. | P0 |
| SBR-TH-6 | Light theme arena floor: a subtle gradient from `bg-bg` to `bg-surface`. Dark theme arena floor: the existing near-black. Canvas draws a thin floor line in `--line-strong` color. | P1 |

### 3.4 Network Status & Ping Display (SBR-NET)

> [!IMPORTANT]
> A persistent network indicator shows server connectivity and latency.

| ID | Requirement | Priority |
|---|---|---|
| SBR-NET-1 | Top-right of the arena HUD shows a connection chip: `🟢 Live 23ms` (good, <50ms), `🟡 Slow 142ms` (warn, 50–200ms), `🔴 Offline` (no connection). | P0 |
| SBR-NET-2 | Ping is measured using the existing `clock.js` NTP offset mechanism. Display `Math.round(rtt / 2)` as the one-way estimate. | P0 |
| SBR-NET-3 | In Trial Mode (offline bot play), the indicator shows `⚡ Local` with no ping value, in `text-ink-3` to indicate it's not relevant. | P0 |
| SBR-NET-4 | When connection drops during a PvP match, overlay a translucent `bg-bg/80 backdrop-blur` layer with `WifiOff` icon and "Reconnecting…" text. Auto-resume when connection restores. | P0 |
| SBR-NET-5 | The Battlefield reference pattern: `<Wifi size={12} />` / `<WifiOff size={12} />` with `text-good` / `text-warn` coloring. Shadow Battle follows the same iconography and palette. | P0 |

### 3.5 Offline Bot Play (SBR-OFF)

> [!IMPORTANT]
> Single-player Trial Mode works fully offline with zero network calls.

| ID | Requirement | Priority |
|---|---|---|
| SBR-OFF-1 | The "Enter Arena (Trial Duel)" button in ShadowHub does NOT call `ensureAccount()`. It launches the arena immediately with the selected bot profile. | P0 |
| SBR-OFF-2 | All Trial Mode logic (combat reducer, word queue, bot simulation, session scoring) runs entirely in the browser with zero network dependencies. | P0 |
| SBR-OFF-3 | Trial Mode results are saved to `localStorage` via the existing `recordSession()` call, so they persist without a network. | P0 |
| SBR-OFF-4 | If the user IS authenticated when playing Trial Mode, results are also synced to the cloud profile as usual. The mode degrades gracefully. | P1 |
| SBR-OFF-5 | The ShadowHub page renders without authentication. The "Ranked 1v1" and "Custom Duel" tabs show a "Sign in to play online" prompt, but Trial Mode is always accessible. | P0 |

### 3.6 Fast Keyboard Response (SBR-KEY)

> [!IMPORTANT]
> Keystroke-to-visual-feedback latency must be ≤ 1 frame (16ms). Typing input is decoupled from React's reconciliation cycle.

| ID | Requirement | Priority |
|---|---|---|
| SBR-KEY-1 | The word card's character spans are updated via direct DOM manipulation (like `RaceTrack.jsx` does for lane positions), not React state. A `ref` points to each character `<span>`, and `onKeyDown` updates `className` / `textContent` directly. | P0 |
| SBR-KEY-2 | The `onKeyDown` handler is attached to `window` and runs synchronously. It does NOT call `setState` for typing progress. State updates for combat resolution (HP changes, card transitions) are batched and deferred via `requestAnimationFrame`. | P0 |
| SBR-KEY-3 | The canvas animation loop runs on its own `requestAnimationFrame` cycle, reading from mutable refs, never from React state. (This already exists in `FighterCanvas.jsx` — preserve it.) | P0 |
| SBR-KEY-4 | Measure input-to-render latency with the existing `telemetry.js` profiler. Assert `p95 ≤ 16ms` in the test suite. | P0 |
| SBR-KEY-5 | Use `event.preventDefault()` only on printable characters and Backspace during active combat. Do not interfere with browser shortcuts (Ctrl+C, Ctrl+V, F5, etc.). | P0 |

### 3.7 Combat Animation & VFX Polish (SBR-VFX)

| ID | Requirement | Priority |
|---|---|---|
| SBR-VFX-1 | On a successful strike, the opponent stickman plays a "flinch" animation AND a damage number floats upward from the opponent in `text-bad` (red) using the existing `DamageFloater`. | P0 |
| SBR-VFX-2 | On a successful parry, blue shield particles burst at the defender's position and a deflected damage number floats in `text-accent` (steel-blue). | P0 |
| SBR-VFX-3 | On Overdrive activation (100 Focus reached), a full-screen golden flash (`bg-warn/20`) pulses once, the word card gets a persistent golden glow, and the player stickman gets a subtle aura. | P1 |
| SBR-VFX-4 | On Overdrive completion, massive camera shake (12px), large hitsparks, and a "DEVASTATING!" text floater in `text-warn` (gold). | P1 |
| SBR-VFX-5 | Chain multiplier indicator: a small `x3`, `x4`, `x5` chip appears next to the player's HP bar, growing in size and brightness with each consecutive clean word. Resets to nothing on a miss. | P1 |
| SBR-VFX-6 | All camera shake and particle effects respect `prefers-reduced-motion` (already implemented — preserve). | P0 |

### 3.8 Redesigned Hub & Lobby (SBR-HUB)

> [!IMPORTANT]
> The ShadowHub and ShadowRoom pages are rebuilt using Battlefield's component library and layout patterns.

| ID | Requirement | Priority |
|---|---|---|
| SBR-HUB-1 | ShadowHub uses the same two-column layout as `BattleRoom.jsx` Lobby: left column for game settings / mode selection, right column for player roster / bot info. | P0 |
| SBR-HUB-2 | Bot selection uses `Card` with `Avatar`-style bot icons, not plain buttons. Each bot card shows name, WPM, accuracy, and a difficulty badge via `<Chip>`. | P0 |
| SBR-HUB-3 | The Ranked 1v1 queue card uses the same `Card` + `ProgressBar` pattern as Battlefield's lobby. Show estimated wait time and current rating with `<Counter>`. | P0 |
| SBR-HUB-4 | Custom Duel room code display: same `font-mono text-4xl font-bold tracking-[0.18em]` pattern as `BattleRoom.jsx` line 205. Copy button with `Check`/`Copy` toggle. | P0 |
| SBR-HUB-5 | The ShadowRoom lobby shows a `<Row>` component for room metadata (Players, Round Format, Band, Connection) matching Battlefield's `<Row>` helper. | P0 |
| SBR-HUB-6 | The Match Summary / Results screen follows `ResultsView.jsx` patterns: podium with medals, animated `<Counter>`, stat cards, "Play again" / "Leave" buttons, and `<Confetti>` on victory. | P0 |

### 3.9 Redesigned Match Summary (SBR-RES)

| ID | Requirement | Priority |
|---|---|---|
| SBR-RES-1 | After a best-of-3 match concludes, show a full-screen results overlay (not a modal). | P0 |
| SBR-RES-2 | Header: "Victory" / "Defeat" / "Draw" with the same `headline()` pattern from `ResultsView.jsx`. | P0 |
| SBR-RES-3 | Stats grid (4 columns): Damage Dealt, WPM, Accuracy, Clean Rate — each in a `Card` with `<Counter>` animated numbers. | P0 |
| SBR-RES-4 | Round-by-round breakdown: a mini table showing HP remaining, moves used, and outcome per round. | P1 |
| SBR-RES-5 | "Play Again" (primary) and "Back to Hub" (ghost) buttons at the bottom. | P0 |
| SBR-RES-6 | Fire `<Confetti>` on match victory. | P0 |

---

## 4. Files to Modify

### Components to Rewrite

| File | Scope |
|---|---|
| [ShadowArena.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/ShadowArena.jsx) | Full rewrite: full-screen overlay, words-above-character layout, theme tokens, network indicator, fast key handling |
| [CardLane.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/CardLane.jsx) | Full rewrite: floating word bubbles above character, direct DOM updates, fork commitment visualization |
| [HpBar.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/HpBar.jsx) | Rewrite with design tokens: `Card`, `ProgressBar`, theme-aware colors |
| [FocusBar.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/FocusBar.jsx) | Rewrite with design tokens |
| [DamageFloater.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/DamageFloater.jsx) | Update: use `text-bad`, `text-warn`, `text-accent` tokens |
| [MatchSummary.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/MatchSummary.jsx) | Full rewrite: follow `ResultsView.jsx` patterns, add `Counter`, `Confetti`, stat cards |
| [FighterCanvas.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/FighterCanvas.jsx) | Update: read CSS custom properties for colors, transparent background, responsive sizing |
| [ShadowHub.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/ShadowHub.jsx) | Redesign: Battlefield-aligned layout, offline trial mode, proper component library usage |
| [ShadowRoom.jsx](file:///c:/Users/V3X0R/ZPROJECTs/X1/Key%20Stroke/src/modules/shadow/ShadowRoom.jsx) | Redesign: follow `BattleRoom.jsx` patterns for lobby, roster, code sharing |

### New Components

| File | Purpose |
|---|---|
| `src/modules/shadow/NetworkIndicator.jsx` | `[NEW]` Reusable connection status chip with ping display |
| `src/modules/shadow/WordBubble.jsx` | `[NEW]` Single floating word card with direct DOM character updates |
| `src/modules/shadow/ChainIndicator.jsx` | `[NEW]` Chain multiplier badge (x2, x3, x4...) |

### Files NOT Modified

| File | Reason |
|---|---|
| All `src/lib/shadow/*.js` engine files | Combat logic is correct; only the UI layer is redesigned |
| `src/lib/shadow/trialEngine.js` | Engine is correct |
| `src/lib/shadow/bot.js` | Bot profiles are correct |
| `supabase/migrations/0010_shadow_battle.sql` | Backend schema is correct |
| `src/lib/shadow/antiCheat.js` | Anti-cheat validation is correct |
| `src/lib/shadow/telemetry.js` | Telemetry is correct |

---

## 5. CSS Token Mapping

Current hardcoded values → design token replacements:

| Current | Replace With | Notes |
|---|---|---|
| `bg-zinc-950/90` | `bg-bg` | Arena background |
| `bg-black/50` | `bg-surface/50` | Card backgrounds |
| `bg-black/40` | `bg-bg/40` | Overlays |
| `bg-black/60` | `bg-bg/60` | Round-end overlay |
| `text-white` | `text-ink` | Primary text |
| `text-white/90` | `text-ink` | Player name |
| `text-white/50` | `text-ink-3` | Secondary labels |
| `text-white/40` | `text-ink-3` | Tertiary labels |
| `border-white/10` | `border-line` | Card borders |
| `border-white/15` | `border-line` | HP bar borders |
| `border-white/20` | `border-line-strong` | Stronger borders |
| `bg-indigo-500` | `bg-brand-solid` | Player color |
| `bg-rose-500` | Uses `--accent` CSS var | Opponent color |
| `text-indigo-400` | `text-brand` | Player accent text |
| `text-rose-400` | `text-accent` | Opponent accent text |
| `bg-amber-500` | `bg-warn` | Overdrive / gold elements |
| `text-emerald-400` | `text-good` | Correct typed characters |
| `text-sky-300` | `text-accent` | Guard lane accent |

---

## 6. Verification Plan

### Automated Tests
```bash
npm test                # All 281 tests must remain green
npm run build           # Zero bundle errors
```

### Manual Verification
1. **Theme switching:** Toggle light/dark while in the arena — background, text, bars, canvas all adapt.
2. **Full-screen:** Arena covers entire viewport during combat. ESC returns to hub.
3. **Words above characters:** Strike and Guard words float above the player stickman.
4. **Keyboard response:** Type rapidly (>100 WPM) — characters appear with zero perceived delay.
5. **Network indicator:** Shows `⚡ Local` in Trial Mode, `🟢 Live Xms` in PvP.
6. **Offline bot play:** Disconnect network, navigate to `/shadow`, select a bot, play a full match — everything works.
7. **Match summary:** Shows animated stats, confetti on win, play-again button.
8. **Battlefield parity:** Compare `/battle/:pin` lobby with `/shadow/:pin` lobby — same visual language.
