# TypeForge — Technical Requirements Document

**Version:** 1.0
**Date:** 2026-08-23
**Depends on:** `00-codebase-audit.md`, `01-PRD.md`
**Baseline:** `main` @ `d1d2ed9` · branch `typeforge`
**Audience:** senior engineers implementing the transformation

---

## How to read this document

**Part A** audits what exists. Every statement is traced to a file I opened. Unverified items are quarantined in §A.16.

**Part B** defines the target. Every architectural change carries a **change record**:

> **Why needed** · **Reuse** · **Change** · **Do NOT change** · **Risk** · **Complexity**

Complexity is **S** (< 1 day), **M** (1–3 days), **L** (3–10 days), **XL** (> 10 days) for one senior engineer.

**Governing constraint:** this is a static bundle on Vercel with Postgres as the only trusted compute. Every design below respects that unless it explicitly proposes changing it — and only one section does (§B.3, the AI proxy), for a stated security reason.

---

# PART A — Current architecture audit

## A.1 System architecture

```
┌──────────────────────────────────────────────────────────┐
│ BROWSER                                                   │
│                                                           │
│  React 18 SPA (Vite bundle, static)                       │
│    ├── localStorage  ← source of truth                    │
│    ├── @supabase/supabase-js                              │
│    └── fetch → AI providers  ⚠ keys in bundle             │
└───────────┬───────────────────────────┬──────────────────┘
            │                           │
            ▼                           ▼
┌───────────────────────────┐  ┌────────────────────────────┐
│ VERCEL (static + SPA      │  │ AI PROVIDERS               │
│ rewrite-all to index.html)│  │ hcnsec (p1) · OpenRouter   │
└───────────────────────────┘  └────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│ SUPABASE                                                  │
│  ├── GoTrue        email · Google OAuth · anonymous        │
│  ├── PostgREST     table access, RLS-gated                 │
│  ├── Realtime      Postgres Changes + Broadcast            │
│  └── Postgres      ← ALL server logic lives here           │
│        RLS policies · 15 SECURITY DEFINER RPCs · views     │
└──────────────────────────────────────────────────────────┘
```

**There is no application server.** `battle/api.js:5-10` states it directly: *"There is no HTTP API to wrap — the app is a static bundle with no backend, so 'the server' is Postgres."*

**Three independent degradation tiers,** all gated at module load:

| Tier | Gate | Behaviour |
|---|---|---|
| Full | `SUPABASE_ENABLED && AI_ENABLED` | Everything |
| No AI | `AI_ENABLED = false` or no key | Bundled content; every AI surface has a fallback |
| No cloud | `SUPABASE_ENABLED = false` | `supabase` is `null`; no cloud UI renders at all |

`config.js:112` — `SUPABASE_ENABLED = Boolean(url && anonKey)`. `supabase.js:16` returns `null` when false, and **every consumer null-checks**. This is the discipline that makes offline-first real rather than aspirational.

---

## A.2 Frontend architecture

### Provider tree — `src/main.jsx`
```
StrictMode → ErrorBoundary → ThemeProvider → AuthProvider
  → StoreProvider → ToastProvider → BrowserRouter → App
```
Ordering is load-bearing and documented in-file: `AuthProvider` is outside `StoreProvider` because the store's sync side-channel reads the user from it; `ToastProvider` is inside both so a sync failure can raise a toast.

### Routing
`react-router-dom` v6. 12 routes, **all lazy** (`App.jsx:8-18`), one `<Suspense>` with a shared skeleton. Manual chunks in `vite.config.js`: `react`, `charts`, `motion`.

### Directory shape
```
src/
  components/
    battle/    PinInput
    brand/     Logo              ← single source for favicon + PWA icons
    charts/    Charts · ChartFrame · palette
    gamify/    MissionStrip
    layout/    AppShell · ChatFab · CommandPalette · ErrorBoundary · ThemeToggle
    typing/    TypingStage · useTypingEngine · KeyboardViz · HandGuide ·
               LiveStats · SessionSummary · WeakKeyStrip
    ui/        13 primitives (Button, Modal, Toast, Select, …)
  lib/         24 modules — engine maths, store, sync, auth, AI, battle, content
  modules/     11 route modules
```
Layering is clean: `modules/` → `components/` → `lib/`. No inverted dependencies found.

### Styling
Tailwind 3.4 with a **custom-only** spacing scale (8px grid, `tailwind.config.js:7-12`) and a custom `fontSize` scale carrying per-step letter-spacing. Colour tokens are CSS custom properties stored as `R G B` triplets so Tailwind's `<alpha-value>` opacity modifiers work (`index.css:15-52`).

Dark mode is a **selected** palette, not an inversion, with contrast ratios recorded per token in comments (`--ink-2` 7.7:1, `--ink-3` 4.7:1, `--brand` 11.5:1).

Component classes: `.card`, `.glass`, `.liquid-glass`, `.glow-panel`, `.aurora`, `.shimmer-sweep`, `.grad-text`, `.eyebrow`, `.pop-in`.

---

## A.3 Backend architecture

**Postgres is the backend.** Three enforcement layers:

**1. RLS as the boundary.** Every table has RLS enabled. Base shape is `auth.uid() = user_id`; admin adds an *additive* `select` policy (Postgres ORs same-command policies, so neither weakens the other — documented at `0002:40-43`).

**2. `SECURITY DEFINER` helpers to break RLS recursion.** `is_admin()` (`0002`), `in_battle()`, `is_battle_admin()`, `battle_started()` (`0009`). A policy on `battle_players` that queried `battle_players` would re-enter its own RLS; definer rights break the cycle.

**3. RPCs as the write API for Battlefield.** `battle_rooms` and `battle_results` have **no** insert/update policy at all. `battle_players` has exactly one narrow update policy (own progress, while racing). Everything else is a definer function. `0009:16-21` states the reasoning: with no backend to place in front of the database, plpgsql is the only trusted compute, so leaving no client write path makes that true *by construction rather than by convention*.

### Function inventory (`0009`)

| Function | Purpose | Grant |
|---|---|---|
| `battle_server_time()` | Shared clock reference | `authenticated` |
| `battle_create(...)` | Mint PIN, insert room + passage + host | `authenticated` |
| `battle_join(pin)` | Capacity check under `FOR UPDATE` | `authenticated` |
| `battle_leave(room)` | Forfeit + admin succession | `authenticated` |
| `battle_kick(room, user)` | Host-only, lobby-only | `authenticated` |
| `battle_start(room)` | Idempotent; writes `starts_at` | `authenticated` |
| `battle_touch(room)` | Lazy countdown→active flip | `authenticated` |
| `battle_finish(...)` | **Recomputes WPM server-side**, flags cheats | `authenticated` |
| `battle_abort(room)` | Host cancel | `authenticated` |
| `battle_room_by_pin(pin)` | Resolve without granting select-by-pin | `authenticated` |
| `battle_passage(room)` | Gated on started | `authenticated` |
| `battle_leaderboard(room)` | Member-scoped results | `authenticated` |
| `battle_mint_pin()` | Internal | **revoked from all** |
| `battle_reap()` | Internal janitor | **revoked from all** |
| `battle_settle(room)` | Internal ranking | **revoked from all** |
| `battle_maybe_settle(room)` | Internal | **revoked from all** |

The four internal functions are revoked even from `authenticated` — otherwise any signed-in user could call `battle_settle(<room>)` on a match they are not in and force it to end mid-race (`0009:800-807`).

**The `REVOKE` before `GRANT` is load-bearing and easy to omit.** Postgres grants `EXECUTE` to `PUBLIC` on every new function, so `GRANT ... TO authenticated` alone changes nothing. The file records that before the revoke, `set role anon` could call `battle_room_by_pin` and get a room back.

---

## A.4 Database / storage

### Tables

| Table | Migration | Purpose | Live? |
|---|---|---|---|
| `profiles` | 0001, +0007 | Identity, XP, streak, settings, avatar | ✅ |
| `sessions` | 0001 | Append-only run history | ✅ |
| `daily_stats` | 0001 | Rollup for admin | ✅ (write-only from client) |
| `key_stats` | 0001 | Per-key accuracy | ✅ |
| `achievements` | 0001 | Unlock dates | ✅ |
| `learn_progress` | 0001 | — | ☠️ **dead** (writer deleted `d1d2ed9`) |
| `problem_progress` | 0001 | — | ☠️ **dead** (`store.jsx:19-22`: "Nothing writes this yet") |
| `user_roles` | 0002 | Admin role | ✅ |
| `auth_events` | 0002 | Auth telemetry | ✅ |
| `ai_usage` | 0002 | AI telemetry (client-reported) | ✅ |
| `chat_messages` | 0003 | Coach threads | ✅ |
| `beta_votes` | 0003 | — | ☠️ **dead** (client deleted) |
| `battle_rooms` | 0009 | Room state | ✅ |
| `battle_passages` | 0009 | Passage, access-gated | ✅ |
| `battle_players` | 0009 | Roster + checkpoints | ✅ |
| `battle_results` | 0009 | Immutable results | ✅ |

Views: `admin_daily` (invoker), `leaderboard` (definer, narrow), `beta_vote_tally` (definer, dead).

### Session identity — two migrations of scar tissue
`0006` and `0008` exist because the original client-computed `client_id` hashed `ts` and `wpm` *as they appeared locally*, and neither survives a round trip: `ts` returns in Postgres format, `wpm` is a `real` column so `219.35483870967741` returns `219.355`. A pulled session hashed differently than it went up, `on conflict` never matched, and **every pull-then-push cycle duplicated the entire history**.

