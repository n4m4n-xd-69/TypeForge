# TypeForge — Pre-Execution Migration Audit

**Version:** 1.0
**Date:** 2026-08-23
**Branch:** `typeforge` @ `a4e56b1` · working tree clean
**Method:** every claim below is produced by a command that was run, not inferred. Reproduction commands are given.

> **Deletion standard for this audit:** nothing is marked for removal unless a reference count of **zero** was measured. Where a scan produced a false positive, it is shown as a false positive rather than quietly dropped.

---

# 1. Current architecture map

```
                          ┌─────────────────────────────┐
                          │  index.html                 │
                          │  pre-paint theme script     │  reads keystroke.theme
                          │  Google Fonts (2 families)  │
                          └──────────────┬──────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │  main.jsx                   │
                          │  StrictMode                 │
                          │  └ ErrorBoundary            │
                          │    └ ThemeProvider          │
                          │      └ AuthProvider ────────┼──► supabase.js ──► createClient
                          │        └ StoreProvider ─────┼──► sync.js  ⚠ EAGER, 56.67 kB gz
                          │          └ ToastProvider    │
                          │            └ BrowserRouter  │
                          │              └ App          │
                          └──────────────┬──────────────┘
                                         │
                  ┌──────────────────────▼──────────────────────┐
                  │  AppShell  (rail · header · tab bar · FAB)  │
                  └──────────────────────┬──────────────────────┘
                                         │ 11 lazy routes
   ┌──────────┬──────────┬───────────┬───┴────┬──────────┬─────────┬────────┐
   ▼          ▼          ▼           ▼        ▼          ▼         ▼        ▼
Landing   Practice   CodeTyping  Dashboard  Battle   BattleRoom  Profile  Admin
                                                                  Achievements
                                                                  AIChat · About

  ── state ──────────────────────────────────────────────────────────────
  useReducer + Context          localStorage `keystroke.*` (6 keys)
  store.jsx (7 actions)         debounced 220 ms · 400-session cap
  useStats() single selector    sync.js mirrors to Supabase (one-way)

  ── backend ────────────────────────────────────────────────────────────
  NO application server.  Postgres IS the backend.
  PostgREST (RLS) · 12 battle RPCs + 1 admin RPC · Realtime (2 transports)
  9 migrations · 16 tables · 3 views

  ── build / deploy ─────────────────────────────────────────────────────
  Vite 6 → dist/ → Vercel static + SPA rewrite-all
  manualChunks: react · charts · motion       build: 41.24 s
```

## 1.1 Directory structure — 57 `.jsx` + 31 `.js`, 88 files under `src/`

| Path | Files | Role |
|---|---|---|
| `src/components/ui/` | 13 | Primitives — Button, Modal, Toast, Select, Switch†, … |
| `src/components/typing/` | 7 | Engine + stage + visualisers |
| `src/components/layout/` | 5 | Shell, palette, FAB, error boundary, theme toggle |
| `src/components/charts/` | 3 | Charts, ChartFrame, palette |
| `src/components/battle/` | 1 | PinInput |
| `src/components/brand/` | 1 | Logo — single source for favicon + PWA icons |
| `src/components/gamify/` | 1 | MissionStrip |
| `src/lib/` | 24 | Engine maths, store, sync, auth, AI, battle, content |
| `src/modules/` | 24 | 11 route modules |

† `Switch.jsx` is dead — proven in §4.

## 1.2 Build & deployment

| Aspect | Value |
|---|---|
| Bundler | Vite 6, target `es2020` |
| Manual chunks | `react`, `charts`, `motion` |
| Build time | 41.24 s |
| Host | Vercel, `framework: vite`, `outputDirectory: dist` |
| Routing | `rewrites: [{ "/(.*)" → "/index.html" }]` + `public/_redirects` |
| Icons | `scripts/build-icons.mjs` — **not wired into `npm run build`** |
| CI | **None** |
| Env | 7 `VITE_`-prefixed vars; AI keys inlined into the bundle |

---

# 2. Current feature inventory

