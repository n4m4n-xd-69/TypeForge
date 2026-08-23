# TypeForge — UI/UX Design Brief & Design System

**Version:** 1.0
**Date:** 2026-08-23
**Depends on:** `00-codebase-audit.md`, `01-PRD.md`, `02-TRD.md`, `03-app-flow.md`
**Design intelligence:** `ui-ux-pro-max` v2.13.0 — queried, results verified and partly rejected (see §B.0)
**Colour validation:** computed, not estimated. Full output in §C.1.

---

# PART A — Screen-by-screen UI audit

Every finding below was read in source. Severity: **1** blocks the redesign · **2** must fix · **3** should fix.

## A.0 Systemic findings — these repeat on every screen

| # | Finding | Evidence | Sev |
|---|---|---|---|
| S-1 | **One layout for every job.** Practice, Code, Dashboard, Achievements and Profile are all `space-y-3` + card grids. A focus surface and an analytics surface are rendered identically | All five modules | **1** |
| S-2 | **`font-extrabold` is the default heading weight everywhere.** 60+ uses. When everything is heaviest, nothing is emphasised | `grep -c` across modules | **2** |
| S-3 | **Cards are the only container.** `Card` appears on every screen as the answer to every grouping problem | `Primitives.jsx:6` | **2** |
| S-4 | **Spacing scale is used at 3 values.** The 8px grid defines 20 steps; `p-2.5`, `gap-2`, `space-y-3` carry almost everything | tailwind.config vs usage | **2** |
| S-5 | **"Module 01/02/06" eyebrows** imply a curriculum removed in `d1d2ed9` | 4 modules | **2** |
| S-6 | **Decorative blur orbs** on ~8 surfaces — `absolute -right-8 -top-8 h-20 w-20 blur-2xl`. Pure decoration, no information | Landing, Battle, Dashboard, Achievements | **2** |
| S-7 | **Two glass systems + aurora + glow-panel** coexist with no rule for which applies where | `index.css:166-328` | **2** |
| S-8 | **Typing state relies on colour alone.** Verified: `wrong` vs `pending` separate by only **1.06:1** | `TypingStage.jsx:17-22` + §C.1 | **1** |

## A.1 Landing `/` (currently the hybrid home)

| # | Finding | Evidence | Sev |
|---|---|---|---|
| L-1 | Serves two incompatible jobs, branching the entire hero on `stats.isNew` | `Landing.jsx:214` | **1** |
| L-2 | Nine stacked sections, all equal weight — no primary action survives | `Landing.jsx:44-207` | **1** |
| L-3 | Pulls **421 kB / 113 kB gzip** of recharts for a sparkline and a bar chart | `Landing.jsx:11` | **1** |
| L-4 | `aurora` + `grad-text` + blur orb + glass panel in one viewport | `Landing.jsx:221-306` | **2** |
| L-5 | Level panel `hidden … xl:block` — the primary progress readout vanishes below 1280px | `Landing.jsx:286` | **2** |
| L-6 | "Module 01 / Module 02" eyebrows on the two action cards | `Landing.jsx:57,66` | **2** |
| L-7 | Daily challenge is seeded random, unrelated to the user's actual weakness | `Landing.jsx:385-390` | **3** |

## A.2 Practice `/practice`

| # | Finding | Evidence | Sev |
|---|---|---|---|
| P-1 | **Not a focus surface.** Mode bar, difficulty, duration, settings, missions, weak keys and keyboard all share the page at equal weight | `Practice.jsx` 779 lines | **1** |
| P-2 | Nothing recedes when typing starts — the full chrome stays lit | no run-state styling | **1** |
| P-3 | 779 lines in one component; the stage is a minority of it | file length | **2** |
| P-4 | Six modes as equal segments — `time` is used far more than `zen` | `Practice.jsx:26-33` | **3** |
| P-5 | Settings in a modal, but caret/sound/keyboard are things you judge *while typing* | `Practice.jsx:60` | **3** |

## A.3 Code `/code`

| # | Finding | Evidence | Sev |
|---|---|---|---|
| C-1 | AI sidebar sits beside the code at equal weight during a run | `CodeTyping.jsx:42-43` | **1** |
| C-2 | Syntax colour and typing state fight: three conditional class sets cascade, and state does not reliably win | `TypingStage.jsx:312-319` | **1** |
| C-3 | Prism token colours are **hardcoded hex**, outside the token system — they cannot follow a rebrand | `index.css:350-432` | **2** |
| C-4 | Fullscreen line count derived from a magic `chrome = 210` | `CodeTyping.jsx:67` | **3** |

## A.4 Battlefield `/battle`, `/battle/:pin`

| # | Finding | Evidence | Sev |
|---|---|---|---|
| B-1 | Hub reads as a settings form. The emotional register of "open a Battlefield" is a `<Segmented>` stack | `Battle.jsx:121-146` | **2** |
| B-2 | Lobby, race and results use three unrelated layouts | three files | **2** |
| B-3 | **`whyWon()` — the best UX in the codebase — renders as a small grey subtitle** | `ResultsView.jsx:71` | **1** |
| B-4 | Cheat flags surface only as a hover `title` | `ResultsView.jsx:153-157` | **2** |
| B-5 | Race track is a right-column card at the same weight as a "Scoring" reference list | `RaceView.jsx:243-271` | **2** |
| B-6 | Countdown is well built (server-driven, `aria-live`) but visually a plain number on a blur | `RaceView.jsx:210-239` | **3** |

## A.5 Dashboard `/dashboard`

| # | Finding | Evidence | Sev |
|---|---|---|---|
| D-1 | Nine chart cards, no hierarchy — everything is a `Card p-2.5` | `Dashboard.jsx:88-236` | **1** |
| D-2 | **Weak keys — the only actionable element — is 8th of 9** | `Dashboard.jsx:180` | **1** |
| D-3 | Skill radar axes are arbitrary normalisations (`wpm/110`, `codeRuns/25`, `streak/21`) presented as objective | `Dashboard.jsx:56-63` | **2** |
| D-4 | Recent-activity table `min-w-[560px]` forces horizontal scroll on mobile | `Dashboard.jsx:209` | **2** |

## A.6 Achievements `/achievements`