Final identity is `(user_id, ts)` — a unique index on plain columns, which PostgREST can also name as a conflict target. `sync.js:71-76` additionally normalises the hash (epoch ms, WPM quantised to one decimal as an integer), and `client_id` is retained only because older rows are keyed by it.

**This is the single most fragile area of the data layer. Any change to session writing must not reopen it.**

### Client storage

| Key | Owner | Shape |
|---|---|---|
| `keystroke.state.v2` | `store.jsx:9` | Whole app state |
| `keystroke.chat.v2` | `chatStore.js:16` | Chat threads |
| `keystroke.theme` | `theme.jsx:3` + `index.html:34` | Theme choice |
| `keystroke.rail.pinned` | `AppShell.jsx:68` | Rail state |
| `keystroke.adopted` | `sync.js:28` | Adoption marker |
| `keystroke.code.introOpen` | `IntroPanel.jsx:9` | Panel state |

`storage.js` wraps every access in try/catch. The file header explains why: Safari private mode, blocked third-party storage and full quota all throw *from a bare read*, and those throws happened during render and module init — producing a blank page rather than an app that forgets things.

`store.jsx:48-64` shallow-merges the loaded state over `EMPTY`, so a field added in a later version gets its default. Persistence is debounced 220 ms; sessions capped at 400.

---

## A.5 APIs

**No HTTP API exists.** Three call surfaces:

**1. PostgREST** — direct table access via `supabase-js`, RLS-gated. Used by `sync.js` (6 push functions, 1 batched fetch of 5 tables), `Profile.jsx:56`, `Achievements.jsx:46`, `adminApi.js`.

**2. Postgres RPC** — `battle/api.js` wraps 12 functions through one `rpc()` helper so the throw shape is uniform. Errors carry `BF###` codes raised by plpgsql, mapped to actionable copy via `BATTLE_ERROR_COPY` (17 entries). `42501` — the permission-denied a signed-out caller now gets — is remapped to "sign in first", because *"permission denied for function battle_room_by_pin" is true and useless* (`api.js:41-43`).

**3. AI providers** — OpenAI-shaped `/chat/completions` against hcnsec and OpenRouter, direct from the browser.

---

## A.6 Authentication

**Supabase GoTrue.** Four paths: email+password, Google OAuth, **anonymous**, and guest→email upgrade.

The anonymous path is architecturally important: `signInAnonymously()` mints a real `auth.users` row from nothing but a name, so **every RLS policy keyed on `auth.uid()` works unchanged and no table needs a nullable-owner special case** (`supabase.js:86-98`). This is what lets someone handed a room code race in two clicks.

`upgradeGuestWithEmail()` uses `auth.updateUser()`, which **keeps the same user id** — sessions, key stats and achievements written under the guest id stay owned by the same row, so signing up converts an account rather than stranding one.

`auth.jsx` holds session state only; the modal is rendered once from `AppShell`. When Supabase is unconfigured, `ready` starts `true` and stays `true` — nothing shows a loading state for an account that cannot exist.

`supabase.js:36-48` mirrors the user id outside React (`cachedUserId`) so `ai-runner.js` — a plain fetch module with no React or store dependency — can attribute a usage row without an extra round trip.

---

## A.7 State management

**`useReducer` + Context.** No state library. `store.jsx` is 278 lines.

Actions: `session`, `battleRank`, `setting`, `profile`, `clearFresh`, `reset`, `seed`.

`battleRank` is split from `session` deliberately: the run is reported the moment it ends (so XP lands even if the tab closes), while rank only exists once the room settles. Re-running the achievement pass on rank arrival is what lets "Champion" unlock on the results screen (`store.jsx:135-143`).

**Critical property for performance:** the typing engine holds `typed`/`status`/`elapsedMs` in the *route module's* local state (`useTypingEngine.js:39-41`), **not** in the store. Per-keystroke churn therefore never re-renders store consumers. This is correct and must be preserved.

`useStats()` is a single memoised selector so every surface reads the same derived numbers.

---

## A.8 Realtime

Only Battlefield uses it. `supabase_realtime` was empty before `0009`.

**Two transports, chosen for opposite needs** (`useBattleRoom.js:8-30`):

| | Durable state | Live telemetry |
|---|---|---|
| Transport | Postgres Changes | Broadcast |
| Carries | `battle_rooms`, `battle_players`, `battle_results` | Progress ticks |
| Rate | On change | 1 Hz, delta-suppressed |
| Persistence | Yes | Never touches Postgres |
| RLS | Server-filtered | N/A |

The reasoning is recorded: 8 players × 1 Hz × 2 min ≈ 960 row updates on a table 8 people subscribe to — *"not a scaling worry, a design error."*

Broadcast is **advisory**: everything it carries also arrives, slower, through the durable path. A dropped tick costs staleness, never an outcome.

**Rival ticks are kept out of React state** (`ticksRef` + `subscribeTicks`). The comment is explicit: `TypingStage` re-renders per keystroke by design, and seven rivals pushing state updates into the same tree would multiply that by eight *for information that is decorative*.

`replica identity full` is set on the three battle tables so RLS can evaluate policies against change events — with the warning *"free on tables that hold eight rows; do not copy this onto sessions."*

Channel topic is the **room UUID, never the PIN** — a PIN is a six-character secret people read aloud.

---

## A.9 Multiplayer architecture

**Clock synchronisation** (`clock.js`) is a miniature NTP: 5 samples, keep the 3 with lowest RTT, take the median offset. Local endpoints come from `performance.timeOrigin + performance.now()` rather than `Date.now()` because that pair is **monotonic** — an NTP correction landing mid-handshake cannot corrupt a sample.

**Phase derivation** is a pure function of room status + clock offset (`useBattleRoom.js:266-276`), so a mid-match refresh reconstructs the right screen. There is no client-held phase machine to desynchronise.

**The countdown→active flip has no owner** — there is no timer process. `starts_at` is the authority and the first client past it writes the status (`battle_touch`), so anyone loading cold sees the truth.

**Publishing:** `publishTick` self-rate-limits and skips frames where progress did not move; payload uses single-letter keys and integers (~60 bytes vs ~180). `publishCheckpoint` writes to Postgres every 5 s as a resume floor.

---

## A.10 Dependencies

**7 production, 6 dev.** 149 installed packages, 268 lockfile entries. Verified usage:

| Package | Files | Assessment |
|---|---|---|
| `framer-motion` | 28 | Justified; 115 kB is the price |
| `lucide-react` | 33 | Justified; tree-shakes correctly — `Achievements.jsx:18-19` explicitly avoids a namespace import for this reason |
| `react-router-dom` | 16 | Justified |
| **`recharts`** | **1** | **421 kB for one file — see A.13** |
| `prismjs` | 1 | Justified; grammars lazy-loaded |
| `@supabase/supabase-js` | 1 | Justified; correctly isolated |
| **`clsx`** | **1** | Wrapped as `cx` in `format.js:1-3` and re-exported unchanged. Zero-value indirection |

This is a **lean** dependency list. No bloat beyond the two flagged.

---

## A.11 Build / deployment

**Vite 6.** Target `es2020`. Manual chunks: `react`, `charts`, `motion`. Alias `@` → `src`. Build passes in **41.24 s**.

**Vercel:** framework `vite`, output `dist`, `rewrites: [{ "/(.*)" → "/index.html" }]`. `public/_redirects` carries the same rule for Netlify-style hosts.

**Icons:** `scripts/build-icons.mjs` generates favicon + PWA icons from `Logo.jsx` using `sharp`. **Not wired into `npm run build`** — it is a manual step.

**No CI. No lint. No tests. No staging environment identified.**

---

## A.12 Existing technical debt

| # | Item | Evidence | Severity |
|---|---|---|---|
| D-1 | Zero tests | `find` for test files/configs → no matches | **Critical** |
| D-2 | Zero lint config, yet `eslint-disable` directives exist | `AppShell.jsx:110`, `useTypingEngine.js:90`, `Practice.jsx:77,154` | High |
| D-3 | recharts pulled by importers that need none of it | `SessionSummary.jsx:9` imports only `Sparkline` (pure SVG) | High |
| D-4 | Mode knowledge scattered across 5 files | `Practice.jsx:26`, `AppShell.jsx:28`, `CommandPalette.jsx:22`, `Battle.jsx:17`, `content.js:73` | High |
| D-5 | `DIFFICULTIES` defined 3× in 2 shapes | as above | Medium |
| D-6 | Session object hand-assembled at 3 call sites | `Practice.jsx:164`, `CodeTyping.jsx:125`, `RaceView.jsx:63` | High |
| D-7 | Dead schema: `learn_progress`, `problem_progress`, `beta_votes`, `beta_vote_tally` | A.4 | Medium |
| D-8 | `sync.js` still pushes `problem_progress` | `sync.js:181-196` — writes a table nothing reads | Medium |
| D-9 | `cx` re-export of `clsx` | `format.js:1-3` | Low |
| D-10 | Icon generation not in the build | `scripts/build-icons.mjs` | Medium |
| D-11 | `daily_stats` written but never read back | `sync.js:219-222` | Low (intentional) |
| D-12 | No CI | — | High |

---

## A.13 Performance bottlenecks

### PB-1 — recharts, 421 kB / 113 kB gzip · **VERIFIED**
`Charts.jsx` exports 5 components. **`Sparkline` (line 302) and `Heatmap` (line 158) use no recharts** — they are hand-rolled SVG and DOM. But module-level import of recharts (`Charts.jsx:2-5`) means every importer pays:

| Importer | Uses recharts? | Pays |
|---|---|---|
| `SessionSummary.jsx` | ❌ `Sparkline` only | 421 kB |
| `Landing.jsx` | Partly (`WeeklyBars`) | 421 kB |
| `Dashboard.jsx` | ✅ | Justified |
| `AdminPanel`, `AiUsageTab` | ✅ `TrendLine` | Justified |
| `UsersTab.jsx` | ❌ `Heatmap` only | 421 kB |

`SessionSummary` is reached at the end of **every** typing run. It pays 113 kB gzip for a `<polyline>`.

### PB-2 — `TypingStage` per-character rendering · **STRUCTURALLY VERIFIED, LATENCY UNMEASURED**

Two facts, both read directly from `TypingStage.jsx`:

1. **`Passage` renders one `<span>` per character and is explicitly memo-free.** The comment at line 273-276 says *"the per-character spans are cheap, and memoising them costs more than it saves at these lengths."* That reasoning holds for a 300-character prose passage. **`battle_create` accepts passages up to 4,000 characters** (`0009:301`), and Marathon is ~130 words. Every keystroke re-creates the full span array.

2. **A forced synchronous layout runs on every keystroke.** `useLayoutEffect` (lines 77-96) does `querySelector('[data-idx="N"]')` then `getBoundingClientRect()` on both the character and the container, keyed on `index`.

Additionally the caret is a framer-motion spring animating `x`, `y`, `width`, `height` — four non-composited properties.

> **This is the highest-priority thing to measure.** PRD PE-1 (zero dropped keystrokes at 150 WPM) is the product's non-negotiable performance target and this is the code path that decides it. **I have not measured it and no claim of actual latency is made here.** §B.29 defines the measurement before any optimisation.

### PB-3 — `index` vendor chunk, 383 kB / 114 kB gzip
Not attributed to specific packages. Likely `@supabase/supabase-js` + `prismjs` core. **Unmeasured** — needs `rollup-plugin-visualizer` before acting.

### PB-4 — `useCloudSync` pushes the entire snapshot on every change
`sync.js:471-478` — 2 s debounce, then **6 upserts** covering the whole state. `pushSessions` sends up to 400 rows every time. Correct (idempotent) but wasteful; grows linearly with history.

### PB-5 — `Achievements.jsx` refetches the leaderboard whenever own XP changes
`useEffect(..., [xp])` at line 61. Deliberate ("so the board stays current") but means a network round trip per XP award while on the page.

---

## A.14 Security concerns

### SC-1 — AI provider keys are in the client bundle · **ACKNOWLEDGED IN-CODE**
`config.js:13-18` states it plainly: anything `VITE_`-prefixed is inlined and readable by anyone who loads the site, with the mitigation *"use spend-limited keys, and move to a serverless proxy before this is public in earnest — `ai-runner.js` is the only file that would need repointing."*

### SC-2 — `ai_usage` is client-reported
`0002` documents it: a malicious client could misreport its own usage. Numbers are advisory. The insert policy should be dropped once a proxy is the only writer.

### SC-3 — No rate limiting
The only limit anywhere is 3 concurrent rooms per host (`0009:310-314`). Nothing limits AI calls, sign-ups, or session writes.

### SC-4 — No content moderation
`display_name` flows to `public.leaderboard` and `battle_players` with no filter.

### SC-5 — No data-deletion path for cloud rows
`resetAll()` clears local state only. No RPC or UI deletes `profiles`/`sessions`/etc. **Likely a compliance exposure.**

### SC-6 — `auth_events` allows an anonymous insert
`0002` policy: `(auth.uid() = user_id) OR (user_id IS NULL AND event = 'failed')`. Narrowly scoped to one event value — deliberate, since a failed login has no session by definition — but it is an unauthenticated write path.

### What is genuinely well done — preserve exactly
Server-owned clock · server-recomputed WPM · passage access gating · `FOR UPDATE` capacity check · `REVOKE` before `GRANT` · internal functions revoked from `authenticated` · realtime keyed on UUID not PIN · rooms not enumerable by PIN · leaderboard view exposing four columns · admin role DB-only with no self-service path.

---

## A.15 Accessibility concerns

### Present and verified
Skip link (`AppShell.jsx:126`) · global `:focus-visible` (`index.css:114`) · `prefers-reduced-motion` globally (`index.css:141`) and per-component (`useReducedMotionSafe`) · `role="progressbar"` with full aria values · decorative SVG `aria-hidden` · charts ship `DataTable` alternatives · documented contrast per token · CVD-validated chart palette with recorded validator output · `role="textbox"` + `aria-describedby` on the typing stage with an `sr-only` instruction (`TypingStage.jsx:266-268`) · `role="switch"` + `aria-checked` on toggles.

### Gaps — verified by reading source
| # | Gap | Evidence |
|---|---|---|
| AC-1 | **Typing state relies on colour** | `STATE_CLASS` (`TypingStage.jsx:17-22`): CORRECT = `text-ink`, PENDING = `text-ink-3`, WRONG = `text-bad bg-bad/10`. Only CORRECTED adds a non-colour cue (underline). Correct vs. pending is a contrast difference, not a distinct form |
| AC-2 | No live region announces run completion | No `aria-live` anywhere in the typing flow |
| AC-3 | Light-theme chart contrast WARN | `palette.js:8` records it; mitigation is the data table |
| AC-4 | Never audited | No axe/Lighthouse run has been done |

### AC-1 detail
The most-used state pair — CORRECT (`--ink`) vs PENDING (`--ink-3`) — differs only in lightness. For a user with low vision or on a poor display, tracking position depends on the caret alone. In a timed competitive context this is the highest-impact accessibility issue in the product.

---

## A.16 Unverified — not asserted anywhere above

| # | Unknown | Blocks |
|---|---|---|
| U-1 | Actual typing input latency / dropped keystrokes | PB-2, PE-1 |
| U-2 | Lighthouse / CWV numbers | All PE targets |
| U-3 | Composition of the 383 kB `index` chunk | PB-3 |
| U-4 | Mobile typing behaviour (IME, autocorrect, OSK) | §B.30 |
| U-5 | Whether deployed Supabase schema matches `migrations/` | Any migration |
| U-6 | Two tabs, same user, same room | §B.12 |
| U-7 | Google upgrade when the email already exists | §B.6 |
| U-8 | Realtime quota headroom on the current plan | §B.34 |
| U-9 | Whether production users exist, and data volume | Migration risk |

---

# PART B — Target architecture

## B.0 Governing decisions

Four decisions constrain everything below. Each rejects a popular option for a project-specific reason.

### D-1 — Stay on Vite + React SPA. Do **not** migrate to Next.js.

The only requirement pulling toward a framework is SEO-8 (landing content without JS). That is 2 public routes. Migrating would mean rewriting routing, restructuring the provider tree, re-solving the pre-paint theme script, re-validating every `supabase === null` path under SSR, and re-testing the entire typing engine under a new hydration model — **to server-render one marketing page**.

§B.32 solves SEO with a build-time prerender step of ~40 lines.

> **Reuse:** everything. **Change:** nothing. **Risk of migrating:** high. **Risk of staying:** SEO depends on a prerender step working. **Complexity avoided:** XL.

### D-2 — Keep Supabase. Keep Postgres-as-backend.

The backend is the best-engineered part of the system (A.3). Migration is pure cost.

### D-3 — Keep `useReducer` + Context. Do **not** add Redux/Zustand/Jotai.

The store is 278 lines and correct. Critically, **the perf-sensitive path does not go through it** (A.7) — the typing engine holds per-keystroke state locally. A state library would solve a problem that does not exist while adding a dependency and a migration.

### D-4 — Add exactly one new runtime surface: a serverless AI proxy.

This is the only new infrastructure. It is required by SC-1 and SC-3, and `config.js` already names `ai-runner.js` as the single file needing repointing. Vercel Functions, because the project already deploys to Vercel.

---

## B.1 System architecture

```
┌──────────────────────────────────────────────────────────┐
│ BROWSER — React 18 SPA                                    │
│   localStorage (typeforge.*)  ← source of truth           │
│   supabase-js · fetch → /api/ai   ✅ no keys in bundle     │
└──────┬──────────────────────┬──────────────────┬──────────┘
       │                      │                  │
       ▼                      ▼                  ▼
┌──────────────┐  ┌───────────────────┐  ┌──────────────────┐
│ VERCEL STATIC│  │ VERCEL FUNCTION   │  │ SUPABASE         │
│ prerendered: │  │ /api/ai  ← NEW    │  │ GoTrue           │
│  / , /about  │  │  keys server-side │  │ PostgREST (RLS)  │
│ SPA fallback │  │  rate limited     │  │ Realtime         │
│ elsewhere    │  │  usage logged     │  │ Postgres (logic) │
└──────────────┘  └─────────┬─────────┘  └──────────────────┘
                            ▼
                  ┌───────────────────┐
                  │ AI PROVIDERS      │
                  └───────────────────┘
```

**Two changes from A.1:** public routes are prerendered; AI calls route through a function.

---

## B.2 Frontend architecture

Structure evolves; the stack does not.

```
src/
  app/            ← NEW   registry, session contract, routes config
    modes.js              the mode registry (§B.19)
    session.js            the session contract (§B.19)
    routes.jsx            route table derived from the registry
  components/
    charts/
      primitives.jsx  ← NEW  Sparkline, Heatmap — SVG only, NO recharts
      recharts.jsx    ← NEW  TrendLine, WeeklyBars, SkillRadar
      ChartFrame.jsx        unchanged
      palette.js            re-validated values, same structure
    typing/          unchanged API, TypingStage internals reworked (§B.29)
    ui/              restyled, same component contracts
    brand/           new mark, same single-source property
  lib/
    storage/         ← NEW  namespace + migration (§B.4)
    ...              otherwise unchanged
  modules/
    landing/         ← NEW  public marketing page
    home/            ← RENAMED from landing/ (the dashboard half)
    ...
```