| # | Feature | Route | Backing | State |
|---|---|---|---|---|
| 1 | Prose typing, 6 modes | `/practice` | `useTypingEngine`, `content.js` | ✅ Working |
| 2 | Code typing, 11 languages, 116 snippets | `/code` | `snippets/`, `prism.js` | ✅ Working |
| 3 | Battlefield 2–8 players | `/battle`, `/battle/:pin` | `0009` + Realtime | ✅ Working |
| 4 | Analytics — 9 chart surfaces | `/dashboard` | `sessions`, `key_stats` | ✅ Working |
| 5 | XP, 9 levels, streaks, 3 daily missions | all | `gamification.js` | ✅ Working |
| 6 | 19 achievements, 4 tiers | `/achievements` | `gamification.js` | ✅ Working |
| 7 | XP leaderboard, top 100 | `/achievements` | `leaderboard` view | ✅ Working |
| 8 | Profile, 24 avatars, opt-out | `/profile` | `profiles` | ✅ Working |
| 9 | Auth — email, Google, guest, upgrade | overlay | GoTrue | ✅ Working |
| 10 | Cloud sync, one-way mirror | — | `sync.js` | ✅ Working |
| 11 | AI — 8 surfaces, 2 providers, hedged | `/chat` + inline | `ai-runner.js` | ✅ Working |
| 12 | Admin — users, AI cost, auth events | `/admin` | `is_admin()` | ✅ Working |
| 13 | Command palette, 21+ commands | ⌘K | `CommandPalette.jsx` | ✅ Working |
| 14 | Light/dark, no FOUC | all | `theme.jsx` + inline script | ✅ Working |
| 15 | Full offline operation | all | localStorage | ✅ Working |
| 16 | PWA manifest + icons | — | `build-icons.mjs` | ⚠️ Manual step |

**Zero broken features found.** Every route renders; the build passes; there are **no `TODO`/`FIXME`/`HACK` markers anywhere in `src/`**.

---

# 3. Keep / Modify / Remove / Replace

## 3.1 Backend — 0 changes, 6 additive migrations

| Object | Decision | Reason |
|---|---|---|
| `0001`–`0008` | **KEEP** | Untouched. `0006`/`0008` encode a fixed identity bug |
| **`0009_battlefield.sql`** | **KEEP — never edit** | Every anti-cheat property lives here |
| `learn_progress`, `problem_progress`, `beta_votes`, `beta_vote_tally` | **REMOVE** | Zero writers — §4.1 |
| `profiles`, `battle_rooms`, `battle_players`, `auth_events`, `ai_usage` | **MODIFY** | Additive columns only |
| Everything else | **KEEP** | 10 tables unchanged |

## 3.2 Core engine — KEEP, add tests

| File | Decision | Reason |
|---|---|---|
| `lib/typing.js` | **KEEP** — formulas frozen | Changing them rewrites user history |
| `lib/gamification.js` | **KEEP** — formulas frozen | Same |
| `components/typing/useTypingEngine.js` | **MODIFY** — minimal | Emit the session contract; add a streak counter; **behaviour unchanged** |
| `lib/sync.js` | **MODIFY** — minimal | Remove the dead `problem_progress` path. **Never remove `hydratedRef`** |
| `lib/storage.js` | **KEEP** | try/catch discipline is load-bearing |
| `lib/supabase.js` | **MODIFY** | Lazy-load the client (§6), drop the dead export |
| `lib/battle/*` | **KEEP** | Clock, API, room hook all correct |

## 3.3 UI — modify in place, replace two

| Area | Decision | Reason |
|---|---|---|
| `index.css` tokens | **REPLACE** | New palette, both themes |
| `tailwind.config.js` | **MODIFY** | Type scale, radius, elevation |
| `components/ui/*` | **MODIFY** | Restyle; keep component contracts |
| `components/ui/Switch.jsx` | **REMOVE or ADOPT** | Dead today; `Profile.jsx` hand-rolls one. **Adopt it** — cheaper than deleting and rebuilding |
| `components/charts/Charts.jsx` | **REPLACE** (split) | `primitives.jsx` + `recharts.jsx` |
| `components/charts/palette.js` | **KEEP** ramp, re-verify | ΔE-validated; dark ramp already clears the new surface |
| `components/brand/Logo.jsx` | **REPLACE** | New mark; keep the single-source property |
| `AppShell.jsx` | **MODIFY** | 5 nav items, focus mode, delete the tagline. **Keep the rail geometry** |
| `TypingStage.jsx` | **MODIFY** | Non-colour state cues; measure before optimising |
| `SessionSummary.jsx` | **MODIFY** | Modal → inline |
| `modules/landing/Landing.jsx` | **SPLIT** | → new `landing/` (Marquee) + `home/` (Console) |
| All other modules | **MODIFY** | Restyle to archetype |