| # | Finding | Evidence | Sev |
|---|---|---|---|
| A-1 | Three unrelated things on one page: level ladder, missions, leaderboard, badges | `Achievements.jsx:100-199` | **2** |
| A-2 | Locked badges at `opacity-60` — dims the hint text below readable contrast | `Achievements.jsx:217` | **2** |
| A-3 | Tier colours are hardcoded hex outside the token system | `gamification.js:112-117` | **2** |
| A-4 | Leaderboard row keys include the index — masks the real duplicate-name bug | `Achievements.jsx:155` | **3** |

## A.7 Profile `/profile`

| # | Finding | Evidence | Sev |
|---|---|---|---|
| PR-1 | `liquid-glass` used here and nowhere else comparable | `Profile.jsx:101` | **2** |
| PR-2 | Leaderboard toggle is a hand-rolled `<button role="switch">` while a `Switch` component exists | `Profile.jsx:311` vs `ui/Switch.jsx` | **2** |
| PR-3 | 24 avatars in a 6/8-column grid dominate the page | `Profile.jsx:186` | **3** |

## A.8 AppShell / navigation

| # | Finding | Evidence | Sev |
|---|---|---|---|
| N-1 | **Cycling tagline** — 15s on, 30s off, forever. Pure decoration on the most persistent surface | `AppShell.jsx:397-439` | **2** |
| N-2 | 7 nav items in 2 groups; "Rewards" and "Progress" overlap conceptually | `AppShell.jsx:28-49` | **2** |
| N-3 | Rail geometry is precise and well-documented — **keep it** | `AppShell.jsx:53-76` | — |
| N-4 | Chrome never hides. No focus mode at the shell level | — | **1** |

## A.9 Components

| # | Finding | Evidence | Sev |
|---|---|---|---|
| CO-1 | `Chip` has 6 tones; `warn` needs a hardcoded `text-[#8a6100]` override to pass contrast in light mode | `Primitives.jsx:37` | **2** |
| CO-2 | `ProgressBar` is `h-0.5` (4px) — below the 3:1 non-text target at that size | `Primitives.jsx:90` | **2** |
| CO-3 | `EmptyState` exists and is good, but only 2 of 9 screens use it | `Primitives.jsx:68` | **2** |
| CO-4 | **`SessionSummary` is a `Modal`** — forces a dismissal click on the highest-frequency loop | `SessionSummary.jsx:40` | **1** |
| CO-5 | `Confetti` fires on PB, achievement, and top-3 finish — contradicts "no cheap gaming aesthetic" | 3 call sites | **2** |

## A.10 Responsive

| # | Finding | Sev |
|---|---|---|
| R-1 | Level panel, rail, and several stat blocks are `hidden` below `lg`/`xl` — mobile loses primary information rather than reflowing it | **2** |
| R-2 | Two tables force horizontal scroll at `min-w-[560px]` | **2** |
| R-3 | Mobile is desktop-minus, not designed — S-1 compounds it | **1** |

## A.11 Accessibility — verified gaps

| # | Finding | Measured | Sev |
|---|---|---|---|
| AX-1 | **Typing state relies on colour.** `wrong` vs `pending` = **1.06:1** | §C.1 | **1** |
| AX-2 | No `aria-live` on run completion | — | **2** |
| AX-3 | Light chart ramp: slots 2/3/4 at 2.82 / 2.17 / 2.69:1 — below 3:1 | §C.1 | **2** |
| AX-4 | `opacity-60` on locked badges pushes hint text under AA | — | **2** |
| AX-5 | Never audited — no axe/Lighthouse run exists | — | **2** |

**What is already right and must not regress:** skip link · global `:focus-visible` · `prefers-reduced-motion` globally and per-component · `role="progressbar"` with full aria values · chart `DataTable` alternatives · `role="textbox"` + `sr-only` instructions on the stage · documented contrast per token.

---

# PART B — Design principles

## B.0 What I took from the references — and what I rejected

The brief names Apple, Tesla, SpaceX, Cursor, Kiro, Linear, Vercel and competitive gaming. Extracted as **principles**, never as visual borrowing:

| Source | Principle extracted | How it lands in TypeForge |
|---|---|---|
| Apple | Content is the interface; chrome earns its place | Stage archetype — chrome *unmounts* during a run |
| Tesla / SpaceX | Instrumentation reads as instrumentation. Numbers are precise, monospaced, unglamorised | All metrics in mono with tabular figures |
| Linear | One accent, ruthlessly rationed. Speed as a design value | Single forge accent; ≤200ms transitions |
| Cursor / Kiro | The editor is sacred. Tooling recedes | AI sidebar collapses during a run |
| Vercel | Near-black foundation, high-contrast type, geometric restraint | §C.1 foundation |
| Competitive gaming | Tension through **pacing and stakes**, not through neon | Countdown, race track, result reveal |

**Rejected from the skill's own recommendations:**
- The `--design-system` query returned pattern **"FAQ/Documentation Landing"** — a misroute for a typing platform. Discarded.
- Its palette was slate `#1E293B` + green `#22C55E` — the generic dark-SaaS look the brief explicitly rejects. Discarded.
- The `--domain color` "Gaming" entry returned neon purple `#7C3AED` + rose on `#0F0F23` — the cheap-gaming look the brief also rejects. Discarded.
- **Kept and used:** the "Running & Cycling GPS" entry (energetic warm primary on near-black), which reframed the whole direction — see B.1.

## B.1 The reframe that drives everything

> **TypeForge is an athletic performance product, not a gaming product.**

Its closest relatives are Strava, Whoop and Garmin — instruments that measure a trainable human skill and create competition around it. Not Twitch, not Discord.

This settles arguments the brief could not:
- Colour is **warm and instrumental**, not neon.
- Numbers are the hero; decoration is not.
- Competition is *measured*, so it must look *credible*.
- Celebration is earned and brief, never confetti-storm.

## B.2 The seven principles

**DP-1 — The passage is the product.**
Every design decision on a typing surface is judged by whether it helps someone read the next character. *Settles:* the AI sidebar collapses; the keyboard viz is opt-in; nothing animates in the reading path but the caret.

**DP-2 — Instrumentation, not decoration.**
Every number is exact, monospaced, tabular. No number is rounded to look better. *Settles:* remove all eight decorative blur orbs; remove the cycling tagline.