### Change record — chart module split

> **Why needed** PB-1: `SessionSummary` pays 113 kB gzip for a `<polyline>` on every run.
> **Reuse** All five components move unmodified. `ChartFrame`, `DataTable`, `palette.js` untouched.
> **Change** Split `Charts.jsx` into `primitives.jsx` (no recharts import) and `recharts.jsx`. Update 6 import sites.
> **Do NOT change** Component APIs, the `chartTokens()` contract, the palette slot ordering (`palette.js:12-14` warns the ordering *is* the CVD-safety mechanism).
> **Risk** Low. Mechanical. Caught by the build.
> **Complexity** S.

> **Note on replacing recharts entirely.** Only 3 components use it. Hand-rolling them would remove 421 kB outright. **Not recommended for MVP** — it trades a verified 30-minute win for a multi-day rewrite of the axis/tooltip/responsive behaviour that recharts provides. Revisit as a P1 spike after measuring whether the Dashboard route's budget is actually breached.

---

## B.3 Backend architecture

Postgres remains the backend. One new surface.

### Change record — AI proxy function

> **Why needed** SC-1 (keys in bundle), SC-2 (client-reported usage), SC-3 (no rate limiting). PRD SE-8, SE-9.
> **Reuse** **All of `ai-runner.js`'s logic** — hedging, attempt planning, classification, SSE parsing. It moves to the function nearly verbatim. `config.js` model lists and timing move with it. `ai.js` prompt construction is untouched.
> **Change** `ai-runner.js` becomes a thin client calling `POST /api/ai` (streaming via SSE passthrough). Keys become non-`VITE_` env vars. `ai_usage` is written **server-side**, and the client insert policy is dropped.
> **Do NOT change** The `AIUnavailable` error shape, `AI_REASON_COPY`, the offline-fallback behaviour of every surface, or the rule that AI failure never blocks typing.
> **Risk** Medium — streaming through a function needs care (Vercel Functions support streaming on the Node runtime; do **not** reach for `runtime = 'edge'`, which buys nothing here and loses Node APIs). If it regresses, chat is the visible casualty.
> **Complexity** M. **Priority P1** — not MVP.

### Battlefield backend
> **Do NOT change `0009_battlefield.sql`.** Every property in A.14 depends on it. New competitive features get *new* migrations that extend it; the existing file is not edited.

---

## B.4 Database architecture

### B.4.1 Client storage — namespace migration

**The highest-risk change in the entire programme.** A bare rename discards every existing user's progress.

```js
// lib/storage/namespace.js
export const NS = 'typeforge';
export const LEGACY_NS = 'keystroke';

const KEYS = [
  ['state.v2',      'state.v2'],
  ['chat.v2',       'chat.v2'],
  ['theme',         'theme'],
  ['rail.pinned',   'rail.pinned'],
  ['adopted',       'adopted'],
  ['code.introOpen','code.introOpen'],
];

/**
 * Copy-forward, never move. Idempotent. Runs before the first read.
 *
 * Three rules:
 *   1. Never overwrite an existing typeforge.* value — a newer TypeForge
 *      state must not be clobbered by a stale KeyStroke one.
 *   2. Never delete the keystroke.* key. It is the rollback path for one
 *      release, and deletion is unrecoverable.
 *   3. Never throw. storage.js semantics: failure means "does not remember",
 *      never a blank page.
 */
export function migrateNamespace() {
  for (const [from, to] of KEYS) {
    try {
      const target = `${NS}.${to}`;
      if (localStorage.getItem(target) !== null) continue;
      const legacy = localStorage.getItem(`${LEGACY_NS}.${from}`);
      if (legacy !== null) localStorage.setItem(target, legacy);
    } catch { /* quota / private mode — storage.js contract */ }
  }
}
```

**Call site is load-bearing:** `migrateNamespace()` must run **before** `store.jsx`'s `load()` and before the pre-paint theme script reads a value. That means:
- Module-init in `main.jsx`, imported before `StoreProvider`.
- **And** the inline script in `index.html` must read `typeforge.theme` with a `keystroke.theme` fallback — otherwise the first load after upgrade flashes the wrong theme (PRD F-STORE-4).

> **Why needed** PRD IMP-7 / R-2 (Critical).
> **Reuse** `storage.js` try/catch wrappers unchanged.
> **Change** One new module; six key constants; the `index.html` script.
> **Do NOT change** The state *shape*, the shallow-merge-over-`EMPTY` load, or the 220 ms debounce. Only the key names move.
> **Risk** **Critical if wrong.** Mitigated by: idempotence, copy-not-move, never-overwrite, and a required unit test that seeds legacy keys and asserts full recovery.
> **Complexity** S to write, **M to verify properly**. The verification is the work.

### B.4.2 Server schema

**Migration `0010_typeforge_cleanup.sql`** — drops dead objects (PRD REM-2/3/4):
```sql
drop view  if exists public.beta_vote_tally;
drop table if exists public.beta_votes;
drop table if exists public.learn_progress;
drop table if exists public.problem_progress;
```
**Data loss is intended and must be explicitly approved.** `sync.js:181-196` (`pushProblemProgress`) and the corresponding pull must be removed in the same change, or sync will 404.

**Migration `0011_skill_rating.sql`** *(P1, §B.15)* — adds rating storage. Additive only.

> **Do NOT change** `sessions` identity `(user_id, ts)`, the `leaderboard` view's column set, any RLS policy in `0001`/`0002`, or anything in `0009`.

---

## B.5 API architecture

Unchanged in kind: PostgREST + Postgres RPC. One HTTP endpoint added (§B.3).

**Convention for all new server logic:** a new capability that needs a trust boundary becomes a `SECURITY DEFINER` RPC in a new migration, following the `0009` template — `REVOKE ... FROM public, anon` first, then `GRANT ... TO authenticated`, with internal helpers revoked from `authenticated` too.

**Error contract:** new RPCs raise coded exceptions (`TF###`) and the client maps them through a copy table, exactly as `BATTLE_ERROR_COPY` does. No caller string-matches a Postgres message.

---

## B.6 Authentication / authorization

> **Do NOT change.** Four auth paths, the guest-upgrade id-preservation, the `cachedUserId` mirror, the `supabase === null` contract, and DB-only admin all stay exactly as they are.

Two additions:

| ID | Change | Priority |
|---|---|---|
| AU-1 | Resolve U-7 — Google upgrade when the email already exists. Define and test | P0 |
| AU-2 | Data deletion RPC (SC-5): `SECURITY DEFINER`, deletes all rows for `auth.uid()`, then the auth user | P1 |

---

## B.7 User / profile system

> **Do NOT change** the single-writer `persist()` pattern (`Profile.jsx:50-73`) — it is what stops local and remote diverging. Do not change the avatar model (preset id or ≤160px data URI), or the leaderboard opt-out semantics.

Additions: public profile view (P1), delete-my-data (P1, depends on AU-2), keyboard-layout preference (P2 — a `settings` key, which the shallow-merge load already accommodates for free).

---

## B.8 Typing engine

> **Do NOT change `useTypingEngine.js` behaviour.** Not the WPM definition, not `stopOnError`, not auto-indent, not word-delete, not the gated/`startAtMs` mechanism. Its feel *is* the product, and altering it invalidates every historical score.

| ID | Change | Why |
|---|---|---|
| TE-1 | **Unit tests first**, before any other engine-adjacent work | D-1; nothing else is verifiable without them |
| TE-2 | Emit the session contract (§B.19) instead of a hand-built object | D-6 |
| TE-3 | Fix the `samples.current` unbounded growth in Zen mode | Long sessions accumulate one sample per second forever |
| TE-4 | Define IME/composition behaviour | U-4; `keydown`-only capture ignores `compositionstart` entirely |

TE-1 test surface: `netWPM`, `accuracyPct`, `consistencyPct`, `diffChars`, `countCorrect`, `weakestKeys`, `keyFor`, `gradeRun` — all pure functions in `typing.js`, all currently untested.

---

## B.9 Typing metrics calculation

> **Do NOT change any formula.** `typing.js` documents its definitions deliberately: net WPM is `correct/5 per minute`; accuracy counts *every* keypress ever made so a corrected mistake still costs; consistency is `100 − coefficient of variation` of per-second samples.

Requirement: **golden-value tests.** A fixed input table with expected outputs, asserted byte-for-byte, so any accidental change to the maths fails CI. This is the mechanism that enforces PRD S-6.

`gradeRun()` weights (`wpm 0.4 / accuracy 0.45 / consistency 0.15`) may have their **copy** restyled but not their thresholds.

---

## B.10 Code practice system

> **Do NOT change** the Prism tokenisation pipeline, auto-indent, or the snippet data shape.

| ID | Change | Priority |
|---|---|---|
| CP-1 | Contribute to the mode registry rather than holding its own mode list | P0 |
| CP-2 | Emit the session contract with `language` populated | P0 |
| CP-3 | **Syntax colour vs. typing state must be resolvable** — the current cascade (`TypingStage.jsx:312-319`) layers three conditional class sets; state must always win | P0 |
| CP-4 | Snippet browser | P1 |

CP-3 is a correctness requirement, not styling: with a new palette, a syntax colour could become indistinguishable from the WRONG state. The rule must be explicit — **typing state overrides syntax colour, always** — and tested visually against all 11 grammars in both themes.

---

## B.11 Battle system