## 3.4 Dependencies

| Package | Decision | Evidence |
|---|---|---|
| `react`, `react-dom`, `react-router-dom` | **KEEP** | 53 / 6 / 16 files |
| `lucide-react` | **KEEP** | 33 files, tree-shakes correctly |
| `framer-motion` | **KEEP, reduce reach** | 28 files, but must leave `Primitives.jsx` |
| `@supabase/supabase-js` | **KEEP, lazy-load** | 1 file, but **56.67 kB gzip eager** |
| `prismjs` | **KEEP** | 1 file, 7.33 kB gzip, grammars lazy |
| `recharts` | **KEEP, isolate** | 1 file, 112.99 kB gzip |
| `clsx` | **REMOVE** | §5 |
| `sharp` (dev) | **KEEP** | Icon generation |

---

# 4. Dead code report — **proven, not inferred**

Reproduce: `node scratchpad/deadcode.mjs src` then per-item verification below.

## 4.1 Dead files

| File | Evidence | Decision |
|---|---|---|
| `components/ui/Switch.jsx` | `grep -rn "Switch" src` returns only the substring "Switch to …" in two theme labels. **Zero imports.** | **ADOPT in `Profile.jsx`** rather than delete — `Profile.jsx:311` hand-rolls the same control (design brief PR-2) |

**False positive corrected:** `lib/prism-setup.js` was flagged, but `prism.js:1` imports it side-effect style (`import './prism-setup.js'` — no `from`). **Not dead.** The 11 route modules were also flagged; all are `lazy(() => import(...))` in `App.jsx`. **Not dead.**

## 4.2 Dead exports — occurrence count of exactly 1 (the declaration itself)

Reproduce: `grep -rc "\bNAME\b" --include="*.js" --include="*.jsx" src | awk -F: '{s+=$2} END {print s}'`

| File | Export | Count | Note |
|---|---|---|---|
| `components/ui/Motion.jsx` | `LiftCard` | 1 | |
| `components/ui/Motion.jsx` | `PageIntro` | 1 | |
| `components/ui/Primitives.jsx` | `CardBody` | 1 | |
| `components/ui/Primitives.jsx` | `Divider` | 1 | |
| `lib/motion.js` | `EASE_SPRING` | 1 | Only `useReducedMotionSafe` is consumed |
| `lib/motion.js` | `fadeIn` | 1 | |
| `lib/motion.js` | `scaleIn` | 1 | |
| `lib/motion.js` | `hoverPop` | 1 | |
| `lib/content.js` | `PASSAGES` | 1 | Zen uses `randomWords`, not this |
| `lib/typing.js` | `KEY_ROWS` | 1 | **Also duplicated** — see below |
| `lib/supabase.js` | `currentUserId` | 1 | **Comment is wrong** — see below |

**Two of these carry a second defect:**

- **`typing.js` `KEY_ROWS`** — `KeyboardViz.jsx:21` defines its **own local `ROWS`** and imports only `HOME_KEYS, keyFor`. So the exported constant is dead *and* the keyboard layout is defined twice. Removing the dead copy also removes a divergence risk.
- **`supabase.js` `currentUserId`** — never called. `logAiUsage` reads the module-scoped `cachedUserId` directly. The file's own comment (lines 29–35) claims this export *"is what lets `ai-runner.js` attribute a usage row"* — **the comment describes a mechanism that is not used.** Fix the comment or delete the export; do not leave both.

## 4.3 Unused imports — every one verified at exactly 1 occurrence

| File | Import |
|---|---|
| `components/layout/AppShell.jsx` | `useRef` |
| `components/typing/HandGuide.jsx` | `cx` |
| `lib/store.jsx` | `useCallback` |
| `modules/about/About.jsx` | `BookOpen` |
| `modules/profile/Profile.jsx` | `User` |