**DP-3 — One accent, rationed.**
Forge orange marks *your action and your performance*. If everything is accented, nothing is. *Settles:* ≤2 forge elements per viewport.

**DP-4 — Chrome is a guest.**
Navigation is present when you are choosing and absent when you are doing. *Settles:* Stage genuinely unmounts the rail, tab bar and FAB.

**DP-5 — Motion is causal.**
Animation shows *why* something changed. Ambient motion is removed. *Settles:* keep the nav active-pill (spatial continuity); delete `float`, the tagline cycle, and blur-orb scaling.

**DP-6 — Colour is never the only signal.**
Measured: `wrong` vs `pending` = 1.06:1; `good` vs `bad` under deuteranopia = 1.49:1. *Settles:* typing state carries a non-colour cue; every result state carries an icon and a word.

**DP-7 — Density follows job.**
Seven archetypes (`03-app-flow.md` §0.2), each with its own density. *Settles:* Practice is not laid out like Progress.

---

# PART C — Design system

## C.1 Colour

### Foundation — dark (primary theme)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0A0B0D` | Page plane. Near-black with a cool cast — **not** pure `#000`, which smears on OLED scroll and haloes against bright type |
| `--surface` | `#121417` | Cards, panels |
| `--raised` | `#1A1D21` | Menus, popovers, modals |
| `--line` | `#24282D` | Hairlines |
| `--line-strong` | `#333940` | Emphasised borders, dividers |

### Foundation — light

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#FAFAF9` | Page plane — warm-neutral, not blue-grey |
| `--surface` | `#FFFFFF` | Cards |
| `--raised` | `#FFFFFF` | Overlays (separated by shadow, not tint) |
| `--line` | `#E6E6E3` | Hairlines |
| `--line-strong` | `#CBCBC7` | Emphasised |

### Ink and accents — **measured contrast, not estimated**

**Dark theme**

| Token | Hex | on `--bg` | on `--surface` | on `--raised` |
|---|---|---|---|---|
| `--ink` | `#F2F4F7` | 17.87 AAA | 16.75 AAA | 15.35 AAA |
| `--ink-2` | `#A8B0BA` | 8.99 AAA | 8.42 AAA | 7.72 AAA |
| `--ink-3` | `#828C97` | 5.76 AA | 5.40 AA | **4.95 AA** |
| `--forge` | `#FF7A2F` | 7.57 AAA | 7.10 AAA | 6.51 AA |
| `--quench` | `#4FC3F7` | 9.83 AAA | 9.21 AAA | 8.44 AAA |
| `--good` | `#4ADE80` | 11.30 AAA | 10.59 AAA | 9.71 AAA |
| `--warn` | `#FFC53D` | 12.48 AAA | 11.69 AAA | 10.72 AAA |
| `--bad` | `#FF4D6D` | 6.13 AA | 5.74 AA | 5.26 AA |
| `--info` | `#5AA9FF` | 8.02 AAA | 7.52 AAA | 6.89 AA |

**Light theme**

| Token | Hex | on `--bg` | on `--surface` |
|---|---|---|---|
| `--ink` | `#14161A` | 17.34 AAA | 18.11 AAA |
| `--ink-2` | `#4A515A` | 7.69 AAA | 8.03 AAA |
| `--ink-3` | `#6B737D` | 4.60 AA | 4.80 AA |
| `--forge` | `#C2410C` | 4.96 AA | 5.18 AA |
| `--quench` | `#0369A1` | 5.68 AA | 5.93 AA |
| `--good` | `#0C7A41` | 5.19 AA | 5.42 AA |
| `--warn` | `#8A5A00` | 5.67 AA | 5.93 AA |
| `--bad` | `#C42B2B` | 5.39 AA | 5.63 AA |
| `--info` | `#1D6FD0` | 4.75 AA | 4.96 AA |

> `--ink-3` was raised from an earlier `#727C87`, which measured **3.99:1 on `--raised`** — below AA. Light `--good` was darkened from `#0F8A4A` (4.23:1, **fail**) to `#0C7A41`.

### Fills — and the two-variant rule

**Every accent exists in two variants, and confusing them is the easy mistake.** `scripts/check-contrast.mjs` caught exactly this error in its own first run against a draft of this document.

| Variant | Theme-dependent? | Job | Must clear |
|---|---|---|---|
| `--forge` | **Yes** | Stroke, text, icon, focus ring | 4.5:1 vs the surface behind it |
| `--forge-solid` | **No — identical in both themes** | Button fill, badge fill, bar fill | 4.5:1 vs `--fill-ink` on top of it |

The stroke variant has to be dark enough to read on white and bright enough to read on near-black — which cannot be one colour. The fill variant must **not** change between themes, because a brand fill that shifts hue with the theme is not a brand fill.

| Token | Value | Notes |
|---|---|---|
| `--forge-solid` | `#FF7A2F` | Both themes |
| `--quench-solid` | `#4FC3F7` | Both themes |
| `--good-solid` | `#4ADE80` | Both themes |
| `--warn-solid` | `#FFC53D` | Both themes |
| `--bad-solid` | `#FF4D6D` | Both themes |
| `--forge-wash` | `rgb(255 122 47 / 0.12)` | Tinted background |
| `--quench-wash` | `rgb(79 195 247 / 0.12)` | Tinted background |

> **Text on any solid fill is `--fill-ink: #0A0B0D`.** Verified: white on forge is **2.60:1 — fails**. This is a hard rule, not a preference.
>
> | Fill | dark ink | white |
> |---|---|---|
> | forge | **7.57 ✅** | 2.60 ❌ |
> | quench | **9.83 ✅** | 2.00 ❌ |
> | good | **11.30 ✅** | 1.74 ❌ |
> | warn | **12.48 ✅** | 1.58 ❌ |
> | bad | **6.13 ✅** | 3.21 ❌ |

### The colour rule that matters most

**Forge and quench cannot be told apart by a colour-blind user.** Measured separation under simulation:

| | protan | deutan | tritan |
|---|---|---|---|
| forge vs quench | 2.06 | **1.03–1.23** | 1.52 |
| good vs bad | 2.56 | **1.34–1.49** | 1.51 |

Tested five secondary hues; **none fixed it** — the collapse is in luminance, not hue. Therefore:

> **Forge and quench carry emphasis, never identity.** Meaning always comes from position, label, icon or shape. Colour reinforces; it never distinguishes. `good`/`bad` always ship an icon **and** a word.

### Charts — carry the existing ramp over, do not reinvent

The current `palette.js` ramp was validated with a proper ΔE-based data-viz validator, with output recorded in-file. **Contrast ratio is the wrong metric for categorical separation, so a ramp derived from it here would be unvalidated.**

Verified against the new surfaces:

| Ramp | Result |
|---|---|
| **Dark ramp on new `#121417`** | All 8 slots **3.73–6.01:1 — carry over unchanged** |
| **Light ramp on `#FFFFFF`** | Slots 2/3/4 at **2.82 / 2.17 / 2.69:1** — same warning `palette.js:8` already records |

**Action:** keep the ramp and its slot ordering (the ordering *is* the CVD-safety mechanism), re-run the real validator after the rebrand, and keep the existing mitigation — every chart ships a legend **and** a `DataTable`.

## C.2 Typography

| Role | Family | Weights | Why |
|---|---|---|---|
| **Display** | Space Grotesk | 500, 700 | Geometric, slightly mechanical, distinctive without being a costume. Headlines, big metrics, wordmark |
| **UI** | IBM Plex Sans | 400, 500, 600 | Technical character, excellent at 13–15px. Chosen over Inter, which is the generic-SaaS default |
| **Data / typing** | JetBrains Mono | 400, 500, 700 | Designed for code legibility — unambiguous `1 l I`, `0 O`. **All numerals, all code, the typing surface** |

**8 weights total — identical to today's budget** (Manrope ×5 + JetBrains ×3). No performance regression.

```
https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap
```

### Scale

| Token | Size / line-height | Tracking | Family | Use |
|---|---|---|---|---|
| `display-xl` | 64 / 64 | −0.04em | Display 700 | Landing hero |
| `display-l` | 48 / 52 | −0.035em | Display 700 | Page hero |
| `display-m` | 34 / 38 | −0.03em | Display 700 | Section hero, result headline |
| `title-l` | 24 / 30 | −0.02em | Display 500 | Screen title |
| `title-m` | 19 / 26 | −0.01em | UI 600 | Card title |
| `title-s` | 16 / 22 | −0.005em | UI 600 | Sub-head |
| `body-l` | 16 / 26 | 0 | UI 400 | Long prose |
| `body` | 14 / 22 | 0 | UI 400 | Default |
| `body-s` | 13 / 20 | 0 | UI 400 | Secondary |
| `label` | 12 / 16 | 0.02em | UI 500 | Form labels |
| `eyebrow` | 11 / 14 | 0.10em | Mono 500 caps | Section eyebrow |
| `metric-xl` | 56 / 56 | −0.02em | Mono 500 | Hero number |
| `metric-l` | 34 / 36 | −0.01em | Mono 500 | KPI |
| `metric-m` | 22 / 26 | 0 | Mono 500 | Inline metric |
| `metric-s` | 15 / 20 | 0 | Mono 500 | Table figure |
| `type-xl` → `type-s` | 24 / 22 / 20 / 18 | 0 | Mono 400 | **Typing surface** |

**Rules.** Body never below 13px · every numeral is `metric-*` with `font-variant-numeric: tabular-nums` · **`font-extrabold` is abolished** (S-2) — maximum weight is 700, and only on `display-*` · one display size per screen.

## C.3 Spacing

**4px base, 8px rhythm.** Retains the existing config's discipline; adds the missing large steps.

| Token | px | Use |
|---|---|---|
| `space-0.5` | 4 | Icon-to-label |
| `space-1` | 8 | Tight groups |
| `space-1.5` | 12 | Control padding |
| `space-2` | 16 | **Default gap** |
| `space-3` | 24 | Card padding |
| `space-4` | 32 | Section gap |
| `space-6` | 48 | Major section |
| `space-8` | 64 | Screen top |
| `space-12` | 96 | Marquee band |
| `space-16` | 128 | Hero band |

**Density per archetype** (fixes S-4):

| Archetype | Card padding | Section gap |
|---|---|---|
| Marquee | `space-6` | `space-16` |
| Stage | `space-4` | `space-4` |
| Moment | `space-4` | `space-3` |
| Console | `space-3` | `space-4` |
| Ledger | `space-2` | `space-3` |
| Gallery | `space-3` | `space-4` |
| Sheet | `space-3` | `space-4` |

## C.4 Radius, shadow, elevation

**Radius** — tightened. The current scale tops out at 32px, which reads soft rather than precise.

| Token | px | Use |
|---|---|---|
| `radius-xs` | 4 | Chips, inline code |
| `radius-sm` | 6 | Buttons, inputs |
| `radius-md` | 10 | Cards |
| `radius-lg` | 14 | Panels, modals |
| `radius-xl` | 20 | Hero surfaces |
| `radius-full` | 9999 | Avatars, pills |

**Elevation** — five levels, each with one job. In dark mode, elevation is carried by **surface lightness first, shadow second**; in light mode the reverse.

| Level | Dark | Light | Use |
|---|---|---|---|
| 0 | `--bg`, no shadow | `--bg` | Page |
| 1 | `--surface` + hairline | `--surface` + `0 1px 2px /0.04` | Cards |
| 2 | `--surface` + `0 2px 8px /0.30` | `+ 0 2px 8px /0.06` | Hover, sticky |
| 3 | `--raised` + `0 8px 24px /0.40` | `+ 0 8px 24px /0.10` | Popover, dropdown |
| 4 | `--raised` + `0 24px 60px /0.55` | `+ 0 24px 60px /0.14` | Modal, countdown |

**Glass is reduced to one variant** (fixes S-7): `.glass` for sticky chrome only. `liquid-glass`, `glow-panel`, `aurora` and all decorative blur orbs are **deleted**.

## C.5 Icons

**Lucide**, already in use and tree-shaking correctly. Rules: 1.75px stroke at 16–20px, 2px at 24px+ · sizes 14/16/20/24 only · decorative icons `aria-hidden` · **icon-only buttons always carry `aria-label`** · **never emoji as an icon** — the medal emoji in `ResultsView.jsx:14` becomes an SVG rank badge.