> **Do NOT change `0009_battlefield.sql`.** Do not change the ranking rule, the passage-gating table split, the server WPM recomputation, the cheat flags, the `FOR UPDATE` lock, the grant discipline, or the UUID-keyed realtime topic.

| ID | Change | Priority |
|---|---|---|
| BS-1 | Visual redesign of all four phases | P0 |
| BS-2 | Results screen states the deciding factor per row | P0 |
| BS-3 | `RaceView` emits the session contract | P0 |
| BS-4 | Rematch — **new RPC** `battle_rematch(room)` creating a new room seeded with the prior roster | P1 |
| BS-5 | Invite links — a URL form of the PIN; no schema change | P1 |
| BS-6 | Lobby readiness — new column on `battle_players`, additive | P1 |

> **BS-4 risk:** a rematch RPC must re-run every check `battle_create` runs (host limit, passage length) and must not become a way to bypass the 3-room cap. Complexity M.

---

## B.12 Multiplayer / realtime architecture

> **Do NOT change** the dual-transport split, the clock handshake, the ref-based tick pipeline (`subscribeTicks`), the 1 Hz rate limit with delta suppression, the compact payload shape, the 5 s checkpoint, or the UUID channel topic.

Every one of these has a recorded reason. `useBattleRoom.js:22-29` in particular explains that moving rival ticks into React state would multiply typing-tree re-renders by eight — that is a direct PE-1 hazard.

| ID | Change | Priority |
|---|---|---|
| MR-1 | Resolve U-6 — two tabs, same user, same room. Define behaviour; likely last-writer-wins on checkpoints with a UI warning | P0 |
| MR-2 | Surface reconnection state more explicitly | P1 |
| MR-3 | Quota instrumentation before adding realtime consumers | P1 |

---

## B.13 Matchmaking

**The security-critical new feature.**

`battle_rooms` is member-scoped *precisely* so a client cannot select by PIN and walk the code space (`0009:180-183`). Quick Match needs public room discovery. These are in direct tension.

### Design — do not weaken the RLS policy

Add an opt-in visibility flag and a **definer RPC** that returns a curated list. The table policy stays exactly as it is.

```sql
-- 0012_quick_match.sql
alter table public.battle_rooms
  add column if not exists is_public boolean not null default false;

create or replace function public.battle_find_public(p_limit int default 10)
returns table (pin text, players int, max_players int,
               difficulty text, time_limit_sec int)
language sql security definer stable set search_path = '' as $$
  select r.pin,
         (select count(*)::int from public.battle_players p
           where p.room_id = r.id and p.left_at is null),
         r.max_players, r.difficulty, r.time_limit_sec
    from public.battle_rooms r
   where r.is_public
     and r.status = 'lobby'
     and r.expires_at > now()
     and auth.uid() is not null
     and (select count(*) from public.battle_players p
           where p.room_id = r.id and p.left_at is null) < r.max_players
   order by r.created_at desc
   limit least(greatest(p_limit, 1), 20);
$$;

revoke execute on function public.battle_find_public(int) from public, anon;
grant  execute on function public.battle_find_public(int) to authenticated;
```

**Why this is safe:** it returns only *public, joinable, lobby-phase* rooms; it requires a session; the underlying table policy is untouched, so a direct `select ... where pin = 'ABC123'` still returns nothing. PIN-space walking remains impossible because the function never accepts a PIN as input.

> **Why needed** PRD MM-F3 — a solo user currently cannot compete at all.
> **Reuse** `battle_join` unchanged; Quick Match resolves to a PIN then calls it. `Battle.jsx` create/join flow largely intact.
> **Change** One additive column, one new RPC, one new UI surface.
> **Do NOT change** The `members read` policy on `battle_rooms`. Rooms stay private by default (`is_public` defaults `false`).
> **Risk** **High if the policy is loosened instead.** The pattern above is the mitigation. Requires explicit security review (PRD SE-7, SE-13).
> **Complexity** M. **Priority P1.**

---

## B.14 Leaderboards

> **Do NOT change** the `leaderboard` view's four-column exposure, the opt-out, the definer-view pattern that lets it aggregate rows the caller cannot select, or the client-side fold-in of the local user (`Achievements.jsx:40-74`).

| ID | Change | Priority |
|---|---|---|
| LB-1 | Fix row keys — names are **not unique**; production already has two players called "Meow" (`Achievements.jsx:151-154`) | P0 |
| LB-2 | Label which metric ranks the board | P0 |
| LB-3 | Skill board as a **second view**, not a modification of the existing one | P1 |
| LB-4 | Time-windowed boards | P1 |

LB-3 as a separate view is deliberate: it keeps the XP board's proven privacy shape untouched and makes the two independently revertible.

---

## B.15 Ranking system

**New. XP measures effort; rating must measure skill.**

### Design constraints
- Must not be computable client-side (it is competitive).
- Must derive from `battle_results`, whose `wpm` is already **server-recomputed** — the only trustworthy speed figure in the system.
- Must not disturb `profiles.xp`.

### Recommended: Elo-style, updated in `battle_settle()`

```sql
-- 0011_skill_rating.sql (sketch)
alter table public.profiles
  add column if not exists rating      int not null default 1200,
  add column if not exists rating_games int not null default 0;
```

`battle_settle()` gains a rating pass: for each ordered pair in the finished room, apply a pairwise Elo update with a K-factor that decays as `rating_games` grows (higher K for placement games).

**Why Elo rather than "average WPM":** average WPM ranks a player who races weak opponents identically to one who races strong ones. Elo is the standard solution to exactly that problem and is ~30 lines of plpgsql. Rejecting Glicko/TrueSkill for now: they add rating-deviation state and materially more complexity for a benefit that only appears at scale.

> **Why needed** PRD XP-4, LB-5, Persona B's core need.
> **Reuse** `battle_settle()` already computes the finishing order — the exact input Elo needs. No new ordering logic.
> **Change** Two additive columns; a rating pass inside `battle_settle()`; a new `skill_leaderboard` view.
> **Do NOT change** `profiles.xp`, the XP formula, or the existing `leaderboard` view.
> **Risk** Medium. Rating changes are hard to reverse once players see them — ship behind a flag and validate against seeded data first. `battle_settle()` is inside the finish transaction, so a bug there fails a *match*, not just a number. **Test in isolation before wiring it in.**
> **Complexity** M–L. **Priority P1.**

---

## B.16 XP / progression

> **Do NOT change** `xpForSession()`, `xpForLevel()`, `advanceStreak()`, `liveStreak()`, `missionsForDay()`, or `bumpDaily()`. PRD XP-1.

| ID | Change | Priority |
|---|---|---|
| PG-1 | **Golden-value tests** for every function above | P0 |
| PG-2 | Level *titles* may be renamed; thresholds may not | P0 |
| PG-3 | XP awarding consumes only the session contract, so a new mode is scorable without touching `store.jsx` | P0 |
| PG-4 | No UI string may assert "XP = rank" | P0 |

PG-3 is the structural half of PRD EX-3. Today `xpForSession` reads `{wpm, accuracy, durationSec, kind, difficulty}` — the contract must carry exactly these, plus a mode-supplied override hook for modes whose XP is not a function of speed (SC-A4).

---

## B.17 Achievements

> **Do NOT change** any of the 19 unlock conditions, the never-re-lock property, the per-achievement try/catch (`store.jsx:89`), or the split `battleRank` re-evaluation.

| ID | Change | Priority |
|---|---|---|
| AH-1 | Unit-test all 19 conditions | P0 |
| AH-2 | Names/copy restyled; conditions frozen | P0 |
| AH-3 | Registry-declared achievements per mode | P1 |
| AH-4 | Progress toward multi-step achievements | P1 |

AH-4 note: `ACHIEVEMENTS[].test` is a boolean predicate. Progress requires an optional `progress(facts) → {value, goal}` alongside it. Additive — absent `progress` means "binary", so existing entries need no change.

---

## B.18 Statistics

> **Do NOT change** the `useStats()` selector contract, the weak-key threshold semantics (`≥8` attempts, `wrong > 0`), or the `DataTable` alternative on every chart.

| ID | Change | Priority |
|---|---|---|
| ST-1 | Chart module split (§B.2) | P0 |
| ST-2 | Palette re-validated for CVD + contrast, **validator output recorded in `palette.js`** as it is today | P0 |
| ST-3 | Weak-key drill preselects diagnosed keys | P1 |
| ST-4 | Bigram / symbol-class analysis | P1 |

ST-4 requires a new `keyStats`-adjacent structure. `store.jsx` already merges `keyStats` additively; bigrams follow the same shape (`"th" → {total, wrong}`) and can ride the same sync path. Note the storage growth: single keys are bounded at ~100 entries, bigrams at ~10,000 — **cap the tracked set to the top-N observed** rather than storing all.

---

## B.19 Game-state management

**The architectural spine.** Two new modules, both pure data.

### B.19.1 Mode registry — `src/app/modes.js`

```js
/**
 * The single source of truth for every mode.
 *
 * Navigation, the command palette, mode pickers, XP rules and per-mode
 * achievements all derive from this. Adding a mode must not require an
 * edit to any of those.
 */
export const MODES = [
  {
    id: 'time',
    name: 'Time',
    category: 'train',          // train | compete
    route: '/practice?mode=time',
    icon: 'Clock',
    scored: true,
    multiplayer: false,
    requiresCloud: false,
    difficulties: ['easy', 'normal', 'hard', 'expert'],
    content: { source: 'words', durations: [15, 30, 60, 120] },
    scoring: 'passage',          // passage | none | contest
    xp: 'standard',              // key into the XP rule table
  },
  // … zen: { scored: false, scoring: 'none' }
  // … code: { content: { source: 'snippets' }, xp: 'code' }
  // … battle: { multiplayer: true, requiresCloud: true, scoring: 'contest' }
];
```