## 4.4 Dead schema

| Object | Evidence |
|---|---|
| `learn_progress` | Writer deleted in `d1d2ed9`; zero references in `src/` |
| `problem_progress` | `sync.js:181` writes it, but `store.jsx:19-22` states *"Nothing writes this yet"* — the source is always empty |
| `beta_votes`, `beta_vote_tally` | Client `betaVote.js` deleted in `d1d2ed9` |

## 4.5 Dead CSS

| Class | Files using it | Decision |
|---|---|---|
| `aurora`, `liquid-glass`, `glow-panel` | **8 files** — AppShell, ChatFab ×2, About ×8, AIChat, Landing, Onboarding, Profile | **Not dead — being retired.** A Phase 2 task with a real file list |

**Total proven dead: 1 file, 11 exports, 5 imports, 4 schema objects. Nothing else.**

---

# 5. Unused dependency report

Reproduce: the dependency section of `deadcode.mjs`.

| Package | Files | Verdict |
|---|---|---|
| `react` | 53 | Essential |
| `lucide-react` | 33 | Essential |
| `framer-motion` | 28 | Justified — but see §6 |
| `react-router-dom` | 16 | Essential |
| `react-dom` | 6 | Essential |
| `@supabase/supabase-js` | 1 | Essential, correctly isolated — but eagerly loaded |
| `prismjs` | 1 | Justified, 7.33 kB gzip |
| `recharts` | 1 | Justified for Dashboard/Admin only |
| **`clsx`** | **1** | **REMOVE** |

**`clsx` is the only removable dependency.** `format.js:1-3` imports it and re-exports it unchanged as `cx`. That is a dependency, a build edge and an indirection for one aliasing line. Replace with a 5-line local `cx`, or import `clsx` directly at the ~40 call sites. **Recommendation: keep the `cx` name, drop the package** — a local implementation is smaller than the import machinery.

**No unused dev dependencies.** `sharp` drives `build-icons.mjs`.

---

# 6. Performance issue report — **measured**

## 6.1 Bundle attribution — the `index` chunk resolved

The 383 kB chunk was unattributed in every prior document. Split it temporarily and it resolves exactly:

| Chunk | Raw | **Gzip** |
|---|---|---|
| `charts` (recharts) | 421.30 kB | **112.99 kB** |
| **`supabase`** | 215.57 kB | **56.67 kB** |
| `react` | 165.58 kB | **54.18 kB** |
| `index` (remainder: lucide + shell + libs) | 148.17 kB | **50.85 kB** |
| `motion` | 115.28 kB | **38.27 kB** |
| `prism` | 19.22 kB | 7.33 kB |
| `index.css` | 60.01 kB | 11.03 kB |

`383.06 − 215.57 − 19.22 = 148.27` ✓ — attribution is complete and exact.

## 6.2 🔴 P-1 — The landing budget is currently **unachievable**

PRD NFR-PERF-1 caps the landing route at **150 kB gzip**. Three libraries load on it eagerly:

```
react     54.18
motion    38.27
supabase  56.67
          ──────
          149.12 kB gzip   =  99.4% of the entire budget
                              before one line of TypeForge code
```

**Proven load chain** (`main.jsx:5` → `auth.jsx:2` → `supabase.js:16` `createClient` at module scope):

```
main.jsx → AuthProvider → supabase.js → createClient   ← EAGER, every route
```

`@supabase/supabase-js` loads on a **public marketing page that needs no auth and works offline**.

**Two fixes, in order of preference:**

| Option | Effect | Cost |
|---|---|---|
| **(a) Lazy-load the Supabase client** — dynamic `import()` inside `auth.jsx`, gated on `SUPABASE_ENABLED` | −56.67 kB on **every** route, not just landing | M — every consumer must tolerate an async client. `supabase.js` already returns `null` when unconfigured, so **the null-handling contract already exists** |
| (b) Serve `/` as prerendered static HTML that never boots the SPA | −149 kB on landing only | M–L, and it duplicates the typing demo |

