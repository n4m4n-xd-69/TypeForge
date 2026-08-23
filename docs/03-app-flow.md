# TypeForge — Application Flow & Information Architecture

**Version:** 1.0
**Date:** 2026-08-23
**Depends on:** `00-codebase-audit.md`, `01-PRD.md`, `02-TRD.md`
**Audience:** product design, UX, frontend engineering

---

## 0. The three ideas this document is built on

Everything below follows from three decisions. If you read nothing else, read these.

### 0.1 One loop, not a feature list

The product is a loop, and **every screen must name its position in it.** A screen that cannot say which arrow it sits on does not belong.

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
    ┌────────┐    ┌──────────┐   ┌───────┐   ┌────────┴────┐
    │ TYPE   │───▶│  RESULT  │──▶│ LEARN │──▶│   RETURN    │
    │ Stage  │    │  Moment  │   │Console│   │ Home/Compete│
    └────────┘    └──────────┘   └───────┘   └─────────────┘
      focus       what happened   what to      what next
                                   fix
```

This is what makes it one ecosystem rather than a collection of features: **every terminal screen hands you the next arrow.** A results screen that ends in a dead stop is a bug, not a layout choice.

### 0.2 Seven surface archetypes — the answer to "don't make everything a dashboard"

Every screen is exactly one archetype. The archetype dictates density, chrome, motion and hierarchy. Mixing them is what makes products feel like unrelated features bolted together.

| Archetype | Job | Density | Chrome | Motion | Screens |
|---|---|---|---|---|---|
| **Stage** | One task, total focus | Minimal — one object | **Recedes or hides** | Only the caret | Practice, Code, Race |
| **Moment** | One event, decisive | Single figure dominant | Suppressed | The one beat that matters | Results, Countdown, Level-up |
| **Console** | Scan state, decide next | Dense, scannable | Full | Entry only, once | Home, Progress |
| **Ledger** | Records, comparison | Tabular, quiet | Full | None | History, Leaderboards |
| **Gallery** | Browse and choose | Cards, generous | Full | Stagger on entry | Awards, Snippet browser |
| **Sheet** | Enter and confirm | Form rhythm | Full | Step transitions | Profile, Settings, Onboarding |
| **Marquee** | Persuade a stranger | Spacious, editorial | **Its own** | Deliberate, once | Landing |

> **The rule that matters:** the current codebase makes Practice, Code, Dashboard, Achievements and Profile all look like the same card-grid. Four of those five are the wrong archetype. **Practice and Code are Stages.** They should not look like Home.

### 0.3 Friction budget

Measured in **keystrokes-or-clicks to the first typed character.**

| Journey | Budget | Today | Design target |
|---|---|---|---|
| Stranger → typing | ≤ 1 | n/a (no landing page) | **1** — CTA starts a run |
| Returning → typing | ≤ 1 | 2 (Home → Typing) | **1** — Train tab resumes last mode |
| Returning → same mode again | **0** | 1 (Next exercise) | **0** — `Enter` repeats |
| Invited → racing | ≤ 2 | 2 ✅ | **2** — preserve |
| Solo → competing | ≤ 2 | **∞ (impossible)** | **2** — Quick Match |

> **"Solo → competing" is currently infinite.** Without a code from another person you cannot race at all. That is the single largest friction defect in the product.

---

# PART 1 — Information architecture

## 1.1 Global sitemap

```
PUBLIC
│
├── /                          Landing                      [Marquee]
└── /about                     About                        [Console]

APPLICATION
│
├── /home                      Dashboard                    [Console]
│
├── TRAIN
│   ├── /practice              Prose typing                 [Stage]
│   └── /code                  Code typing                  [Stage]
│
├── COMPETE
│   ├── /battle                Battlefield hub              [Console-lite]
│   ├── /battle/:pin           Room — 4 phases              [Stage → Moment]
│   └── /ranks                 Leaderboards                 [Ledger]
│
├── PROGRESS
│   ├── /progress              Analytics                    [Console]
│   ├── /progress/history      Session history              [Ledger]   NEW
│   └── /progress/awards       Achievements                 [Gallery]
│
└── /profile                   Identity, account, settings  [Sheet]

UTILITY — not in primary navigation
├── /coach                     AI coach                     [Sheet]
└── /admin                     Operator view                [Console]