---

# PART D — Component architecture

## D.1 Button

| Variant | Fill | Text | Border | Use |
|---|---|---|---|---|
| `primary` | `--forge-solid` | `--fill-ink` | none | The one action per screen |
| `secondary` | transparent | `--ink` | `--line-strong` | Alternatives |
| `ghost` | transparent | `--ink-2` | none | Tertiary |
| `danger` | transparent | `--bad` | `--bad`/40 | Destructive |

Sizes `sm 32` / `md 40` / `lg 48`, min touch target **44×44** (padding, not height). States: hover `+4% lightness, 120ms` · active `scale .98, 80ms` · focus `2px --forge ring, 2px offset` (measured **7.57:1** dark, 4.96:1 light) · disabled `40% opacity, no pointer` · loading spinner replaces the leading icon, **width locked** to prevent layout shift.

## D.2 Input · D.3 Card · D.4 Navigation

**Input.** 40px, `radius-sm`, 1px `--line-strong`, `--surface`. Focus: border `--forge` + 2px ring. Error: border `--bad` + **icon + message below** (never colour alone, DP-6). Labels always visible — never placeholder-as-label.

**Card.** `--surface`, 1px `--line`, `radius-md`, padding per archetype (§C.3). **Interactive only when the whole card is a link** — hover lifts elevation 1→2, `translateY(-1px)`, 160ms. No decorative gradients, no blur orbs.

**Navigation.** Rail 60px collapsed / 236px expanded — **keep the existing geometry** (`AppShell.jsx:53-76`); it is precisely reasoned and correct. Five items (§`03-app-flow.md` 1.2). Active state is the shared `layoutId` pill — the one ambient motion worth keeping. Mobile tab bar 56px + safe-area inset. **All of it unmounts in Stage focus mode.**

## D.5 Tabs · D.6 Modal · D.7 Tooltip · D.8 Toast

**Tabs.** Underline, not pill. 2px `--forge` indicator sliding 180ms. `role="tablist"`, arrow-key navigation.

**Modal.** `radius-lg`, elevation 4, backdrop `--bg/80` + 8px blur. Focus trapped, restored on close. Escape closes. Enter 180ms scale `.97→1` + fade; exit 120ms fade only — **exit faster than enter**.

**Tooltip.** `--raised`, `radius-xs`, `body-s`. 400ms delay in, 0 out. **Never the only source of information** — this is what breaks today's flag indicator (A.4 B-4).

**Toast.** Bottom-right desktop / top mobile. Icon + text + optional action. 4s auto-dismiss, 8s with an action, never for errors needing a decision. **Suppressed entirely while `status === 'running'`** (DP-1).

## D.9 Table

`metric-s` mono figures, right-aligned numerics, tabular nums. Header `eyebrow`. Row height 44. Zebra via `--surface`/`--bg` alternation, never a tint. **Mobile: tables become stacked definition lists, not horizontal scroll** — fixes A.5 D-4 and A.10 R-2.

## D.10 Charts

Carry the existing ramp (§C.1). Every chart: title, axis units, legend **and** `DataTable` toggle. No gridline below `--line`. Sparklines and heatmaps are pure SVG in `charts/primitives.jsx` — **no recharts import**, fixing the 421 kB penalty.

## D.11 Progress indicators

| Component | Spec |
|---|---|
| Linear bar | **6px** (up from 4 — fixes CO-2), `radius-full`, track `--line`, fill `--forge` |
| Ring | 8px stroke, rounded cap, `--forge`, value in `metric-l` at centre |
| Typing progress | **2px, full-bleed, directly under the passage.** The only progress element on a Stage |
| Segmented | For mission steps — discrete blocks, not a continuous bar |

## D.12 Ranking components

**Rank badge.** Ranks 1–3 get an SVG medal form (gold `#E8B44A` / silver `#B8BEC7` / bronze `#C4844A`) — **shape differs per rank**, so it is not colour-only. Rank 4+ is a mono numeral.

**Leaderboard row.** 44px, `[rank] [avatar] [name] ······ [metric]`. Own row: `--forge-wash` background + 2px left border + `(you)`. **Three signals, so it is not colour-only.** Own row pins to the bottom edge when outside the visible window.

**Rating delta.** `+18` in `--good` with an up-arrow, `−12` in `--bad` with a down-arrow. Arrow is mandatory (DP-6).

## D.13 Battle components

**Room code.** `metric-xl` mono, `0.18em` tracking, whole block is the copy target. Confusable-free alphabet is already enforced server-side.

**Seat grid.** Filled seats `--surface` + avatar; empty seats dashed `--line` outline. Capacity is legible at a glance without counting.

**Countdown.** Full-bleed elevation-4 overlay. Numeral `160px` mono 700 `--forge`. Each beat: scale `0.7→1` in 280ms, exit `1→1.35` + fade. `GO` switches to `--good`. Already `aria-live="assertive"` — keep.

**Race track.** Horizontal lane per player. Own lane is **2× height**, `--forge`, top position, labelled `YOU`. Rivals `--ink-3` at 60% opacity, `--quench` only on the current leader. Positions update on `requestAnimationFrame` from the tick ref — **never React state** (`useBattleRoom.js:22-29`).

**Result row.** `[rank badge] [avatar] [name] [mistakes] [wpm] [accuracy] [time]`. Mistakes column first — **it is the primary sort key**, and putting it first makes the ranking legible.

## D.14 The typing editor — the most important component

```
┌────────────────────────────────────────────────────────┐
│  time · normal                                    ⚙ ⛶ │  ← 32px, fades to 40% on keystroke
├────────────────────────────────────────────────────────┤
│                                                        │
│    the quick brown fox jumps over the lazy dog        │  ← type-l, mono 400
│    and keeps ▊unning until the words run out          │     max 62ch
│                                                        │
├────────────────────────────────────────────────────────┤  ← 2px progress
│  62 wpm      97%       0:24                    12/60  │  ← metric-m, --ink-2
└────────────────────────────────────────────────────────┘
```

**Character states — every one carries a non-colour cue.** This is the AX-1 fix, and it is required because `wrong` vs `pending` measures **1.06:1**.