**Acceptance test (PRD SC-A5):** the stickman entry must be expressible with **no core change**:
```js
{
  id: 'combat',
  name: 'Combat',
  category: 'compete',
  route: '/combat',
  scored: true,
  multiplayer: true,
  maxPlayers: 2,
  requiresCloud: true,
  scoring: 'contest',        // NOT 'passage' — no completion requirement
  xp: 'combat',              // outcome-driven, not wpm×duration
  realtime: { rate: 'event' } // vs battle's 'tick'
}
```
If this cannot be written without editing navigation, scoring, or the store, **the registry has failed and must be redesigned before the cycle closes.**

> **Why needed** D-4, D-5; PRD MR-1..MR-7, SC-A1.
> **Reuse** Every mode list becomes a `MODES.filter(...)`. Existing components keep their props.
> **Change** 5 files stop declaring modes and start reading them.
> **Do NOT change** Mode *behaviour*. This is a refactor with zero user-visible effect — which is exactly what makes it verifiable.
> **Risk** Medium — over-abstraction. **Mitigation: build only what the stickman entry requires. No speculative fields.**
> **Complexity** M.

### B.19.2 Session contract — `src/app/session.js`

```js
/**
 * The one shape every mode emits on completion.
 *
 * `extra` is the extensibility seam: mode-specific data rides along without
 * any consumer needing to know about it. `store.jsx` persists it; XP and
 * achievements ignore it unless a registry rule opts in.
 */
export function createSessionResult({
  modeId, difficulty = 'normal', language = null,
  wpm, rawWpm, accuracy, consistency,
  durationSec, chars, errors, keyStats,
  extra = null,
}) { /* validate, normalise, return frozen object */ }
```

> **Why needed** D-6; PRD EX-2, SC-A2.
> **Reuse** Field set is exactly what the 3 call sites already build.
> **Change** 3 call sites; `store.jsx` reducer reads `modeId` where it currently reads `kind`/`mode`.
> **Do NOT change** The persisted session shape without a state-version bump — `store.jsx` loads `keystroke.state.v2`; changing field names requires `v3` **and** a shape migration alongside the namespace migration.
> **Risk** **Medium-high.** This touches the persisted shape. Historical sessions must keep rendering. Safest path: keep the stored fields identical and make the contract a *constructor*, not a new schema.
> **Complexity** M.

---

## B.20 Future stickman combat architecture

**Not built. Constraints only.**

| Requirement | Battlefield today | Combat needs |
|---|---|---|
| Telemetry rate | 1 Hz aggregate | Sub-second events |
| Progress model | Monotonic char count | HP, stance, cooldowns |
| Outcome | Computed once at finish | Evolves continuously |
| Text | One shared passage, everyone finishes | Possibly divergent, no completion |

**Recorded architectural decisions:**
1. Combat **cannot** reuse the 1 Hz tick. It needs an event channel (still Broadcast, higher rate, different payload).
2. Combat state must be **server-arbitrated** or it is trivially cheatable. Postgres RPC round-trips are too slow for per-hit resolution — this likely needs a stateful process, which is **the one future requirement that could break the "no application server" constraint (D-1/D-2)**. Flag it now; do not solve it now.
3. `battle_results` cannot hold combat outcomes. A sibling table, not a widened one.
4. The registry (`scoring: 'contest'`, `realtime: 'event'`) must express it — SC-A5.

**Nothing in MVP may assume "one passage, everyone finishes."**

---

## B.21 WebSocket / realtime requirements

Supabase Realtime (phoenix channels over WebSocket) is sufficient for everything through Phase 3.

| Need | Transport | Rate |
|---|---|---|
| Room state | Postgres Changes | On change |
| Race telemetry | Broadcast | 1 Hz |
| Lobby presence (P1) | Presence | On change |
| Combat events (Phase 4) | Broadcast | ~10 Hz — **quota modelling required first** |

> **Do NOT add** a second realtime stack. Adding Socket.IO/Ably/Pusher alongside Supabase Realtime would mean two connection lifecycles, two auth models, and two failure modes for one feature.

**Quota is the real constraint (U-8).** Before combat, model messages/second against the plan. If combat needs 10 Hz × 2 players × N concurrent matches, that must be a measured number, not an assumption.

---

## B.22 Anti-cheat

> **Do NOT weaken anything in A.14.**

Current model, preserved verbatim:
1. Server owns the clock (`starts_at` written by Postgres).
2. Server recomputes WPM from `correct_chars` and server-measured elapsed.
3. `client_wpm` retained so divergence is visible in data.
4. Flags: `over-length`, `impossible-speed` (>20 chars/sec ≈ 240 WPM sustained).
5. Results immutable — `on conflict do nothing`, no update policy.
6. Passage unreadable before countdown.

**Additions:**

| ID | Change | Priority |
|---|---|---|
| CH-1 | Surface flagged results in the UI (they are recorded but invisible today) | P0 |
| CH-2 | Consistency-based flag — a coefficient of variation near zero across a long passage is machine-like. `consistency` is already computed and stored | P1 |
| CH-3 | Rating updates skip flagged results (§B.15) | P1 |
| CH-4 | Admin review surface for flagged results | P2 |

> **Any new competitive mode must state its cheat model before implementation.** Combat especially: client-authoritative combat is unshippable.

---

## B.23 Rate limiting

**None exists** beyond the 3-room host cap (SC-3).

| Surface | Mechanism | Priority |
|---|---|---|
| AI calls | In the proxy function (§B.3) — per-user token bucket | P1 |
| Room creation | Postgres: count recent rows in `battle_create` | P1 |
| Session writes | Implicitly bounded by the sync debounce; monitor only | P2 |
| Auth | Supabase built-in | — |

**Postgres-side pattern** (no new infrastructure):
```sql
-- inside battle_create, before minting
if (select count(*) from public.battle_rooms
     where admin_id = uid and created_at > now() - interval '10 minutes') >= 10 then
  raise exception 'Too many rooms created recently' using errcode = 'BF017';
end if;
```
Cheap, uses an existing index, needs no new table.

---

## B.24 Validation

**Three layers, with clear ownership:**

| Layer | Owns | Example |
|---|---|---|
| Postgres | **Authoritative** — anything a client could lie about | `battle_create` rejecting a passage outside 40–4000 chars |
| Contract | Shape of data crossing a module boundary | `createSessionResult` normalising and freezing |
| UI | Immediate feedback only | Disabling Join until 6 characters |

> **Rule: UI validation is never a security control.** `0009` already follows this — every constraint the UI enforces is re-checked in plpgsql. New code must not break the pattern by validating only client-side.

New requirement: `createSessionResult` must **reject** rather than silently coerce NaN/negative/absent metrics. Today `sync.js:78-96` coerces with `?? 0` at the boundary, which can persist a corrupt session as a plausible one.

---

## B.25 Error handling

**Existing patterns, all good, all to be kept:**

| Pattern | Where | Rule |
|---|---|---|
| Coded errors + copy table | `BATTLE_ERROR_COPY`, `AI_REASON_COPY` | No caller string-matches a provider/Postgres message |
| Silent degradation | `storage.js`, `logAuthEvent`, `logAiUsage` | Telemetry failure never breaks a user action |
| Fallback content | `ai.js`, `passage.js` | AI failure never blocks typing |
| Error boundary | `ErrorBoundary.jsx` | Last resort |
| Read-only on failed hydrate | `sync.js:448-453` | **A device that cannot read stays read-only** |

That last one deserves emphasis: it exists because a push after a failed pull *"zeroed a real account's XP from 790 to 0 during testing"*. **Do not remove `hydratedRef`.**

| ID | Change | Priority |
|---|---|---|
| EH-1 | `TF###` codes for all new RPCs | P0 |
| EH-2 | Error boundary per route rather than one global | P1 |
| EH-3 | Client error reporting | P2 |

---

## B.26 Logging

Today: `console.*` in the client; `auth_events` and `ai_usage` in Postgres.

| ID | Change | Priority |
|---|---|---|
| LG-1 | `ai_usage` written **server-side** in the proxy; drop the client insert policy | P1 |
| LG-2 | Strip `console.*` from production builds except genuine errors | P1 |
| LG-3 | Structured logging in the proxy function | P1 |

> **Do NOT log** passage text, typed content, or `display_name` alongside identifiers beyond what is already stored.

---

## B.27 Monitoring

Nothing exists. All P1+.

| ID | Change | Priority |
|---|---|---|
| MO-1 | Vercel Analytics for CWV (first-party, no third-party tracker — respects PRD KP-1) | P1 |
| MO-2 | Supabase dashboard alerts: connection count, realtime messages, DB size | P1 |
| MO-3 | Build-size budget enforced in CI — **fails the build** if the landing chunk exceeds 150 kB gzip | P0 |
| MO-4 | AI provider success/latency dashboard from `ai_usage` | P1 |

MO-3 is P0 because it is the only mechanism that stops PB-1 from silently returning.

---

## B.28 Caching

| Layer | Current | Target |
|---|---|---|
| Static assets | Vercel default, hashed filenames | Unchanged |
| App state | localStorage | Namespaced (§B.4.1) |
| AI responses | In-memory, `clearAICache()` exists | Unchanged |
| Prism grammars | Lazy + cached | Unchanged |
| Leaderboard | None — refetched on XP change (PB-5) | Add a short TTL |
| Snippets | Bundled | Unchanged |