OVERLAYS — no route of their own
├── Command palette  ⌘K
├── Auth modal
├── Onboarding
└── Toasts
```

### Route changes and redirects

| Old | New | Why | Redirect |
|---|---|---|---|
| `/` (hybrid) | `/` landing + `/home` | PRD IMP-1 | `/` → `/home` when local progress exists |
| `/dashboard` | `/progress` | "Dashboard" names a layout, not a job | 301 |
| `/achievements` | `/progress/awards` | Progress and awards are one story | 301 |
| `/chat` | `/coach` | Names the role, not the mechanism | 301 |
| `/practice`, `/code`, `/battle/*` | unchanged | Working deep links; no reason to churn | — |

> **Deliberate departure from PRD §28.4.** The PRD proposed nesting typing under `/train`. **Rejected:** it breaks working deep links and adds a hub screen between a returning user and the thing they came for. `Train` is a *navigation group*, not a route. Mode switching happens **inside the Stage**, where the user already is.

## 1.2 Navigation hierarchy

**Five primary items.** The mobile tab bar renders each `flex-1`; at 360px a 9th item gives every tab 40px, so 8 is a hard ceiling (`AppShell.jsx:336-338`). Five leaves headroom for future modes.

| # | Item | Resolves to | Sub-navigation |
|---|---|---|---|
| 1 | **Home** | `/home` | — |
| 2 | **Train** | last mode used, default `/practice` | In-Stage mode switcher |
| 3 | **Compete** | `/battle` | Tabs: Play · Ranks |
| 4 | **Progress** | `/progress` | Tabs: Overview · History · Awards |
| 5 | **Profile** | `/profile` | Sections |

**Persistent chrome (the connective tissue):**

| Element | Where | Behaviour |
|---|---|---|
| Rail / tab bar | All app routes | **Hidden in Stage focus mode and during a race** |
| Streak indicator | Header | Always — it is the return hook |
| Level + XP | Header | Always |
| ⌘K palette | Global | Always, including in Stage |
| Coach FAB | All app routes | **Suppressed during an active run** (PR-3) |
| Theme toggle | Header | Always |

**Chrome suppression is the mechanism that makes Stage a Stage.** Not a visual style — an actual removal.

## 1.3 Screen hierarchy

```
Depth 0   Landing ─────────────────────── stranger
Depth 1   Home · Practice · Code · Battle · Ranks · Progress · Profile
Depth 2   Room · History · Awards · Coach · Snippet browser
Depth 3   Room phases (lobby → countdown → race → results)
Overlay   Palette · Auth · Onboarding · Toast · Confirm
```

**Rule: nothing a user needs weekly may sit below Depth 2.** Session history is Depth 2 (a tab), not Depth 3.

---

# PART 2 — Screen specifications

Format for every screen:
**Purpose · Entry · Goal · Primary CTA · Secondary · Required info · Components · States · Success · Error · Exits · Related**

---

## 2.1 Landing `/` — Marquee `[NEW]`

| | |
|---|---|
| **Purpose** | Convince a stranger in one screen, then get them typing |
| **Entry** | Direct, search, shared link, invite link (redirects to room) |
| **Goal** | "Is this for me?" answered in under 10 seconds |
| **Primary CTA** | **Start typing** — begins a real 30s run inline. No signup, no navigation |
| **Secondary** | See how it works · Sign in · About |
| **Required info** | None. Renders with zero app state and no network |
| **Components** | Hero · **live typing demo** · four-pillar strip · proof strip · footer |
| **States** | First visit · returning-with-progress (auto-redirect `/home`) · signed-in (CTA becomes "Continue") |
| **Success** | User types a character in the inline demo → transitions to `/practice` carrying the run |
| **Error** | None possible — static content only |
| **Exits** | `/practice` (CTA) · `/home` (returning) · `/about` · auth modal |
| **Related** | Home · Practice · About |

**Design notes.** This is the only Marquee in the product; it may have its own nav and spacing system. It must **not** look like the app.

The CTA is not a link to the typing page — **the typing surface is embedded in the hero.** Pressing any key starts a real, scored 30-second run. That collapses "learn about it → decide → navigate → configure → type" into one action, and it demonstrates the core promise instead of describing it.

`[NEW]` per PRD LP-F1..F7.

---

## 2.2 First-time visitor flow

```
Landing ──type a key──▶ Inline 30s run ──▶ Result [Moment]
                                              │
                          "Here's your baseline: 62 WPM, 94%."
                                              │
                    ┌─────────────────────────┴──────────────────┐
                    ▼                                            ▼
              Name yourself (1 field)                        Skip
                    │                                            │
                    ▼                                            ▼
              Goal + focus (2 taps)  ───────────────────────▶  /home
```

| | |
|---|---|
| **Purpose** | Deliver value before asking for anything |
| **Goal** | A measured baseline the user believes |
| **Primary CTA** | Progresses one step at a time; never a wall |
| **States** | Fresh · returned-with-progress · arrived via invite (**skips everything**) · arrived via deep link (honours intent) |
| **Success** | User reaches `/home` with a name, a goal and one real session recorded |
| **Error** | Anonymous sign-in unavailable → silent local-only fallback (`Onboarding.jsx:52` already does this) |
| **Exits** | `/home` · `/practice` · `/code` · `/battle` per chosen focus |

> **The key inversion (PRD OB-F6).** Today onboarding asks three questions and *then* lets you type. Reversed: **measure first, ask second.** The product's promise is measurement — delivering it before asking earns the questions. A user who has just seen "62 WPM, 94% — your `;` is costing you" has a reason to answer them.

---

## 2.3 Sign-up — Sheet (overlay)

| | |
|---|---|
| **Purpose** | Make progress portable. **Never** to gate access |
| **Entry** | Profile · post-run prompt (occasional) · guest upgrade · Battlefield when anonymous auth is off |
| **Goal** | Keep my streak when I switch devices |
| **Primary CTA** | Continue with Google |
| **Secondary** | Email + password · "I already have an account" |
| **Required info** | Email + password, or Google. Display name optional (pre-filled from local profile) |
| **Components** | Modal · provider buttons · form · guest-upgrade notice |
| **States** | New account · **guest upgrade** (different copy — "keep this profile") · from-invite · cloud disabled (renders nothing) |
| **Success** | Toast; header shows account state; sync adopts local history once |
| **Error** | Email taken · weak password · network · **[U-7] Google-when-email-exists — undefined, must be specified** |
| **Exits** | Returns to the originating screen. **Never navigates away** |
| **Related** | Login · Profile · Onboarding |

**Guest upgrade is the important path.** `upgradeGuestWithEmail()` preserves the user id, so every session, key stat and achievement stays owned by the same row. Copy must say so plainly: *"Same profile, now portable."*

---

## 2.4 Login — Sheet (overlay)

| | |
|---|---|
| **Purpose** | Restore an existing account |
| **Entry** | Landing · profile · guest sign-out · expired session |
| **Goal** | Get back to my progress |
| **Primary CTA** | Sign in |
| **Secondary** | Google · forgot password · create account |
| **States** | Default · from-expiry (explains why) · **guest-with-local-progress (warns before switching)** |
| **Success** | Modal closes; sync pulls; header updates |
| **Error** | Wrong credentials (generic message — never "no such user") · unconfirmed · network · rate-limited |
| **Exits** | Back to origin |

**Edge case that must be handled:** a guest with local progress signing into a *different* account. Their local history would be adopted into the wrong account. Requires an explicit confirm: *"This device has 14 unsynced sessions. Signing into a different account will merge them."*

---

## 2.5 Onboarding — Sheet

| | |
|---|---|
| **Purpose** | Personalise enough to make Home useful |
| **Entry** | After the baseline run · re-openable from Profile `[NEW]` |
| **Goal** | Get to practising with the app knowing who I am |
| **Primary CTA** | Continue → Start practising |
| **Secondary** | Skip (always visible, never buried) |
| **Required info** | Name (optional) · daily goal · first focus |
| **Components** | 3-step modal · progress dots · goal segmented · focus cards |
| **States** | 3 steps · skipped · cloud-disabled (no account copy) · **baseline-informed** (goal pre-suggested from the run) |
| **Success** | Profile written; guest account minted if cloud is on; routed to chosen focus |
| **Error** | Anonymous sign-in fails → silent local-only |
| **Exits** | `/practice` · `/code` · `/battle` · `/home` |

**Preserve exactly** (`Onboarding.jsx` is already well-built): skippability, name-alone-is-enough, the honest guest trade-off stated at the point of decision, and the non-awaited silent guest creation.

**Change:** step 2's goal is **pre-selected from the baseline run** rather than defaulting to 15. A 90 WPM typist and a 30 WPM typist should not get the same suggestion.

---

## 2.6 Profile setup / Profile `/profile` — Sheet

| | |
|---|---|
| **Purpose** | Everything about "who I am" and "where my data lives" |
| **Entry** | Nav · header avatar · rail identity block |
| **Goal** | Change my name/avatar; understand my account; control privacy |
| **Primary CTA** | Contextual — Save name, or Sign up when local-only |
| **Secondary** | Avatar pick/upload · goal · leaderboard opt-out · sign out · **delete data** `[NEW]` · replay onboarding `[NEW]` |
| **Required info** | Local profile; auth state if cloud on |
| **Components** | Identity card · avatar grid (24 presets) · account card · privacy toggle · settings sections |
| **States** | Local-only · guest · signed-in · cloud-disabled |
| **Success** | Immediate optimistic update + toast; mirrors to `profiles` |
| **Error** | Remote write fails → **local change stands**, toast says it stayed on-device |
| **Exits** | Anywhere via nav; `/ranks` from the leaderboard card |

**Preserve:** the single-writer `persist()` pattern (`Profile.jsx:50-73`) — it is what stops local and remote diverging — and the guest sign-out warning, which is genuinely good and must not be softened.

**Absorb Settings here** (§2.27) rather than creating a separate route. Account, appearance, typing behaviour and privacy are one story: "how this thing works for me."

---

## 2.7 Home `/home` — Console

| | |
|---|---|
| **Purpose** | Answer "where am I, and what should I do right now?" in one screen |
| **Entry** | Nav Home · logo · post-onboarding · `/` redirect when progress exists |
| **Goal** | Decide the next action in under 5 seconds |
| **Primary CTA** | **Resume where you left off** — one button, the highest-value next action |
| **Secondary** | Mode entries · missions · view progress · start a battle |
| **Required info** | Local state (works offline) |
| **Components** | Next-action banner · today ring · missions · KPI row · recent activity · badge strip · coach read |
| **States** | Brand-new (empty) · early (<5 sessions) · established · streak-at-risk · **goal met** |
| **Success** | User leaves within 5s toward a typing surface |
| **Error** | AI read unavailable → local fallback, labelled `offline` |
| **Exits** | Every training and competing surface |
| **Related** | All |

**The Next-Action banner is the single most important element in the product.** It is the thing that makes TypeForge a training platform rather than a menu. Resolution order:

| Priority | Condition | Action |
|---|---|---|
| 1 | Unfinished run in progress | Resume it |
| 2 | Streak expires today | Practise now — keeps the streak |
| 3 | A weak key has ≥8 attempts and >15% error | **Drill `;` — costing you 22%** |
| 4 | Daily goal within 5 min | Finish today's goal |
| 5 | Mission one action away | Complete: type 2 code snippets |
| 6 | Nothing pressing | Continue where you left off |

Priority 3 is the differentiator. It is diagnosis converted into a single click, and it uses `weakestKeys()` which already exists (`typing.js:75`).

---

## 2.8 Quick typing practice `/practice` — **Stage**

| | |
|---|---|
| **Purpose** | Type. Nothing else |
| **Entry** | Train tab · Home CTA · palette · drill CTA from diagnosis · `?mode=` deep link |
| **Goal** | Complete a run without thinking about the interface |
| **Primary CTA** | **None visible.** Typing starts on first keypress |
| **Secondary** | Mode switcher · difficulty · regenerate · settings · focus toggle — **all recede once typing starts** |
| **Required info** | Mode, difficulty, passage |
| **Components** | Passage stage · caret · live stats · keyboard viz (optional) · mode bar |
| **States** | Idle · running · done · loading-fresh-passage · focus mode · zen |
| **Success** | Run completes → inline result |
| **Error** | AI passage unavailable → bundled text, **silently**. No error UI |
| **Exits** | Result → Retry / Next / Analyse · Escape leaves focus mode |
| **Related** | Result · Code · Progress |

### The Stage contract — binding on every typing surface

| Rule | Enforcement |
|---|---|
| The passage is the only thing with full contrast | Everything else is `--ink-3` or lower until the run ends |
| Controls fade to ~40% within 400ms of the first keystroke | Restore on Escape or run end |
| **Nothing may steal focus** | No FAB, no toast, no modal, no autofocus during `status === 'running'` |
| Live stats are peripheral | Below or beside the passage, never above it in the reading path |
| No layout shift, ever | The caret must not move because something else resized |
| Chrome hides in focus mode | Rail, tab bar and FAB actually unmount |

**Current gap:** `Practice.jsx` renders mode controls, difficulty, settings, missions and a weak-key strip *around* the stage at equal visual weight. That is a Console pretending to be a Stage. The controls must collapse into a single collapsed bar during a run.

---

## 2.9 Custom typing practice `/practice?mode=custom` — Stage

| | |
|---|---|
| **Purpose** | Practise on text the user brings |
| **Entry** | Mode switcher · palette |
| **Goal** | Type my own material |
| **Primary CTA** | Paste or type text, then begin |
| **Secondary** | Edit text · clear · save as a reusable set `[NEW P1]` |
| **Required info** | User-supplied text |
| **Components** | Text input (modal or inline) · character count · stage |
| **States** | Empty (instructional) · has-text · editing · running |
| **Success** | Run completes and scores like any other |
| **Error** | Empty → instructional placeholder, does not start. Very long → accepted, stage scrolls |
| **Exits** | Result · mode switch |

**Friction fix:** `Ctrl+V` anywhere on the Practice surface should switch to custom mode and load the clipboard. The current copy already promises this (`Practice.jsx:145`) — it should be true from any mode.

---

## 2.10 Code practice `/code` — **Stage**

| | |
|---|---|
| **Purpose** | Practise the shapes the user actually types at work |
| **Entry** | Train tab · Home · palette (per-language deep links exist) · `?lang=` |
| **Goal** | Type real code fluently, including symbols and indentation |
| **Primary CTA** | None — typing starts on keypress |
| **Secondary** | Language · difficulty · next snippet · **AI panel** · intro panel · focus |
| **Required info** | Language, difficulty, snippet, tokenised characters |
| **Components** | Code stage (mono, line numbers, syntax colours) · intro · AI sidebar · live stats |
| **States** | Idle · running · done · generating · AI loading · AI unavailable · focus |
| **Success** | Snippet completed → inline result with language recorded |
| **Error** | AI unavailable → bundled snippets, sidebar states it honestly. Prism grammar fails → plain mono, typing still works |
| **Exits** | Result · language switch · snippet browser `[NEW]` |
| **Related** | Practice · Progress |

**Binding constraint (TRD CP-3):** **typing state always overrides syntax colour.** A wrong character must read as wrong regardless of what token it is. Must be verified across all 11 grammars in both themes.

**The AI sidebar is a Stage violation as currently built** — it sits beside the code at equal weight. It should be collapsed by default during a run and expand only on the result screen, where explanation is actually wanted.

---

## 2.11 Practice configuration — in-Stage, not a screen

**Deliberately not a separate screen.** A configuration screen between a user and typing is pure friction.

| Layer | Contains | Visibility |
|---|---|---|
| Always visible | Mode, difficulty | One bar above the stage; fades during a run |
| One interaction | Duration/word count, language, drill | Inline expansion of the same bar |
| Settings panel | Sound, caret, keyboard, blind, stop-on-error, AI text, hand guide | Modal from a single icon |
| Never surfaced | `handGuideSeen`, `lastLanguage`, `codeIntroOpen` | Internal state |

**Every configuration change is remembered and applies immediately.** No Apply button. No confirmation.

---

## 2.12 Results screen — **Moment** `[CHANGED]`

| | |
|---|---|
| **Purpose** | Say what just happened, what it earned, and what to fix |
| **Entry** | Automatically on run completion |
| **Goal** | Understand the run; decide whether to go again |
| **Primary CTA** | **Next** — bound to `Enter` |
| **Secondary** | Retry (`R`) · Drill weak keys · Full analysis · Share `[NEW P1]` |
| **Required info** | Result, XP award, PB flag, fresh achievements, recent history, weak keys |
| **Components** | Grade · four metrics · XP strip · achievement cards · weak keys · sparkline |
| **States** | Normal · personal best · achievement unlocked · level up · zen (unscored) · first-ever run |
| **Success** | User presses Next within a few seconds |
| **Error** | Session failed to persist → non-blocking toast; result still shown |
| **Exits** | Next · Retry · Drill · Progress · mode switch |
| **Related** | Practice · Code · Progress · Awards |

### Two required changes

**1. Stop being a modal.** `SessionSummary.jsx:40` renders inside `<Modal>`. A modal must be dismissed before the user can do anything, which adds a click to the highest-frequency loop in the product. It becomes an **inline panel that replaces the stage in place**, with the passage still visible above it.

**2. Stop importing `Sparkline` from `Charts.jsx`.** That single import pulls **421 kB / 113 kB gzip of recharts** on *every completed run* — for a `<polyline>` that uses none of it (TRD PB-1). Fixed by the chart module split.

**Keyboard contract:** `Enter` = next · `R` = retry · `Escape` = dismiss to stage. Zero mouse required, because the loop's tightest cycle must be typeable.

---

## 2.13 Performance analysis `/progress` — Console

| | |
|---|---|
| **Purpose** | Turn accumulated sessions into a diagnosis |
| **Entry** | Nav Progress · result "Full analysis" · Home KPI click |
| **Goal** | Understand where I am strong and weak, and what to do |
| **Primary CTA** | **Drill your weak keys** — diagnosis converted to action |
| **Secondary** | Range selector · switch to History/Awards · export `[NEW P2]` |
| **Required info** | Session history, key stats, daily counters |
| **Components** | KPI row · WPM trend · accuracy trend · weekly bars · skill radar · heatmap · PBs · **weak keys** · coach read |
| **States** | Empty (0 sessions) · sparse (1–4) · established · **plateau detected** `[NEW]` |
| **Success** | User clicks through to a targeted drill |
| **Error** | AI read unavailable → local fallback labelled `offline` |
| **Exits** | `/practice?mode=drill&keys=…` · History · Awards |

**Every chart keeps its `DataTable` alternative.** This is not optional — it is the documented mitigation for the light-theme contrast warning recorded in `palette.js:8`.

**Weak keys are the hero of this screen**, not a card near the bottom. They are the only element that answers "what do I do about it."

**`[NEW]` plateau state:** when the 14-day WPM trend is flat within ±1, say so and prescribe — *"Speed has been flat for two weeks. Your accuracy is 97%: you have room to push. Try 5 runs at a difficulty above your usual."*

---

## 2.14 Progress tracking — cross-cutting

Progress is not one screen. It appears at four altitudes, and each answers a different question:

| Altitude | Where | Question | Timescale |
|---|---|---|---|
| Instant | Live stats in Stage | How am I doing right now? | Seconds |
| Run | Result Moment | How was that run? | One run |
| Trend | Progress Console | Am I improving? | Weeks |
| Record | History Ledger | What exactly did I do? | All time |

**Chrome-level always-on:** streak (header), level + XP (header), today's goal ring (Home).

---

## 2.15 Battle discovery `/battle` — Console-lite

| | |
|---|---|
| **Purpose** | Get into a match in as few actions as possible |
| **Entry** | Compete tab · Home · palette · shared link |
| **Goal** | Race someone, now |
| **Primary CTA** | **Quick Match** `[NEW]` — one action, no code needed |
| **Secondary** | Enter a code · Create a room · Ranks · competitive history `[NEW]` |
| **Required info** | Auth state (guest is enough); room settings if creating |
| **Components** | Quick Match card · PIN input · create panel · rules strip · your record `[NEW]` |
| **States** | Signed out · guest · signed in · **cloud disabled** (honest empty state) · no opponents available |
| **Success** | User lands in a room within 2 actions |
| **Error** | `BF001` no room · `BF003` full · `BF004` started · `BF010` 3 rooms open — all already mapped to copy |
| **Exits** | `/battle/:pin` · `/ranks` |

**Quick Match resolves this order:**
1. Public lobby with space → join it
2. None available → open a public room and wait, **with a visible timer and an exit**
3. Nobody arrives in 60s → offer a time trial against your own PB

Step 3 matters. A user who asked to compete must never end at a dead stop.

> **Security constraint (TRD §B.13):** `battle_rooms` is member-scoped *specifically* so a client cannot walk the PIN space. Quick Match must use a definer RPC returning curated public rooms — it must **never** accept a PIN as input, and the table policy must not be loosened.

---

## 2.16 Matchmaking — Moment (transient)

| | |
|---|---|
| **Purpose** | Hold attention honestly while finding an opponent |
| **Entry** | Quick Match |
| **Goal** | Get matched, or leave without feeling stuck |
| **Primary CTA** | Cancel — always available, always visible |
| **Secondary** | Practise while waiting `[NEW P1]` |
| **Required info** | Elapsed wait, searchers online if known |
| **Components** | Status line · elapsed timer · cancel |
| **States** | Searching · found · none-available · cancelled |
| **Success** | Routed to `/battle/:pin` |
| **Error** | Network → clear failure, retry offered |
| **Exits** | Room · back to `/battle` · time-trial fallback |

**Never fake activity.** No fabricated "1,247 players online." The existing leaderboard code already refuses to invent rivals (`Achievements.jsx:38` — *"A fake ranking is worse than an honest empty one"*); matchmaking inherits that standard.

**Practise while waiting** is the best answer to an empty queue: the user gets value either way, and a found match interrupts with a countdown.

---

## 2.17 Battle lobby `/battle/:pin` (phase: lobby) — Console-lite

| | |
|---|---|
| **Purpose** | Assemble players and start |
| **Entry** | Create · join by code · invite link · Quick Match |
| **Goal** | Host: start when ready. Player: know it is real and wait briefly |
| **Primary CTA** | Host → **Start match** (disabled under 2 players). Player → none; waiting is the state |
| **Secondary** | Copy code · copy invite link · kick (host) · leave · close room (host) |
| **Required info** | PIN, roster, capacity, difficulty, time limit, connection state |
| **Components** | Large PIN + copy · invite link · settings list · seat grid · connection indicator |
| **States** | Waiting (<2) · ready (≥2) · full · host vs. player · reconnecting |
| **Success** | Host starts; all clients transition to countdown together |
| **Error** | `BF006` needs an opponent · host disconnects → succession · room expires |
| **Exits** | Countdown · leave → `/battle` |

**Preserve** (`BattleRoom.jsx` Lobby is already good): the oversized copyable PIN, the empty-seat grid making capacity legible, the live connection state, and the line *"The passage stays hidden until the countdown starts — nobody gets to read ahead."* That sentence does real work — it makes fairness **visible**, which is PRD CP-U1.

**Add:** per-player ready state, and an ambient sound or motion cue when someone joins so the host does not have to watch the screen.

---

## 2.18 Battle countdown — **Moment**

| | |
|---|---|
| **Purpose** | Synchronise attention and hands |
| **Entry** | Host presses Start |
| **Goal** | Be ready at GO |
| **Primary CTA** | None — this is a held breath |
| **Secondary** | **None. Nothing is clickable** |
| **Required info** | `starts_at`, clock offset |
| **Components** | Full-bleed overlay · giant numeral · "Hands on the home row" |
| **States** | 3 · 2 · 1 · GO · reduced-motion variant |
| **Success** | Every client begins within the propagation budget |
| **Error** | Passage not yet fetched → "Fetching the passage…" holds the countdown |
| **Exits** | Automatically to racing |

**Preserve exactly.** The 3.5s window is 3 visible beats plus 0.5s propagation budget, and every client derives its countdown from server `starts_at`, not a local timer (`RaceView.jsx:100-114`). `aria-live="assertive"` is already correct.

**Input is gated at the engine level** (`gated`, `armed.current`) — not a UI promise. Nothing gets through before GO, not Backspace, not Tab. Preserve this: it is what makes "you cannot type during the countdown" structural.

---

## 2.19 Live battle — **Stage**

| | |
|---|---|
| **Purpose** | Type under pressure while sensing rivals peripherally |
| **Entry** | Countdown ends |
| **Goal** | Finish clean and fast |
| **Primary CTA** | None — typing is the interaction |
| **Secondary** | None during the race. Forfeit only via leaving |
| **Required info** | Passage, own live stats, rival positions, time remaining, connection |
| **Components** | Passage stage · progress bar · compact live stats · **race track** · scoring reminder · connection state |
| **States** | Racing · finished-waiting · submitting · disconnected · deadline reached |
| **Success** | Result submitted; room settles; results appear |
| **Error** | Submit fails → toast, room still settles on the server deadline |
| **Exits** | Automatically to results |

**Attention hierarchy is the whole design problem here:**

| Rank | Element | Treatment |
|---|---|---|
| 1 | Your passage | Full contrast, centre, largest |
| 2 | Your caret | The only moving thing in the reading path |
| 3 | Your progress | Thin bar directly under the stage |
| 4 | Rivals | **Peripheral** — right column, low contrast, no motion that pulls the eye |
| 5 | Time remaining | Small, monospace, fixed position |
| 6 | Connection | Smallest; only prominent when *bad* |

**Preserve the architecture:** rival ticks flow through a ref and an animation frame, never React state (`useBattleRoom.js:22-29`). Routing them through state would multiply typing-tree re-renders by eight — a direct input-latency hazard.

**Preserve the "Finished — waiting for the others" state.** A frozen screen after finishing is a common failure in racing products; this already handles it.

---

## 2.20 Battle result — **Moment**

| | |
|---|---|
| **Purpose** | Say who won **and why**, then offer the next match |
| **Entry** | Room settles |
| **Goal** | Understand the outcome; go again |
| **Primary CTA** | **Rematch** `[NEW]` — same players, no code re-sharing |
| **Secondary** | Play again (new room) · leave · share result `[NEW]` · view ranks |
| **Required info** | Ordered results, own row, flags, match stats |
| **Components** | Headline · **"why" line** · podium · full table · match stats |
| **States** | Won · placed · DNF · settling · flagged · only-run |
| **Success** | User rematches or starts another |
| **Error** | Results fail to load → distinguishes "loading" from "none recorded" (already correct via `results === null`) |
| **Exits** | Rematch · `/battle` · `/ranks` · `/home` |

**`whyWon()` is the best piece of UX in the current codebase and must be elevated, not preserved-in-place.** Ranking is mistakes-first, so a 45 WPM run beats a 56 WPM run with two typos — correct by the rules and baffling if you only see a table. The function walks the same comparison order the SQL uses and names the criterion that actually decided it (`ResultsView.jsx:216-236`).

It currently renders as a small grey subtitle. **Make it the second-largest element on the screen.** It is the difference between a scoreboard and an explanation.

**Flagged results must be visible** (TRD CH-1). They are recorded in `battle_results.flags` and currently surface only as a hover title.

---

## 2.21 Rematch `[NEW]`

| | |
|---|---|
| **Purpose** | Remove all friction from "again" |
| **Entry** | Battle result |
| **Goal** | Race the same people immediately |
| **Primary CTA** | Rematch |
| **Secondary** | Change settings first · new opponents |
| **States** | Offered · waiting for others to accept · accepted · declined/expired |
| **Success** | New room, same roster, straight to lobby or countdown |
| **Error** | Not enough players accept → falls back to a normal lobby |
| **Exits** | New room · `/battle` |

**Design:** the winner does not decide. **Anyone can propose; the room shows who has accepted.** At ≥2 acceptances the host (or proposer) can start. This avoids the losing player being held hostage by the winner's decision.

> Requires a new RPC that re-runs every check `battle_create` runs — it must not become a way to bypass the 3-room-per-host cap (TRD BS-4).

---

## 2.22 Leaderboards `/ranks` — Ledger

| | |
|---|---|
| **Purpose** | Show where you stand among real people |
| **Entry** | Compete tab · profile card · battle result |
| **Goal** | Find my position and who is near me |
| **Primary CTA** | Climb — routes to Quick Match |
| **Secondary** | Switch board (XP / Skill / window) · opt out |
| **Required info** | Board rows, own row |
| **Components** | Board switcher · ranked list · **own row pinned** · own-rank callout when outside the visible range |
| **States** | Live · signed out (board of one, honest) · opted out (private rank shown) · offline · empty |
| **Success** | User finds their position without scrolling |
| **Error** | Fetch fails → honest empty, never fabricated |

**Preserve:** the four-column exposure (`display_name`, `avatar`, `xp`, `rank`) — ranking never requires exposing a profile — the opt-out, and the local fold-in that makes your own XP move the instant you earn it.

**Fix (TRD LB-1):** row keys must not be name-only. Production already has two players called "Meow" (`Achievements.jsx:151-154`); a name-only key makes React reconcile the wrong rows and can move the "you" highlight onto a stranger.

**Add:** XP and Skill as clearly separate boards. XP measures effort; skill measures skill. Never conflate them in copy (PRD XP-3).

---

## 2.23 Rankings — the skill board `[NEW P1]`

| | |
|---|---|
| **Purpose** | Rank by demonstrated skill, not accumulated volume |
| **Entry** | `/ranks` board switcher · battle result |
| **Goal** | Know my competitive standing |
| **Primary CTA** | Play a ranked match |
| **Secondary** | Rating history · tier explanation |
| **Required info** | Rating, games played, tier, recent change |
| **Components** | Rating figure · tier badge · delta since last match · placement progress |
| **States** | **Unplaced** (needs N matches) · placed · rising · falling · provisional |
| **Success** | User understands their rating and how to change it |
| **Error** | Rating unavailable → show XP board with an explanation |

**Rating must be explained wherever it is shown.** A number a user cannot reason about is worse than no number. Minimum: "+18 · beat 3 of 4 opponents."

Derived from `battle_results.wpm`, which is **server-recomputed** — the only trustworthy speed figure in the system. Flagged results are excluded (TRD CH-3).

---

## 2.24 Achievements `/progress/awards` — Gallery

| | |
|---|---|
| **Purpose** | Show what has been earned and what is close |
| **Entry** | Progress tab · result unlock · profile |
| **Goal** | See progress and find a reachable next goal |
| **Primary CTA** | Pursue the nearest unlock |
| **Secondary** | Filter by tier/category · view level ladder · missions |
| **Required info** | 19 achievements, unlock dates, level, XP, missions |
| **Components** | Level ring + ladder · missions · badge grid |
| **States** | None unlocked · partial · all · **newly unlocked (highlighted)** |
| **Success** | User leaves toward the surface that completes something |
| **Error** | None — fully local |

**Add (PRD AH-4):** progress toward multi-step achievements. "Syntax Native — 7/10 snippets" is motivating; a locked padlock is not. `ACHIEVEMENTS[].test` is a boolean predicate today; an optional `progress()` alongside it is additive, so existing entries need no change.

**Every locked badge states its condition** — already true (`hint`), and must stay true.

---

## 2.25 User profile — see §2.6

Public profile view is `[NEW P1]`: display name, avatar, level, best WPM, achievement count, competitive record. **No private data** — same discipline as the leaderboard view.

---

## 2.26 History `/progress/history` — Ledger `[NEW as a surface]`

| | |
|---|---|
| **Purpose** | The complete record |
| **Entry** | Progress tab · "see all" from Home or Progress |
| **Goal** | Find a specific run; see totals |
| **Primary CTA** | None — reading is the goal |
| **Secondary** | Filter by mode/language/date · sort · export `[P2]` |
| **Required info** | Session list |
| **Components** | Filter bar · dense table · totals row · pagination |
| **States** | Empty · few · many · filtered-to-nothing |
| **Success** | User finds the run they were looking for |
| **Error** | None |

**Must state the 400-session cap** (`store.jsx:46`). Silent truncation is dishonest (PR-2). Copy: *"Showing your most recent 400 sessions. Totals above include everything."* — and the totals genuinely must, since XP and streak are stored aggregates unaffected by the cap.

---

## 2.27 Settings — a section of Profile, not a route

| Group | Contents | Where |
|---|---|---|
| Identity | Name, avatar | Profile top |
| Appearance | Theme, typing font size `[NEW]` | Profile |
| Typing | Sound, caret style, smooth caret, keyboard viz, blind mode, stop-on-error, hand guide | Profile **and** the in-Stage settings modal |
| Content | AI text on/off, default difficulty, default language | Both |
| Goals | Daily goal | Profile |
| Privacy | Leaderboard opt-out, data deletion `[NEW]` | Profile |
| Account | Sign in/out, upgrade | Profile |

**Typing settings appear in two places on purpose.** Changing your caret belongs where you can see the caret. The Profile copy is the canonical list; the in-Stage modal is the fast path. Both write the same state.

---

## 2.28 Notifications

**There is no notification system, and this document deliberately does not add one.** A local-first, offline-capable typing trainer has nothing legitimate to interrupt you with.

What exists instead:

| Mechanism | Purpose | Rule |
|---|---|---|
| Toast | Confirm an action just taken | Never during an active run |
| Inline status | Connection, sync, AI availability | Ambient, never modal |
| Result panel | Achievement + level-up | Part of the Moment, not an interruption |
| Streak indicator | Ambient return hook | Chrome, always visible, never a nag |

**Explicitly rejected:** push notifications, email digests, "come back!" prompts, badge counts. They would contradict PR-1 and the product's no-account promise.

**Deferred to a decision:** an in-app inbox only if rematch invitations or tournaments (Phase 5) create genuinely asynchronous events. Not before.

---

## 2.29 Multiplayer flows

```
                    ┌──── Quick Match ────┐
                    │                     │
  /battle ──────────┼──── Enter code ─────┼────▶ /battle/:pin
     ▲              │                     │           │
     │              └──── Create room ────┘           │
     │                                                ▼
     │                                          ┌──── LOBBY ────┐
     │                                          │  host starts  │
     │                                          └───────┬───────┘
     │                                                  ▼
     │                                            COUNTDOWN (3.5s)
     │                                                  ▼
     │                                              RACING
     │                                                  ▼
     │                                          ┌─── RESULTS ───┐
     └──────────── leave ───────────────────────┤   rematch ────┼──┐
                                                └───────────────┘  │
                                                        ▲          │
                                                        └──────────┘
```

**Phase is derived from `room.status`, never held in client state.** A refresh at any instant reconstructs the correct screen (`useBattleRoom.js:266-276`). This is why there is one route for four screens — a URL cannot disagree with the room.

### Interruption handling

| Event | Behaviour | Status |
|---|---|---|
| Refresh mid-race | Restores phase; checkpoint is the floor | `[EXISTS]` |
| Tab backgrounded | Race continues; re-hydrate on focus | `[EXISTS]` |
| Network drop | Local run continues; submits on reconnect | `[EXISTS]` |
| Close tab mid-race | Recorded forfeit with progress so far | `[EXISTS]` |
| Host leaves lobby | Succession to longest-waiting | `[EXISTS]` |
| Host leaves mid-race | Race continues — admin powers are lobby-only | `[EXISTS]` |
| **Two tabs, same room** | **[U-6] Undefined — must be specified** | `[GAP]` |

---

## 2.30 Future Battlefield mode — extensions

Battlefield exists and is the flagship. Planned extensions, in dependency order:

| Extension | Phase | Depends on |
|---|---|---|
| Rematch | 2 | — |
| Quick Match | 2 | Public room RPC |
| Skill rating | 2 | Server-recomputed WPM (exists) |
| Ready states | 2 | Additive column |
| Spectating | 3 | Read-only room view |
| Ranked seasons | 3 | Rating stability |
| Tournaments | 5 | Spectating + moderation |

**Constraint carried forward:** nothing may assume "one shared passage, everyone finishes." That assumption blocks §2.31.

---

## 2.31 Future stickman combat — flow sketch only

**Not built. This section exists to constrain, not to specify.**

```
/combat ──▶ Find opponent ──▶ Versus screen ──▶ Countdown
                                                    ▼
                                          ┌─── COMBAT ───┐
                                          │ Left: your   │
                                          │  text        │
                                          │ Centre:      │
                                          │  fighters    │
                                          │ Right: rival │
                                          └──────┬───────┘
                                                 ▼
                                            Victory/Defeat
                                                 ▼
                                              Rematch
```

**Flow-level constraints this document imposes now:**

| # | Constraint | Why |
|---|---|---|
| C-1 | The typing surface stays a Stage even with combat animation | If the fighters pull attention from the text, the typing mechanic dies |
| C-2 | Combat visualisation is **peripheral** — the same rank as rivals in §2.19 | Same reason |
| C-3 | There is no "finish the passage" terminal state | Combat ends on defeat, not completion |
| C-4 | Outcome must be server-arbitrated | Client-authoritative combat is unshippable |
| C-5 | Must be expressible in the mode registry without core changes | TRD SC-A5 — this is the acceptance test |

> **Open architectural risk (TRD T-7):** per-hit resolution may be too latency-sensitive for Postgres RPC round-trips, which could require a stateful server — the one future need that breaks the "no application server" constraint. Flagged, not solved.

---

# PART 3 — Cross-cutting states

## 3.1 Error states

| Class | Pattern | Example |
|---|---|---|
| **Recoverable, user-caused** | Inline, beside the input, states the fix | "That code has 5 characters. Codes are 6." |
| **Recoverable, system** | Toast + retry, work preserved | "Could not report your result. Retrying." |
| **Blocking, scoped** | Empty state replacing the region, with an exit | "That Battlefield is not open" |
| **Blocking, global** | Error boundary with recovery | "Something broke mid-keystroke" |
| **Silent** | Fallback, no UI at all | AI passage fails → bundled text |

**The silent class is the most important and the least obvious.** AI failures during typing must never surface an error, because an error dialog over a typing surface is a worse outcome than slightly less interesting text (PR-3). This is already the behaviour (`Practice.jsx:123-125`) and must be preserved.

**Every error message must state what to do next.** The `BATTLE_ERROR_COPY` table already meets this bar — including remapping Postgres's `42501` ("permission denied for function battle_room_by_pin") to "Sign in first," because the raw message is *"true and useless"* (`api.js:41-43`). That standard applies to all new errors.

## 3.2 Empty states

| Screen | Empty state | Required action |
|---|---|---|
| Home | "Your first run sets the baseline" | Start a 60s run |
| Progress | "One 60-second run is enough to draw the first chart" | Start a session |
| History | "Finished runs land here" | Start a session |
| Awards | "The first badge unlocks the moment you finish a run" | Show the 4 nearest |
| Leaderboard | Board of one, honestly labelled | Sign in / compete |
| Weak keys | "No key has enough misses to call it a weakness yet" | Keep going |
| Battle lobby | Empty seats rendered explicitly | Copy the code |
| Quick Match | "Nobody is waiting right now" | Open a room / time trial |
| Custom text | Instructional placeholder | Paste |

**Three rules.** An empty state must (1) explain what will fill it, (2) say how, (3) offer that action as a control. The existing Dashboard empty state (`Dashboard.jsx:68-86`) is the reference implementation.

**Never fabricate.** No sample charts, no fake leaderboard entries, no demo sessions.

## 3.3 Loading states

| Duration | Treatment |
|---|---|
| < 100ms | Nothing |
| 100–500ms | Inline spinner on the control that triggered it |
| 500ms–3s | Skeleton matching the final layout |
| > 3s | Skeleton + explanation of what is happening |
| Indeterminate | Progress + cancel |

**Special case — regenerating a passage.** The old passage stays readable under a shimmer sweep rather than being replaced by a skeleton, so you can keep typing the current exercise right up until the new one lands (`index.css:185-201`). This is exactly right and generalises: **never replace usable content with a skeleton.**

**Never block typing on a load.** Bundled content renders immediately; AI content swaps in if it arrives, and is ignored if a run has already started.

## 3.4 Offline / network failure

| Capability | Offline |
|---|---|
| Practice, code typing, all modes | ✅ Full |
| Stats, history, achievements, XP, streaks | ✅ Full |
| Settings, profile, avatar | ✅ Local |
| AI passages/snippets | ⚠️ Bundled fallback, silent |
| Coach read | ⚠️ Locally computed, labelled `offline` |
| Battlefield | ❌ Requires network — stated honestly |
| Leaderboard | ❌ Board of one |
| Sync | ⏸ Resumes on reconnect |

**Offline is not an error state.** No banner, no warning, no degraded-mode chrome. The app behaves normally; the few cloud surfaces state their own unavailability where they live.

**Reconnection is silent.** Sync resumes on the `online` event (`sync.js:480-488`); no announcement is warranted for something the user did not ask for.

**Critical invariant:** a device that cannot *read* stays read-only. `sync.js:448-453` documents why — a push after a failed pull *"zeroed a real account's XP from 790 to 0 during testing."* The `hydratedRef` gate must never be removed.

## 3.5 Authentication failure

| Failure | Behaviour |
|---|---|
| Wrong credentials | Generic message. **Never** reveal whether the account exists |
| Unconfirmed email | Explain + offer resend |
| OAuth cancelled | Silent return, no error |
| OAuth fails | Fall back to the email form |
| Session expired | Silent refresh; if it fails, sign-in prompt explaining why |
| Anonymous sign-in disabled | **Silent** local-only fallback (already correct) |
| Guest sign-out | Explicit confirm — data is irrecoverable |
| **Google when email exists** | **[U-7] Undefined — must be specified** |
| Cloud unconfigured | No auth UI renders at all |

**Auth failure never blocks the app.** Every core capability works signed out. The only surface that genuinely requires an account is Battlefield, and a guest account is one tap away.

---

# PART 4 — Journeys

## 4.1 New-user journey

```
  STRANGER
     │
     ▼
  Landing ─────────────────────────────── [Marquee]  10s
     │  presses a key in the hero
     ▼
  Inline 30s run ──────────────────────── [Stage]    30s
     │
     ▼
  "62 WPM · 94% · your ; costs you 18%" ─ [Moment]   10s
     │
     ├─── Skip ───────────────────────┐
     ▼                                │
  Name → goal → focus ──────────────── [Sheet]  30s
     │                                │
     ▼                                ▼
  Chosen surface ◀───────────────────┘        [Stage]
     │
     ▼
  Run 2, 3, 4 …
     │
     ▼
  Home ─────────────────────────────── [Console]
     "Streak: 1 day. Tomorrow makes it 2."
```

**Time to value: ~40 seconds**, and the value is delivered before any question is asked.

**Design targets:** first keystroke ≤ 1 action · baseline before any question · signup never required · streak established before session 1 ends.

**Failure modes to design against:** landing that explains instead of demonstrating · questions before value · empty Home after onboarding (mitigated by the baseline run producing real data).

## 4.2 Returning-user journey

```
  Opens app (PWA, bookmark, tab)
     │
     ▼
  /  ──auto──▶  /home ─────────────── [Console]  5s
     │
     │  reads ONE thing: the Next-Action banner
     │  "Drill ; — costing you 18%"
     ▼
  /practice?mode=drill&keys=; ─────── [Stage]
     │
     ▼
  Run ──▶ Result ──Enter──▶ Run ──▶ Result ──▶ …
     │
     ▼
  Missions done · streak extended
     │
     ▼
  Optional: Compete · Progress
```

**Target: 1 action from open to typing.**

**The Next-Action banner is what makes this work.** Without it, a returning user faces a dashboard and must decide — and deciding is friction. With it, the product has already decided, using the diagnosis it computed from their own data.

**Habit reinforcement, in order of honesty:** streak visible in chrome · today's ring on Home · missions refresh daily · trend confirms improvement weekly. **No nagging, no notifications, no dark patterns.**

## 4.3 Competitive journey

```
  Home / Compete tab
     │
     ▼
  /battle ──────────────────────────── [Console-lite]
     │
     ├── Quick Match ──▶ Matchmaking ──┐
     ├── Enter code ───────────────────┤
     └── Create + share ───────────────┤
                                       ▼
                              /battle/:pin  LOBBY
                                       │  host starts
                                       ▼
                              COUNTDOWN  3·2·1·GO ── [Moment]
                                       ▼
                              RACING ─────────────── [Stage]
                                       ▼
                              RESULTS ────────────── [Moment]
                              "Won on mistakes — 0 against 2."
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
                 Rematch            /ranks             /home
                    │
                    └──▶ back to COUNTDOWN
```

**Entry friction:** invited = 2 actions (already achieved) · Quick Match = 2 actions (new) · with a code = 2 actions.

**The retention loop is Result → Rematch.** It must be one click and must not require re-sharing a code. Everything else in the competitive journey is already built.

## 4.4 Invited-stranger journey — the highest-conversion path

```
  Receives link  typeforge.app/battle/K7M2QX
     │
     ▼
  Lands on the room ──────────── "You have been invited"
     │                           Battlefield K7M2QX
     │                           "A name is enough — no email needed"
     │
     ▼  ONE TAP: Enter the Battlefield
     │
  Guest account minted · joined · lobby
     │
     ▼
  Race ──▶ Results ──▶ "Keep this profile?" ──▶ upgrade offer
```

**Two taps from a cold link to racing.** This already works (`BattleRoom.jsx:120-161`) and is the best-converting flow in the product.

**The one addition:** offer the account upgrade *after* the race, not before. A user who has just competed has a reason to keep the result; a user who has not, does not.

## 4.5 Critical conversion paths

| # | Path | Metric | Today | Target |
|---|---|---|---|---|
| **1** | Landing → first keystroke | Activation | n/a | ≥ 40% |
| **2** | First run → second run | Loop entry | unmeasured | ≥ 70% |
| **3** | Session 1 → day 2 return | Retention | unmeasured | ≥ 40% |
| **4** | Result → drill weak keys | **Diagnosis loop** | ~0% (buried) | ≥ 25% |
| **5** | Solo → first battle | Competitive activation | **impossible** | ≥ 20% |
| **6** | Battle → rematch | Competitive retention | n/a | ≥ 50% |
| **7** | Guest → account | Portability | unmeasured | ≥ 30% |
| **8** | Local → signed-in | Sync | unmeasured | ≥ 25% |

**Paths 4 and 5 are where this redesign earns its cost.**

Path 4 is the product's whole thesis — measure, diagnose, drill — and it currently converts near zero because the weak-key drill is a small secondary button on a screen most users never open. Moving it into the Result Moment and the Home banner is the single highest-leverage change in this document.

Path 5 is currently **impossible**: without a code from another human, a user cannot compete. Quick Match creates the path.

---

# PART 5 — Mobile and keyboard flows

## 5.1 Mobile flows

> **Blocked on U-4.** Whether typing works on a phone has not been tested. `useTypingEngine` captures `keydown` and ignores `key.length !== 1`, with no `compositionstart`/`compositionend` handling — on-screen keyboards, autocorrect and IME may not produce usable events. **This must be established before the mobile scope is fixed.**

**Recommended posture (PRD MO-5 option B): mobile as a first-class companion, typing determined by the finding.**

| Surface | Mobile | Notes |
|---|---|---|
| Landing | ✅ Full | Must be excellent — most shared links open on a phone |
| Home | ✅ Full | Stacked, next-action banner first |
| Progress / History / Awards | ✅ Full | Charts scroll horizontally in their own container |
| Profile | ✅ Full | |
| Leaderboards | ✅ Full | |
| Battle lobby | ✅ Full | Code copy is the key action |
| **Battle results** | ✅ Full | People check results on a phone |
| **Practice / Code / Race** | ⚠️ **Pending U-4** | If unsupported: state it honestly, offer to send a link to desktop |

**Layout requirements regardless of the finding:** 360–2560px with no horizontal page scroll · touch targets ≥ 44px · bottom tab bar ≥ 5 items and ≤ 8 · charts scroll inside `overflow-x` containers · orientation change never breaks layout.

**If typing is unsupported on mobile, say so where the user would attempt it** — not after they have tried and failed. An honest limitation is better than a half-working Stage (PR-2).

## 5.2 Keyboard-only navigation

**This product's users are keyboard users. Keyboard navigation is a primary interface, not an accessibility checkbox.**

### Global

| Key | Action |
|---|---|
| `⌘/Ctrl + K` | Command palette — reaches everything |
| `⌘/Ctrl + \` | Toggle rail |
| `Tab` / `Shift+Tab` | Move focus |
| `Escape` | Close overlay / leave focus mode |
| `?` | Shortcut reference `[NEW]` |

### In Stage

| Key | Action |
|---|---|
| Any printing key | Start typing |
| `Backspace` | Correct |
| `Ctrl/Alt + Backspace` | Delete word |
| `Tab` | **Indentation, never focus navigation** |
| `Enter` | Newline in the passage |
| `Escape` | Exit focus mode without resetting the run |

### In Result

| Key | Action |
|---|---|
| `Enter` | Next exercise |
| `R` | Retry |
| `D` | Drill weak keys `[NEW]` |
| `Escape` | Dismiss |

**The Result keyboard contract is what makes the tight loop possible:** type → `Enter` → type → `Enter`. Zero mouse in the highest-frequency cycle in the product.

### Requirements

| # | Requirement |
|---|---|
| K-1 | Every function reachable by keyboard alone |
| K-2 | Visible focus on every interactive element (already global, `index.css:114`) |
| K-3 | Focus order matches visual order |
| K-4 | Modals trap focus and **restore it on close** |
| K-5 | Skip-to-content first in the tab order (already present) |
| K-6 | `Tab` inside the Stage never escapes it |
| K-7 | Shortcuts discoverable — `?` overlay and palette hints |
| K-8 | No shortcut conflicts with browser or screen-reader defaults |

**K-6 is subtle and load-bearing.** `Tab` is a character in code typing. It must be consumed by the Stage, and the Stage must offer another way out (`Escape`, or `Shift+Tab` from the first control) so a keyboard user is never trapped.

---

## Appendix A — Screen index

| # | Screen | Route | Archetype | Status |
|---|---|---|---|---|
| 1 | Landing | `/` | Marquee | `[NEW]` |
| 2 | First-visit flow | `/` → `/home` | Flow | `[NEW]` |
| 3 | Sign-up | overlay | Sheet | `[EXISTS]` |
| 4 | Login | overlay | Sheet | `[EXISTS]` |
| 5 | Onboarding | overlay | Sheet | `[CHANGED]` |
| 6 | Profile | `/profile` | Sheet | `[CHANGED]` |
| 7 | Home | `/home` | Console | `[CHANGED]` |
| 8 | Practice | `/practice` | **Stage** | `[CHANGED]` |
| 9 | Custom practice | `/practice?mode=custom` | Stage | `[EXISTS]` |
| 10 | Code practice | `/code` | **Stage** | `[CHANGED]` |
| 11 | Configuration | in-Stage | — | `[CHANGED]` |
| 12 | Result | inline | **Moment** | `[CHANGED]` |
| 13 | Analysis | `/progress` | Console | `[CHANGED]` |
| 14 | Progress tracking | cross-cutting | — | `[EXISTS]` |
| 15 | Battle discovery | `/battle` | Console-lite | `[CHANGED]` |
| 16 | Matchmaking | `/battle` | Moment | `[NEW]` |
| 17 | Lobby | `/battle/:pin` | Console-lite | `[EXISTS]` |
| 18 | Countdown | `/battle/:pin` | **Moment** | `[EXISTS]` |
| 19 | Live battle | `/battle/:pin` | **Stage** | `[EXISTS]` |
| 20 | Battle result | `/battle/:pin` | **Moment** | `[CHANGED]` |
| 21 | Rematch | `/battle/:pin` | — | `[NEW]` |
| 22 | Leaderboards | `/ranks` | Ledger | `[CHANGED]` |
| 23 | Rankings | `/ranks` | Ledger | `[NEW]` |
| 24 | Achievements | `/progress/awards` | Gallery | `[CHANGED]` |
| 25 | User profile | `/profile` | Sheet | `[CHANGED]` |
| 26 | History | `/progress/history` | Ledger | `[NEW]` |
| 27 | Settings | `/profile` | Sheet | `[CHANGED]` |
| 28 | Notifications | — | — | **Rejected** |
| 29 | Multiplayer flows | `/battle/*` | — | `[EXISTS]` |
| 30 | Future Battlefield | — | — | `[FUTURE]` |
| 31 | Stickman combat | `/combat` | — | `[FUTURE]` |
| 32–36 | Cross-cutting states | — | — | Part 3 |
| 37 | Mobile | — | — | Part 5.1 |
| 38 | Keyboard | — | — | Part 5.2 |

## Appendix B — Verification

| Check | Result |
|---|---|
| All 38 requested items covered | ✅ Appendix A |
| Every screen has all 12 specified fields | ✅ Part 2 |
| Global sitemap, nav hierarchy, screen hierarchy | ✅ §1.1–1.3 |
| Four journeys + conversion paths | ✅ Part 4 |
| Every route in `App.jsx` accounted for or redirected | ✅ §1.1 |
| `[EXISTS]` claims traced to files read | ✅ |
| Typing surface protected from dashboard creep | ✅ §0.2, §2.8 Stage contract |
| Friction explicitly budgeted | ✅ §0.3 |
| Unknowns flagged, not invented | ✅ U-4, U-6, U-7 |