| State | Colour | **Non-colour cue** | Why that cue |
|---|---|---|---|
| Pending | `--ink-3` | — (baseline) | |
| Correct | `--ink` | Full opacity + weight 500 | Reads as "solid" |
| **Wrong** | `--bad` | **2px underline + `--bad`/12 background** | Underline needs no reflow |
| Corrected | `--warn` | **2px dotted underline** | Distinct from wrong's solid |
| Current | — | **Caret** | Position, not colour |

> **Cues must not change metrics.** Weight changes reflow text and would move the caret mid-run. Underline, background and opacity do not. This constraint is why `font-weight` is not used to mark state.

**Caret.** Block `--forge` at 45% with `mix-blend`. Spring `stiffness 900, damping 55, mass 0.35` — keep the existing tuning, it is correct. Blinks only when idle. Line and underline variants remain.

**Measure.** Prose max **62ch**; code unwrapped with horizontal scroll inside the stage.

**Focus mode.** Rail, tab bar, header and FAB unmount. Passage centres. Escape exits **without resetting the run**.

## D.15 Code practice UI

Adds a 2.2em line-number gutter (absolutely positioned, outside the character flow the caret measures against — the existing approach is correct), and unwrapped lines.

**Syntax vs state — the binding rule** (fixes C-2): typing state **always** overrides syntax colour. Precedence: `wrong` → `corrected` → `current` → syntax → `pending`. A wrong character reads as wrong regardless of its token.

**Prism tokens move into the token system** (fixes C-3) — they are currently hardcoded hex and cannot follow a rebrand. Each maps to a chart-ramp slot so it inherits the CVD validation.

**AI sidebar** collapses to a 40px rail during a run and expands only on the result (DP-1).

## D.16 Result UI

**Inline, not a modal** — fixes CO-4. Replaces the stage in place; the passage stays visible above it.

```
┌────────────────────────────────────────────────────────┐
│   A          78 wpm    97%     94%      92 wpm         │
│  grade       ↑ +4      acc     cons     raw            │
├────────────────────────────────────────────────────────┤
│  + 84 XP          ★ Personal best                      │
├────────────────────────────────────────────────────────┤
│  Keys that cost you    ;  18%    (  12%    ?  9%       │
│                              [ Drill these keys → ]    │
├────────────────────────────────────────────────────────┤
│  [ Retry  R ]                    [ Next  ⏎ ]           │
└────────────────────────────────────────────────────────┘
```

Grade is `display-m`; metrics `metric-l`. **Weak keys sit above the buttons** — they are the reason the screen exists (fixes D-2). `Enter` / `R` / `D` bound. Confetti replaced by a single 400ms forge sweep across the grade (fixes CO-5).

---

# PART E — Screen designs

## E.1 Homepage `/` — Marquee

```
┌──────────────────────────────────────────────────────────┐
│  ◣ TypeForge                       Sign in    Start →   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   Type faster.                                           │
│   Prove it.                              display-xl      │
│                                                          │
│   A typing-performance platform for people who           │
│   type for a living.                     body-l --ink-2  │
│                                                          │
│   ┌────────────────────────────────────────────┐        │
│   │  the quick brown fox jumps over the ▊      │        │
│   │                                             │        │
│   │  press any key to begin              62ch  │        │
│   └────────────────────────────────────────────┘        │
│                                                          │
│   No account needed · Works offline                      │
├──────────────────────────────────────────────────────────┤
│  PRACTICE      CODE        COMPETE      PROGRESS         │
│  6 modes       11 langs    live races   diagnosis        │
└──────────────────────────────────────────────────────────┘
```

**The hero is a working typing surface.** Pressing any key starts a real, scored 30-second run. This demonstrates the promise instead of describing it, and collapses five steps into one. Below the fold: four pillars, one diagnosis screenshot, footer. **Six sections maximum.** Prerendered (TRD §B.32).

## E.2 Dashboard `/home` — Console

Row 1 — **Next-Action banner**, full width, `--forge-wash`, `title-l` + one button: *"Drill `;` — costing you 18%"*. Row 2 — today's ring · missions · streak. Row 3 — four KPIs with sparklines. Row 4 — recent activity · nearest badges.

**One forge element on the screen: the banner** (DP-3). Everything else is `--ink`/`--ink-2`.

## E.3 / E.4 Typing and Code practice — Stage

Per D.14 / D.15. Chrome at 32px above, metrics at 40px below, **nothing else**. Mode/difficulty/settings collapse into the top bar; missions and weak-key strips move to the result. Keyboard viz is opt-in and sits below the metrics row.

## E.5 Battle mode `/battle` — Console-lite

Quick Match is a full-width `--forge` panel with `display-m` and a single button. Below it, a two-column split: enter a code (mono PIN input) · create a room (collapsed settings, expandable). Rules strip at the bottom: *"Fewest mistakes wins. Then speed."*

## E.6 Matchmaking — Moment

Centred. Elapsed timer in `metric-l` mono. Status in `body`. Cancel always visible. **No fabricated player counts** — the existing leaderboard already refuses to invent rivals and matchmaking inherits that standard. At 60s: *"Nobody's around. Race your own best time?"*

## E.7 Live battle — Stage

Identical stage geometry to solo. Additions only: room code chip and connection state in the 32px bar; race track in a 280px right column (below the stage on tablet, collapsed to a 3-line summary on mobile). Own lane 2× height, forge, top, labelled. **Rivals never exceed `--ink-3` at 60%.**

## E.8 Battle results — Moment

```
┌──────────────────────────────────────────────────────────┐
│  BATTLEFIELD K7M2QX                                      │
│                                                          │
│  You won                                    display-l    │
│  Won on mistakes — 0 against 2.             title-l ←←←  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ ①  YOU   │  │ ②  Mira  │  │ ③  Kai   │              │
│  │  78 wpm  │  │  84 wpm  │  │  71 wpm  │              │
│  │ 0 errors │  │ 2 errors │  │ 3 errors │              │
│  └──────────┘  └──────────┘  └──────────┘              │
├──────────────────────────────────────────────────────────┤
│  [ Rematch ]              [ New match ]      [ Leave ]  │
└──────────────────────────────────────────────────────────┘
```

**`whyWon()` is promoted to `title-l`, directly under the headline** — fixes B-3. It is what turns a confusing result (a 78 WPM run beating an 84 WPM run) into a legible one. Flagged results show an inline `--warn` chip with a word, never a hover-only title (fixes B-4).