> **Do NOT add** a service worker in this cycle. The app is already offline-capable *for its core loop* because state is local and content is bundled. A service worker adds cache-invalidation failure modes — the classic "users stuck on an old build" — for a benefit the architecture already delivers. Reconsider only if PWA installability (PRD MO-10) proves to need it.

---

## B.29 Performance optimization

### PO-1 — Measure typing latency **before** optimising · **P0, blocking**

PB-2 identifies two structural facts. Neither is proof of a latency problem. The measurement comes first:

**Method:**
1. Synthetic keystroke driver at 150 WPM (12.5 chars/sec) via CDP `Input.dispatchKeyEvent`.
2. Passage lengths: 200, 1000, 4000 chars (the `battle_create` ceiling).
3. Record: dropped keystrokes, `keydown`→paint latency (p50/p95/p99), long tasks.
4. Both themes; with and without syntax highlighting.

**Pass:** zero drops; p99 keydown→paint under one frame (16.7 ms).

**Only if it fails**, apply in this order — cheapest first, re-measuring after each:

| Step | Change | Expected |
|---|---|---|
| 1 | Cache the caret's `data-idx` element ref; avoid `querySelector` per keystroke | Removes one DOM query/keystroke |
| 2 | Memoise `Passage` character spans by `(index, state)` | Removes N span recreations |
| 3 | Window the render to visible lines ± buffer | O(visible) instead of O(passage) |
| 4 | Replace the framer-motion caret spring with a CSS transform | Composited instead of layout-affecting |

> **Do NOT apply steps 2–4 speculatively.** The existing comment (`TypingStage.jsx:273-276`) argues memoisation costs more than it saves at typical lengths, and that may well be right for prose. Measure per length band.

### PO-2 — Chart module split · P0 · §B.2
### PO-3 — Bundle analysis · P0
Add `rollup-plugin-visualizer` and attribute the 383 kB `index` chunk (U-3) before touching it.
### PO-4 — Sync push cost · P1
PB-4: push only sessions newer than the last confirmed push, instead of all 400 rows.
### PO-5 — Leaderboard TTL · P1 · PB-5

---

## B.30 Responsive / mobile architecture

**U-4 must be resolved before this section can be specified.**

**Required investigation (P0):** on iOS Safari and Android Chrome, determine whether `useTypingEngine`'s `keydown` handler receives usable events from an on-screen keyboard, and what autocorrect, autocapitalise, predictive text and IME composition do to input state.

The engine ignores `key.length !== 1` and has no `compositionstart`/`compositionend` handling. **On IME input this will very likely mis-handle characters** — but I have not tested it, so it is stated as a risk, not a fact.

**Decision follows the finding** (PRD MO-5):
- **Option A — full support.** Add composition handling and an invisible input for OSK. Complexity **L**, and it touches the most safety-critical file in the codebase.
- **Option B — companion (recommended for MVP).** Stats, leaderboard, profile, results fully functional; typing surfaces state the limitation honestly. Complexity **S**.
- **Option C — support with a caveat.** Cheapest, worst — a half-working typing surface damages "precise" more than an honest limitation does.

Layout requirements (independent of the above): all surfaces 360–2560 px with no horizontal scroll; touch targets ≥44 px; the mobile tab bar's `flex-1` layout caps primary nav at 8 items, and PRD NV-2 targets ≤5.

---

## B.31 Accessibility

> **Do NOT regress** anything in A.15.

| ID | Change | Priority |
|---|---|---|
| AX-1 | **Typing state distinguishable without colour** (AC-1) | **P0** |
| AX-2 | `aria-live` announcing run completion + result (AC-2) | P0 |
| AX-3 | Palette re-validated, output recorded (AC-3) | P0 |
| AX-4 | Automated audit in CI, output recorded (AC-4) | P0 |
| AX-5 | Modal focus trap + restore verified | P0 |
| AX-6 | Screen-reader pass on the typing surface | P1 |
| AX-7 | Configurable typing font size | P1 |

**AX-1 design constraint:** the cue must not shift layout. A `border-bottom` or `text-decoration` changes nothing about metrics; a font-weight change **does** reflow and would move the caret mid-run. Prefer underline/overline, background shape, or opacity+decoration combinations. Must be verified against §B.10 CP-3 — the cue has to survive syntax highlighting too.

---

## B.32 SEO

**The one place the SPA architecture is genuinely inadequate** (PRD §33: no OG tags, no robots, no sitemap, no per-route titles, no prerendering).

### Recommended: build-time prerender of public routes only

Rejecting Next.js (D-1) and full SSG frameworks (Vike, vite-plugin-ssr) — both are multi-week migrations for two pages.

**Approach:** a post-build script that loads `dist/index.html` in headless Chromium, navigates to each public route, and writes the settled DOM to `dist/<route>.html`. Vercel serves those files directly; the SPA fallback handles everything else.

```json
// vercel.json — order matters; specific before catch-all
{
  "rewrites": [
    { "source": "/",      "destination": "/index-prerendered.html" },
    { "source": "/about", "destination": "/about.html" },
    { "source": "/(.*)",  "destination": "/index.html" }
  ]
}
```

| ID | Requirement | Priority |
|---|---|---|
| SE-1 | Per-route `<title>` + description via a lightweight head manager | P1 |
| SE-2 | OG + Twitter Card tags | P1 |
| SE-3 | Canonical URLs | P1 |
| SE-4 | `robots.txt` — **disallow `/admin` and `/battle/*`** | P1 |
| SE-5 | `sitemap.xml` for public routes | P1 |
| SE-6 | JSON-LD `SoftwareApplication` | P1 |
| SE-7 | Prerender `/` and `/about` | P1 |

> **Why needed** PRD SEO-1..SEO-11; a public landing page now exists.
> **Reuse** The entire app. Prerendering is a build step, not an architecture change.
> **Change** ~40-line build script; `vercel.json` rewrites; a head manager (react-helmet-async, or ~20 lines of `useEffect` — **prefer the latter**; a dependency for setting `document.title` is not warranted).
> **Do NOT change** The SPA model, the router, or the provider tree.
> **Risk** Low-medium. Prerendered HTML can drift from the app if the script silently fails — **CI must assert the output files exist and contain expected text.**
> **Complexity** M.

---

## B.33 Security

> **Do NOT change** anything listed under "genuinely well done" in A.14.

| ID | Change | Priority |
|---|---|---|
| SEC-1 | Every new RLS policy / RPC reviewed against the `0009` threat model | P0 |
| SEC-2 | Quick Match must not enable room enumeration (§B.13) | P1 |
| SEC-3 | AI keys out of the bundle (§B.3) | P1 |
| SEC-4 | Rate limiting (§B.23) | P1 |
| SEC-5 | Display-name moderation (SC-4) | P1 |
| SEC-6 | Data deletion (SC-5) | P1 |
| SEC-7 | Drop the `ai_usage` client insert policy once the proxy writes it | P1 |
| SEC-8 | Add a CSP header | P1 |

**SEC-1 review checklist for any new RPC:**
- [ ] `REVOKE ... FROM public, anon` before `GRANT`?
- [ ] Internal helper? Then revoke from `authenticated` too.
- [ ] `SECURITY DEFINER` with `set search_path = ''`?
- [ ] Does it accept an identifier a caller could enumerate?
- [ ] `auth.uid() IS NULL` guarded explicitly? (`0009:706-714` documents a real bug where `NULL` short-circuit made a guard silently pass.)
- [ ] Does it expose a column the caller cannot already select?

---

## B.34 Scalability

**Current ceiling is unknown (U-8) and that is the finding.**

| Dimension | Current | First limit |
|---|---|---|
| Static hosting | Vercel CDN | Effectively none |
| Auth | Supabase GoTrue | Plan MAU |
| DB reads | PostgREST + RLS | Connection pool |
| DB writes | 6 upserts / 2 s / active user | Connection pool |
| Realtime | 1 channel per active room | **Plan message quota** |
| AI | Direct from browser | Provider rate limits |

**Realtime is the first thing that will break.** Each active room holds a channel with N subscribers receiving both Postgres Changes and Broadcast.

| ID | Change | Priority |
|---|---|---|
| SL-1 | Model realtime quota against the plan (U-8) | P1 |
| SL-2 | Sync push cost reduction (PO-4) | P1 |
| SL-3 | `battle_reap()` is called opportunistically from create/join; `0009:257-260` says to wire it to a schedule before real traffic. **pg_cron is not enabled** | P1 |
| SL-4 | `sessions` grows unbounded server-side (client caps at 400, server does not) — define retention | P2 |

---

## B.35 Deployment

| ID | Change | Priority |
|---|---|---|
| DP-1 | **CI pipeline** — lint, test, build, size budget, a11y audit | **P0** |
| DP-2 | Wire `build-icons.mjs` into `npm run build` (D-10) | P0 |
| DP-3 | Add the prerender step (§B.32) | P1 |
| DP-4 | Preview deploys per PR (Vercel default) | P0 |
| DP-5 | A staging Supabase project for migration rehearsal (C-9) | P1 |

DP-1 is P0 because without it, every test written in §B.37 is decorative.

---

## B.36 Environment configuration

**Current:** all config is `VITE_`-prefixed and therefore public. That is correct for `SUPABASE_URL`/`ANON_KEY` (public by design) and **wrong for AI keys**.

**Target split:**

| Var | Scope | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Client | Public by design |
| `VITE_SUPABASE_ANON_KEY` | Client | Public by design — RLS is the boundary |
| `VITE_SITE_URL` | Client | For OAuth redirect |
| `HCNSEC_KEY` | **Server only** | Note: no `VITE_` prefix |
| `OPENROUTER_KEY` | **Server only** | |
| `AI_ENABLED` | Server | |