**Recommendation: (a).** It reuses a contract the codebase already has, and it benefits every route rather than one.

## 6.3 🔴 P-2 — recharts loads for components that do not use it

`Charts.jsx` exports 5 components; **`Sparkline` (line 302) and `Heatmap` (line 158) contain no recharts** — they are hand-rolled SVG. Module-level import means every consumer pays 112.99 kB gzip:

| Importer | Uses recharts? | Pays |
|---|---|---|
| `SessionSummary.jsx` | ❌ `Sparkline` only | 112.99 kB — **on every completed run** |
| `Landing.jsx` | Partly | 112.99 kB |
| `UsersTab.jsx` | ❌ `Heatmap` only | 112.99 kB |

## 6.4 🟡 P-3 — framer-motion reaches 22 extra components

`Primitives.jsx:1` imports framer-motion for `ProgressBar` and `ProgressRing` alone. **22 of 57 components import `Primitives`**, so all 22 inherit a 38 kB dependency for two width/stroke animations that CSS transitions do identically.

## 6.5 🟡 P-4 — `TypingStage` per-keystroke cost — **structural, latency unmeasured**

Two facts, read from source:
1. `Passage` renders **one `<span>` per character** and is explicitly memo-free (`TypingStage.jsx:273-276`). Battle passages reach **4,000 characters** (`0009:301`).
2. `useLayoutEffect` runs `querySelector` + `getBoundingClientRect` **on every index change** — a forced synchronous layout per keystroke.

**No latency claim is made.** Phase 0 task 0.6 measures it before anything is optimised.

## 6.6 🟡 P-5 — sync pushes the full snapshot on every change
`sync.js:471-478` — 2 s debounce then **6 upserts**, `pushSessions` sending up to 400 rows. Correct and idempotent, but grows linearly with history.

---

# 7. Security issue report

## 7.1 What is already correct — preserve exactly

| Property | Location |
|---|---|
| RLS is the enforcement boundary; anon key public by design | `0001`, `supabase.js:4-15` |
| `REVOKE … FROM public, anon` before every `GRANT` | `0009:775-783` |
| Internal functions revoked from `authenticated` too | `0009:800-807` |
| Server owns the clock; WPM recomputed server-side | `0009:629-649` |
| Passage unreadable before countdown | `0009:192-195` |
| Rooms not selectable by PIN | `0009:180-183` |
| Realtime topic is the room UUID, never the PIN | `useBattleRoom.js:132-135` |
| Leaderboard exposes 4 columns only | `0005`, `0007` |
| No self-service admin promotion | `0002` |
| `search_path = ''` on every definer function | throughout |

## 7.2 Open issues

| # | Issue | Severity | Evidence | Fix |
|---|---|---|---|---|
| S-1 | **AI keys inlined into the client bundle** | High | `.env.example` ships `VITE_HCNSEC_KEY`; `config.js:13-18` documents it | AI proxy (Phase 8 / P1) |
| S-2 | `ai_usage` is client-reported, advisory only | Medium | `0002` says so | Proxy becomes sole writer |
| S-3 | No rate limiting beyond a 3-room host cap | Medium | `0009:310-314` is the only limit | Postgres-side counters |
| S-4 | No display-name moderation | Medium | `display_name` → `leaderboard` unfiltered | `moderation_reports` |
| S-5 | No cloud data-deletion path | **High — likely compliance** | `resetAll()` clears local only | `profile_delete_self()` |
| S-6 | `auth_events` allows an anonymous insert | Low | Scoped to `event = 'failed'` only | **Accept** — a failed login has no session |

## 7.3 New risk introduced by the plan

| Change | Risk | Mitigation |
|---|---|---|
| Quick Match | Reintroduces room enumeration | RPC takes **no PIN input**; table policy untouched; limit clamped |
| `battle_rematch` | Bypasses the 3-room cap | Must re-run every `battle_create` check |
| Rating in `battle_settle` | A bug fails the finish transaction | Build standalone; test on seeded data |

---

# 8. UX issue report