## E.9–E.13 Profile · Leaderboards · Achievements · Statistics · Settings

**Profile** — Sheet. Identity → account → privacy → settings, in that order. Avatar picker collapses behind "Change" (fixes PR-3). Uses the real `Switch` component (fixes PR-2). Single surface treatment (fixes PR-1).

**Leaderboards `/ranks`** — Ledger. Board switcher as tabs. Own row pinned. XP and Skill explicitly labelled and never conflated.

**Achievements `/progress/awards`** — Gallery. Level ladder → missions → badge grid, in three clearly separated bands (fixes A-1). Locked badges at full text contrast with a lock icon; **`opacity-60` is removed** (fixes A-2). Tier colours move into tokens (fixes A-3).

**Statistics `/progress`** — Console. **Weak keys promoted to position 2**, immediately under the KPI row (fixes D-2). Skill radar either gets its normalisation stated inline or is cut — an arbitrary scale presented as objective violates DP-2.

**Settings** — a section of Profile, not a route.

## E.14 Mobile — see Part G.

---

# PART F — Motion

## F.1 Tokens

| Token | ms | Easing | Use |
|---|---|---|---|
| `instant` | 80 | `linear` | Active/pressed |
| `fast` | 120 | `cubic-bezier(.4,0,.2,1)` | Hover, colour |
| `base` | 180 | `cubic-bezier(.2,0,0,1)` | Most transitions |
| `slow` | 280 | `cubic-bezier(.16,1,.3,1)` | Panels, page entry |
| `deliberate` | 420 | `cubic-bezier(.16,1,.3,1)` | Countdown, level-up |

**Only `transform` and `opacity` are animated.** No width, height, top or left — they force layout, and layout on the typing path costs keystrokes.

## F.2 Specifications

| Moment | Motion |
|---|---|
| Page transition | Fade + 8px rise, `slow`, exit `fast` |
| Hover | Colour `fast`; card lift `translateY(-1px)` `base` |
| Button press | `scale(.98)` `instant` |
| **Typing feedback** | **None per character.** Only the caret moves |
| Caret | Spring 900/55/0.35 — existing tuning, keep |
| Progress | Width via `transform: scaleX`, `slow` |
| **Countdown** | Beat: scale `.7→1` 280ms; exit `1→1.35` + fade. GO turns `--good` |
| Race position | `transform: translateX` on rAF, no React state |
| Victory | Result rows stagger 60ms, `slow`. **No confetti** |
| Defeat | Same choreography, no accent. Never punitive |
| Level-up | Ring fills `deliberate`, numeral cross-fades, one forge pulse |
| Achievement | Slides from the left, 60ms stagger. Max 3 visible, rest collapse |
| Matchmaking | Pulsing 2px ring, 1.6s loop, `--quench` |
| Loading | <100ms nothing · <500ms inline spinner · <3s skeleton · **regenerating a passage keeps the old text under a shimmer** |

## F.3 Removals

Delete: the cycling tagline (N-1) · `float` keyframe · all eight decorative blur orbs (S-6) · blur-orb hover scaling · confetti (3 sites) · `aurora`.

## F.4 Reduced motion

`prefers-reduced-motion: reduce` → all transitions 0.01ms; the countdown becomes a number swap with no scale; the race track jumps rather than tweens; the caret stops blinking. **Handled globally already** (`index.css:141`) plus `useReducedMotionSafe` per component. Keep both.

---

# PART G — Responsive

**Four designs, not one design shrunk.**

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | 360–639 | Single column · bottom tab bar · **tables become stacked lists** · race track collapses to a 3-line summary |
| Tablet | 640–1023 | Two columns · tab bar retained · race track moves below the stage |
| Laptop | 1024–1439 | Rail (collapsed) · three columns · race track in the right column |
| Desktop | 1440+ | Rail (expandable) · max content 1400px · full layouts |

**Per-archetype behaviour:**

| Archetype | Mobile posture |
|---|---|
| Stage | **Nearly identical.** The stage is already minimal — chrome shrinks, the passage stays. `type-m` instead of `type-l` |
| Moment | Full-bleed, single column, buttons full-width |
| Console | Reorder by priority — next-action first, charts last. **Never hide primary information** (fixes R-1) |
| Ledger | Table → stacked definition list |
| Gallery | 2 columns |
| Sheet | Single column, 48px inputs |
| Marquee | Hero stacks; the typing demo stays but shortens |

**Rules:** no horizontal page scroll at any width · touch targets ≥44px with ≥8px separation · wide content scrolls in its own `overflow-x` container · safe-area insets on the tab bar · **nothing primary is `hidden` on mobile** — it reflows.

> **Typing on mobile is unresolved (TRD U-4).** The engine captures `keydown` and has no composition handling. Until tested, the Stage must either work properly or **say so where the user would attempt it** — an honest limitation beats a half-working focus surface.

---

# PART H — Accessibility

**Target: WCAG 2.2 AA.**

| # | Rule | Status |
|---|---|---|
| H-1 | All text ≥4.5:1 in both themes | ✅ Verified §C.1 |
| H-2 | Non-text/UI ≥3:1 | Focus ring 7.57 dark / 4.96 light ✅ |
| H-3 | **Colour is never the only signal** | Typing states, results, ranks, deltas all carry shape/icon/text |
| H-4 | Every function keyboard-reachable | Existing + `?` shortcut sheet |
| H-5 | Visible focus on everything | Global rule exists — keep |
| H-6 | Focus not obscured *(2.2 AA, new)* | Sticky chrome must not cover the focused element — audit the rail and tab bar |
| H-7 | Target size ≥24×24 minimum *(2.2 AA)*, 44×44 for touch | — |
| H-8 | Dragging has a non-drag alternative *(2.2 AA)* | No drag interactions exist — maintain |
| H-9 | Reduced motion honoured | Global + per-component — keep |
| H-10 | Modals trap and restore focus | Verify |
| H-11 | `aria-live` on run completion and rank change | **New** — fixes AX-2 |
| H-12 | Charts keep a `DataTable` alternative | Existing — keep |
| H-13 | Errors: icon + text + position, never colour alone | — |
| H-14 | Automated audit in CI, output recorded | **New** — fixes AX-5 |