> **Do NOT change** the `SUPABASE_ENABLED` / `AI_ENABLED` gating pattern. `config.js:99,112` derive booleans from presence, and every consumer null-checks. That is what keeps the three degradation tiers honest.

`.env.example` must be updated in the same commit as any variable rename, and the existing header comment in `config.js` explaining *why* the file is committed must be preserved.

---

## B.37 Testing strategy

**Vitest.** Not Jest — Vite is already the build tool, so Vitest shares the config, resolver and transform pipeline. Choosing Jest would mean maintaining a second transform config for no benefit. This is a project-fit decision, not a popularity one.

### Priority order — this order is the point

**Tier 1 — must exist before any refactor (P0):**

| Target | Why first |
|---|---|
| `lib/typing.js` — all 8 pure functions | Golden values; enforces PRD S-6 |
| `lib/gamification.js` — XP, levels, streaks, missions | Silent breakage rewrites user history |
| **Storage migration** (§B.4.1) | Seed legacy keys → assert full recovery. Guards R-2 |
| `useTypingEngine` reducer behaviour | Auto-indent, stopOnError, word-delete, gating |

**Tier 2 — before shipping (P0):**
Session contract validation · mode registry completeness (every mode resolvable; every nav entry has a mode) · sync merge functions (`unionSessions`, `sumKeyStats`, `unionAchievements`, `maxProfile`) — these are pure and currently carry two migrations' worth of scar tissue.

**Tier 3 — P1:**
Component tests for typing surfaces · a11y assertions per route · a Battlefield integration test against a local Supabase.

**Tier 4 — P2:**
E2E via Playwright · the 150 WPM synthetic latency test (§B.29 PO-1) — **though PO-1 itself is P0 as a measurement**, automating it is P2.

> **Do NOT chase a coverage percentage.** The four Tier-1 targets are pure functions whose breakage is silent and whose blast radius is user data. That is where tests earn their cost. Component tests for a redesigned UI will be rewritten with the next redesign.

---

## B.38 Backup / recovery

**Nothing exists today beyond Supabase's platform backups.**

| ID | Requirement | Priority |
|---|---|---|
| BK-1 | Confirm Supabase plan backup frequency and retention | P0 — *information gathering, not engineering* |
| BK-2 | **Rehearse migration `0010` (destructive) on a staging copy first** | P0 |
| BK-3 | Every migration reviewed for reversibility; irreversible ones flagged in-file | P0 |
| BK-4 | User-facing export (PRD AN-F9) doubles as a recovery path | P2 |
| BK-5 | Document the recovery procedure | P1 |

**BK-2 is not optional.** `0010` drops four objects. On a database where U-5 (schema drift) is unresolved, a drop could hit something unexpected.

**Client-side recovery is already sound:** the namespace migration's copy-not-move rule (§B.4.1) means the old keys remain as a rollback path for one release.

---

## B.39 Migration strategy

Sequenced so each step is independently shippable and revertible. **The order is the risk control.**

### Phase 0 — Foundation *(no user-visible change)*
| Step | Gate |
|---|---|
| 0.1 CI pipeline (DP-1) | Pipeline runs on a PR |
| 0.2 ESLint + Prettier | Lints clean; `eslint-disable` directives resolved |
| 0.3 Vitest + **Tier-1 tests** | All pass |
| 0.4 Bundle analyser (PO-3) | `index` chunk attributed |
| 0.5 **Latency measurement (PO-1)** | Baseline recorded |

> **Nothing else starts until 0.3 passes.** Tier-1 tests are what make every later step verifiable. This is the single most important sequencing decision in the document.

### Phase 1 — Safe internals *(no user-visible change)*
| Step | Gate |
|---|---|
| 1.1 Chart module split (PO-2) | `SessionSummary` pulls 0 kB recharts |
| 1.2 Mode registry (§B.19.1) | All 8 modes expressed; **stickman entry written** |
| 1.3 Session contract (§B.19.2) | 3 call sites migrated; Tier-1 still green |
| 1.4 `DIFFICULTIES` consolidated; `cx` removed | Build clean |
| 1.5 Icon build wired in (DP-2) | Icons regenerate on build |

### Phase 2 — Storage migration *(invisible if correct)*
| Step | Gate |
|---|---|
| 2.1 `migrateNamespace()` + tests | Legacy-seeded fixture recovers fully |
| 2.2 `index.html` dual-namespace theme read | No theme flash after upgrade |
| 2.3 All 6 keys switched | Manual upgrade rehearsal from a real old profile |

> **Ship Phase 2 alone.** Do not bundle it with visual changes — if progress goes missing, the cause must be unambiguous.

### Phase 3 — Brand
| Step | Gate |
|---|---|
| 3.1 Tokens + palette; **CVD/contrast re-validated** | Validator output recorded in `palette.js` |
| 3.2 New mark; icon pipeline verified | Favicon + PWA icons regenerate |
| 3.3 **Rename** — case-sensitive, word-boundary on `KeyStroke` | Both greps: zero brand hits, zero corrupted identifiers; build + tests green |
| 3.4 Metadata (title, description, manifest, banner) | Manual check |

**3.3 procedure:**
```bash
# 1. Brand occurrences only — case-sensitive, word-boundary
grep -rn '\bKeyStroke\b' src index.html public package.json assets
# 2. After replacement — corruption check; MUST return the pre-existing count
grep -rcn '\bkeystrokes\?\b' src/components/typing/useTypingEngine.js
# 3. Build + full test suite
```

### Phase 4 — Structure & redesign
4.1 Landing/dashboard split · 4.2 navigation restructure · 4.3 surface-by-surface redesign, **Battlefield last** (highest risk) · 4.4 AX-1 non-colour typing state · 4.5 a11y audit in CI.

### Phase 5 — Schema cleanup *(destructive)*
| Step | Gate |
|---|---|
| 5.1 Remove `pushProblemProgress` + pull | Sync green without it |
| 5.2 **Rehearse `0010` on staging (BK-2)** | Rehearsal succeeds |
| 5.3 Apply `0010` | Production verified |

> **Phase 5 runs last among MVP phases**, and only after 5.1 has shipped and been observed. Dropping a table the client still writes to breaks sync immediately.

### Phase 6+ — Post-MVP
AI proxy (§B.3) · rate limiting · Quick Match (§B.13) · skill rating (§B.15) · SEO (§B.32) · monitoring.

---

## B.40 Change summary

| Area | Verdict | Complexity |
|---|---|---|
| Vite + React SPA | **Keep** — D-1 | — |
| Supabase / Postgres backend | **Keep** — D-2 | — |
| `useReducer` + Context | **Keep** — D-3 | — |
| Typing engine behaviour | **Keep** — add tests | S |
| Metrics formulas | **Keep** — freeze with golden tests | S |
| Battlefield backend (`0009`) | **Keep — do not edit** | — |
| Realtime dual-transport | **Keep** | — |
| Anti-cheat model | **Keep** — extend only | S |
| Auth model | **Keep** | — |
| Sync conflict model | **Keep** — reduce push cost | S |
| CI / lint / tests | **Add** | M |
| Chart module split | **Split** | S |
| Mode registry | **Add** | M |
| Session contract | **Add** | M |
| Storage namespace | **Migrate carefully** | M |
| Dead schema | **Drop** | S |
| `TypingStage` rendering | **Measure, then decide** | S–L |
| AI proxy | **Add** (P1) | M |
| Rate limiting | **Add** (P1) | S |
| Quick Match | **Add** (P1) — security-critical | M |
| Skill rating | **Add** (P1) | M–L |
| SEO prerender | **Add** (P1) | M |
| Monitoring | **Add** (P1) | M |
| Next.js migration | **Reject** — D-1 | XL avoided |
| State library | **Reject** — D-3 | M avoided |
| Second realtime stack | **Reject** — §B.21 | L avoided |
| Service worker | **Reject this cycle** — §B.28 | M avoided |
| recharts replacement | **Defer** — measure first | L avoided |

---

## B.41 Open technical decisions

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| T-1 | Mobile typing: A, B or C? (§B.30) | Mobile scope | **B** for MVP — resolve U-4 first |
| T-2 | Replace recharts entirely? | Dashboard budget | Defer; split modules, measure, revisit |
| T-3 | Head manager: library or ~20 lines? | §B.32 | Hand-rolled — a dependency for `document.title` is unwarranted |
| T-4 | Elo vs. Glicko for rating | §B.15 | Elo — Glicko's benefit appears only at scale |
| T-5 | Drop `problem_progress` or implement it? | `0010` | Drop — nothing has written it since creation |
| T-6 | pg_cron for `battle_reap()`, or keep opportunistic? | SL-3 | Enable pg_cron before real traffic; `0009` says so itself |
| T-7 | Combat's server-arbitration need may break D-1/D-2 | Phase 4 | Flag now, decide at Phase 4 |

---

## Appendix — TRD verification

| Check | Result |
|---|---|
| Every Part A claim traced to a file read | ✅ |
| Unverified items quarantined, not asserted | ✅ §A.16, and PB-2/§B.30 state their limits inline |
| All 39 requested target sections present | ✅ §B.1–B.39 |
| Every architectural change has why/reuse/change/don't-change/risk/complexity | ✅ |
| Rejected technologies have project-specific reasons | ✅ D-1, D-3, §B.21, §B.28, §B.37 |
| Consistent with PRD requirement IDs | ✅ |
| Migration sequence is independently shippable per phase | ✅ §B.39 |
| No change proposed to `0009_battlefield.sql` | ✅ |