| # | Issue | Evidence | Sev |
|---|---|---|---|
| U-1 | **One layout for every job** — Practice, Code, Dashboard, Achievements, Profile all render as `space-y-3` card grids | 5 modules | 1 |
| U-2 | **Typing surfaces are not focus surfaces** — nothing recedes when typing starts | `Practice.jsx`, `CodeTyping.jsx` | 1 |
| U-3 | **Typing state relies on colour** — `wrong` vs `pending` separate by **1.06:1** | measured, §4 design brief | 1 |
| U-4 | **Results are a modal** — a mandatory dismissal click on the tightest loop | `SessionSummary.jsx:40` | 1 |
| U-5 | **`whyWon()` is a grey subtitle** — the one thing that makes a mistakes-first ranking legible | `ResultsView.jsx:71` | 1 |
| U-6 | **Weak keys are 8th of 9** on the dashboard — the only actionable element, buried | `Dashboard.jsx:180` | 1 |
| U-7 | **Solo → competing is impossible** without a code from another human | no discovery path exists | 1 |
| U-8 | Home serves two incompatible jobs | `Landing.jsx:214` | 1 |
| U-9 | Cheat flags surface only as a hover `title` | `ResultsView.jsx:153` | 2 |
| U-10 | Cycling tagline — 15s on, 30s off, forever, on the most persistent surface | `AppShell.jsx:397-439` | 2 |
| U-11 | "Module 01/02/06" eyebrows imply a curriculum deleted in `d1d2ed9` | 4 modules | 2 |
| U-12 | Skill-radar axes are arbitrary constants presented as objective | `Dashboard.jsx:56-63` | 2 |
| U-13 | Primary info `hidden` below `xl` rather than reflowed | `Landing.jsx:286` | 2 |
| U-14 | Tables force horizontal scroll at `min-w-[560px]` | `Dashboard.jsx:209` | 2 |
| U-15 | Locked badges at `opacity-60` push hint text under AA | `Achievements.jsx:217` | 2 |
| U-16 | Leaderboard row keys are index+name — production has two players called "Meow" | `Achievements.jsx:151-155` | 3 |

---

# 9. Technical debt report

| # | Debt | Evidence | Sev |
|---|---|---|---|
| D-1 | **Zero tests** | no test files, no runner | **Critical** |
| D-2 | **No CI** | no workflow | **Critical** |
| D-3 | **No lint config, yet 4 orphan `eslint-disable` directives** | `AppShell.jsx:110`, `useTypingEngine.js:90`, `Practice.jsx:77,154` | High |
| D-4 | **The ΔE validator does not exist** — `palette.js:14` instructs re-running a tool absent from the repo | `ls scripts/` | High |
| D-5 | Mode knowledge scattered across 5 files | `Practice`, `AppShell`, `CommandPalette`, `Battle`, `content` | High |
| D-6 | `DIFFICULTIES` defined 3× in 2 shapes | as above | Medium |
| D-7 | Session object hand-assembled at 3 call sites | `Practice:164`, `CodeTyping:125`, `RaceView:63` | High |
| D-8 | `sync.js` writes a table nothing reads | `sync.js:181` | Medium |
| D-9 | Prism token colours hardcoded outside the token system | `index.css:350-432` | Medium |
| D-10 | Achievement tier colours hardcoded | `gamification.js:112-117` | Medium |
| D-11 | Icon generation not in the build | `build-icons.mjs` | Medium |
| D-12 | Keyboard layout defined twice | `typing.js:91` vs `KeyboardViz.jsx:21` | Low |
| D-13 | `currentUserId` comment describes an unused mechanism | `supabase.js:29-35` | Low |
| D-14 | `check-contrast.mjs` duplicates palette values | script vs `index.css` | Low |

**Credit where due:** zero `TODO`/`FIXME`/`HACK` markers in 88 files. Comment quality is unusually high and several comments record real bugs with their causes. **This is a well-maintained codebase with missing infrastructure, not a messy one.**

---

# 10. Migration sequence