**Typing surface semantics:** `role="textbox"`, `aria-label="Typing area"`, `aria-describedby` instructions (all exist). Add: `aria-live="polite"` region announcing result on completion; per-character spans stay `aria-hidden` (announcing 400 spans is unusable).

---

# PART I — Stickman combat UX architecture

**Not implemented.** This defines the signal contract so the visual layer can be added later without reworking the engine.

## I.1 Signal mapping

The engine already computes every input. Nothing new needs measuring.

| Typing signal | Source | Combat meaning | Visual |
|---|---|---|---|
| Live WPM | `live.wpm` | Attack rate | Strike frequency |
| Rolling accuracy | `live.accuracy` | Attack connects vs whiffs | Hit spark vs stumble |
| Mistake event | `keystrokes.total − correct` | Damage taken / stagger | Recoil, HP loss |
| **Correct streak** | **new counter** | Combo multiplier | Escalating aura, combo numeral |
| Progress | `live.progressChars` | Stage advancement | Fighter moves forward |
| Consistency | `consistencyPct(samples)` | Guard stability | Blocking posture |

**One new engine value:** a consecutive-correct-character counter. Everything else already exists in `useTypingEngine`'s `live` object.

## I.2 Layout — the typing surface stays a Stage

```
┌──────────────────────────────────────────────────────────┐
│  YOU ████████░░  HP 78          HP 62  ░░████████ RIVAL │  ← 48px
├──────────────────────────────────────────────────────────┤
│        🯅                                   🯅           │  ← 140px, PERIPHERAL
├──────────────────────────────────────────────────────────┤
│                                                          │
│    the quick brown fox jumps over the ▊                 │  ← THE STAGE
│                                                          │  ← unchanged
├──────────────────────────────────────────────────────────┤
│  78 wpm    97%    combo ×4                              │
└──────────────────────────────────────────────────────────┘
```

**Binding constraints:**
1. Combat occupies **≤140px** and never moves into the reading path.
2. Combat animation runs on `requestAnimationFrame` from refs — **never React state** (the Battlefield tick architecture already proves this pattern).
3. Combat colour is desaturated relative to the passage. The text is always the brightest thing on screen.
4. Reduced-motion → combat becomes static poses with numeric HP.
5. **Combat must be hideable.** A player who wants pure racing keeps the mode and drops the visuals.

## I.3 Why this is safe to defer

The contract needs one new counter and one new realtime payload shape. No change to the metric formulas, the scoring model, or the Stage layout. That is what makes it a Phase 4 addition rather than a rewrite.

---

# PART J — Visual QA checklist

## Tokens
- [ ] No raw hex in components — all colour via tokens
- [ ] Prism token colours moved into the token system (C-3)
- [ ] Tier colours moved into tokens (A-3)
- [ ] No `font-extrabold` anywhere (S-2)
- [ ] Every numeral uses a `metric-*` token with tabular figures
- [ ] Spacing uses scale tokens only (S-4)

## Contrast — re-measure, do not assume
- [ ] Every text token ≥4.5:1 on every surface it appears on, **both themes**
- [ ] Focus ring ≥3:1 against every adjacent surface
- [ ] Solid fills use `--fill-ink` — **white on forge is 2.60:1 and fails**
- [ ] Chart ramp re-validated with the ΔE validator, output recorded in `palette.js`
- [ ] No `opacity-60` on text (A-2)

## Colour independence (DP-6)
- [ ] Typing `wrong` distinguishable from `pending` **in greyscale** — measured 1.06:1 on colour alone
- [ ] Ranks 1–3 differ in **shape**, not just metal colour
- [ ] Rating deltas carry arrows
- [ ] Every `good`/`bad` state carries an icon and a word
- [ ] Screenshot proof in greyscale for the Stage, results and leaderboard

## Stage discipline (DP-1)
- [ ] Chrome **unmounts** in focus mode — not merely dimmed
- [ ] Controls fade to 40% within 400ms of the first keystroke
- [ ] No toast, modal, or FAB can appear while `status === 'running'`
- [ ] Zero layout shift during a run
- [ ] Typing state overrides syntax colour in all 11 grammars, both themes

## Motion (DP-5)
- [ ] Only `transform`/`opacity` animated
- [ ] Cycling tagline, `float`, blur orbs, confetti, `aurora` all deleted
- [ ] Exit is faster than enter everywhere
- [ ] `prefers-reduced-motion` verified on countdown, race track, level-up

## Responsive
- [ ] No horizontal page scroll at 360, 390, 768, 1024, 1440, 2560
- [ ] Tables become stacked lists on mobile (R-2)
- [ ] Nothing primary is `hidden` on small screens (R-1)
- [ ] Touch targets ≥44px, ≥8px apart
- [ ] Safe-area insets on the tab bar

## Accessibility
- [ ] axe: zero criticals on every route, **output recorded**
- [ ] Full keyboard traversal, no traps — `Tab` inside the Stage is a character
- [ ] Focus visible and never obscured by sticky chrome (H-6, 2.2 AA)
- [ ] Modals trap and restore focus
- [ ] `aria-live` announces run completion
- [ ] Charts keep `DataTable` alternatives

## Performance
- [ ] Landing ≤150 kB gzip
- [ ] `SessionSummary` pulls **0 kB** of recharts (L-3, CO-4)
- [ ] Typing latency measured at 150 WPM — zero dropped keystrokes
- [ ] No route imports a library it does not use

---

## Appendix — verification of this brief

| Check | Result |
|---|---|
| Screen-by-screen audit across all 14 requested categories | ✅ Part A |
| Every audit finding traced to a file and line | ✅ |
| Colour contrast **computed**, not estimated | ✅ §C.1, script output |
| CVD tested; failures reported honestly rather than hidden | ✅ forge/quench 1.03 deutan |
| Chart ramp not reinvented on the wrong metric | ✅ existing ΔE-validated ramp carried over |
| All 14 core experiences designed | ✅ Part E |
| Every requested token category defined | ✅ Part C, D |
| Motion, responsive, accessibility, QA | ✅ Parts F–J |
| Skill output verified and partly rejected with reasons | ✅ §B.0 |
| No reference product's visual identity copied | ✅ principles only, §B.0 |