```
STEP 0  Instrumentation ─────────── no product change
   │    tests · lint · CI · baselines · mobile decision
   │    GATE: CI green, latency + a11y baselines recorded
   ▼
STEP 1  Safe deletions ──────────── no product change
   │    1 dead file · 11 dead exports · 5 unused imports · clsx
   │    GATE: build + tests green, bundle unchanged or smaller
   ▼
STEP 2  Bundle fixes ────────────── no visual change
   │    split Charts · unhook motion from Primitives · lazy supabase
   │    GATE: landing < 150 kB gzip PROVEN in build output
   ▼
STEP 3  Rebrand ─────────────────── visible
   │    mark · tokens · rename (case-sensitive, anchored)
   │    GATE: two greps
   ▼
STEP 4  Storage migration ───────── SHIPS ALONE
   │    keystroke.* → typeforge.*, copy-not-move
   │    GATE: legacy fixture recovers full progress
   ▼
STEP 5  Foundation ──────────────── visible
   │    registry · session contract · nav · focus mode
   ▼
STEP 6  Core UX ─────────────────── visible
   │    landing/home split · Stage discipline · inline results
   ▼
STEP 7  Code · 8 Competitive · 9 Progression   (parallelisable)
   ▼
STEP 10 Future arch · 11 Polish · 12 QA
   ▼
        0010 destructive migration ── LAST, after staging rehearsal
```

**Three rules that are not negotiable:**

1. **Step 0 gates everything.** Without golden-value tests, a refactor that silently changes the XP formula ships unnoticed.
2. **Step 4 ships alone.** If progress goes missing after an upgrade, the bisect must be one commit.
3. **`0010` runs last.** It drops `problem_progress`, which `sync.js:181` still writes to.

**Step 2 is promoted ahead of the rebrand** — a departure from `06-implementation-plan.md`. Reason: §6.2 proves the landing budget is currently unachievable, and discovering that *after* building the landing page would mean rebuilding it. **Prove the budget is reachable before designing to it.**

---

# 11. Exact implementation order

| Step | Work | Product change | Reversible |
|---|---|---|---|
| 0 | Vitest, ESLint, CI, Tier-1 tests, baselines, mobile test | None | n/a |
| 1 | Delete proven dead code; drop `clsx` | None | `git revert` |
| 2 | Split `Charts.jsx`; unhook framer-motion from `Primitives`; lazy-load Supabase | None | `git revert` |
| 3 | Logo, tokens, typography, brand rename, metadata | Visible | `git revert` |
| 4 | Storage namespace migration — **alone** | Invisible if correct | Revert + old keys intact |
| 5 | Mode registry, session contract, nav, focus mode | Structural | `git revert` |
| 6 | Landing/home split, Stage discipline, inline results, Progress | Visible | Per-surface |
| 7 | Code practice Stage | Visible | Single module |
| 8 | Battlefield redesign, Quick Match, rematch (`0013`) | Visible | `is_public` defaults false |
| 9 | Rating, boards, awards (`0011`, `0014`) | Visible | `rated` defaults false |
| 10 | Stickman registry entry, combat spec | None | n/a |
| 11 | Motion, states, a11y, SEO, mobile | Visible | Per-item |
| 12 | QA, then `0010` | None | **`0010` is irreversible** |

## 11.1 First 10 files to modify

Steps 0–2 only. **None changes what a user sees** — every one is verification or bundle work, which is exactly what makes them safe to do first.

| # | File | Change | Why first | Risk |
|---|---|---|---|---|
| 1 | `package.json` | Add `vitest`, `eslint`, `prettier`; add `test`/`lint` scripts; wire `build-icons` into `build` | Nothing else is verifiable without a runner. Fixes D-11 | None |
| 2 | `vitest.config.js` **(new)** | Test config sharing Vite's transform | Vitest over Jest — no second toolchain | None |
| 3 | `src/lib/typing.test.js` **(new)** | Golden values for all 8 pure functions | Freezes the metric definitions before any refactor | None |
| 4 | `src/lib/gamification.test.js` **(new)** | Golden values for XP, levels, streaks, missions | **Guards R-5** — the highest-consequence silent failure | None |
| 5 | `eslint.config.js` **(new)** | Flat config; resolve the 4 orphan directives | Fixes D-3 | None |
| 6 | `.github/workflows/ci.yml` **(new)** | lint → test → build → size budget | Without CI, every test written is decorative | None |
| 7 | `src/lib/format.js` | Replace the `clsx` re-export with a local `cx`; drop the dependency | Smallest proven removal; touches one line | **Low** — `cx` signature unchanged; build proves the ~40 call sites |
| 8 | `src/components/charts/Charts.jsx` | Split → `primitives.jsx` (SVG) + `recharts.jsx`; update 6 importers | −112.99 kB gzip from `SessionSummary`, fires on **every completed run** | **Low** — pure move; build catches a missed import |
| 9 | `src/components/ui/Primitives.jsx` | `ProgressBar`/`ProgressRing` → CSS transitions; drop framer-motion | Unhooks 38 kB from 22 components | **Low** — visual diff on two components |
| 10 | `src/lib/supabase.js` + `src/lib/auth.jsx` | Lazy `import()` the client behind `SUPABASE_ENABLED` | **−56.67 kB gzip on every route.** Without it the landing budget is unreachable | **Medium** — the only one needing care; the `null` contract already exists |

**Ordering within the ten is deliberate:** 1–6 build the safety net, 7–9 are mechanical wins the net now protects, and 10 — the only one with real risk — is done last, when tests and CI can catch a regression.

## 11.2 Expected impact

**Bundle, after steps 1–2:**

| Route | Now (gzip) | After | Change |
|---|---|---|---|
| Landing `/` | ~262 kB | **~93 kB** | **−65%** |
| Practice | ~150 kB | ~93 kB | −38% |
| Result panel | +112.99 kB | **+0 kB** | **−100%** |
| Dashboard | ~262 kB | ~206 kB | −21% |

*Landing "now" = react + motion + supabase + charts. "After" = react + motion, with charts split, supabase lazy.* Verified against the measured table in §6.1; re-measured at the step-2 gate.

**Code:** −1 file, −11 exports, −5 imports, −1 dependency, −1 duplicated constant.
**Quality:** 0 → ~40 tests on the two files whose silent breakage corrupts user data. 0 → 1 CI pipeline.
**Product:** **unchanged.** No user-visible difference after ten files.

## 11.3 Rollback strategy

| Layer | Mechanism | Notes |
|---|---|---|
| Client | Vercel instant rollback to the previous deployment | Seconds |
| Commits | One commit per step, each independently revertible | Every step ends green |
| **Storage migration** | **Copy-not-move: `keystroke.*` keys survive one full release** | Reverting the build restores an app that reads its own data. **This is why copy-not-move is mandatory, not merely tidy** |
| Additive migrations (`0011`–`0014`) | Feature-flagged: `is_public` and `rated` default `false` | Revert the client; the columns sit inert |
| **Destructive migration (`0010`)** | **None. Irreversible.** | Runs last, after a staging rehearsal, after the client stops writing |
| Branch | All work on `typeforge`; `main` untouched | `d1d2ed9` is the last known-good state |

**Per-step rollback triggers:**

| Step | Roll back if |
|---|---|
| 1 | Build fails or any test regresses |
| 2 | Landing budget not proven under 150 kB gzip |
| 3 | Either brand grep fails |
| 4 | **Legacy fixture does not recover full progress** — hard stop |
| 5 | Stickman registry entry needs a core change |
| 8 | Any Battlefield security property cannot be re-verified |
| 9 | XP output is not byte-identical for the golden set |

---

## Appendix — verification of this audit

| Check | Result |
|---|---|
| Architecture map, feature inventory, decision table | ✅ §1–3 |
| Dead code **proven by measured reference counts** | ✅ §4 — 1 file, 11 exports, 5 imports |
| False positives reported rather than dropped | ✅ `prism-setup.js`, 11 lazy modules |
| Unused dependency identified | ✅ §5 — `clsx`, one |
| Performance **measured**, `index` chunk attributed exactly | ✅ §6.1 — arithmetic checks |
| Landing budget shown unachievable, with the proven load chain | ✅ §6.2 |
| Latency claimed only as structural, not measured | ✅ §6.5 |
| Security, UX, debt reports traced to files and lines | ✅ §7–9 |
| Migration sequence with gates | ✅ §10 |
| First 10 files, impact, rollback | ✅ §11 |
| Nothing marked for deletion without zero-reference proof | ✅ |
| **No code written** | ✅ |
