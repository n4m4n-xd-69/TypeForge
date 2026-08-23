# Stage 0 — Codebase Audit

**Project:** KeyStroke (to be rebranded TypeForge)
**Date:** 2026-08-23
**Branch:** `main` @ `27d7a1e`
**Method:** Every claim below is traceable to a file I opened or a command I ran. Claims I could not verify are marked **[UNVERIFIED]** and listed in §9.

---

## 1. What this application actually is

A **client-side single-page React application** with no backend server of its own. It is a static Vite bundle deployed to Vercel (`vercel.json`), with all persistent server logic implemented inside **Postgres itself** via Supabase (RLS policies + `SECURITY DEFINER` functions).

| Layer | Technology | Evidence |
|---|---|---|
| Build | Vite 6, `@vitejs/plugin-react` | `package.json:28`, `vite.config.js` |
| UI | React 18.3, react-router-dom 6 | `package.json:18-20` |
| Styling | Tailwind 3.4 + CSS custom properties | `tailwind.config.js`, `src/index.css` |
| Motion | framer-motion 11 | used in **28 files** |
| Icons | lucide-react | used in **33 files** |
| Charts | recharts 2.15 | used in **1 file** (`Charts.jsx`) |
| Syntax | prismjs 1.30 | `src/lib/prism.js`, `prism-setup.js` |
| Cloud | @supabase/supabase-js 2.111 | `src/lib/supabase.js` only |
| Hosting | Vercel, SPA rewrite-all | `vercel.json` |

**Critical architectural property:** the app is fully functional with **zero** cloud configuration. `SUPABASE_ENABLED` (`config.js:112`) gates every cloud path; `AI_ENABLED` (`config.js:99`) gates AI. Local state in `localStorage` is the source of truth and cloud sync is a one-way mirror (`store.jsx:183-191`). This is a genuine strength and must be preserved.

---

## 2. Routes (existing — verified in `src/App.jsx`)

| Route | Module | Purpose | Notes |
|---|---|---|---|
| `/` | `modules/landing/Landing.jsx` | Home | **Dual-purpose**: marketing hero when `stats.isNew`, personal dashboard otherwise (`Landing.jsx:214`) |
| `/practice` | `modules/practice/Practice.jsx` | Prose typing | 6 modes: time, words, quote, drill, custom, zen (`Practice.jsx:26-33`) |
| `/code` | `modules/code/CodeTyping.jsx` | Code typing | 11 languages (`content.js:56-68`), AI sidebar, snippet chat |
| `/dashboard` | `modules/dashboard/Dashboard.jsx` | Analytics | Trend, radar, heatmap, weekly bars |
| `/achievements` | `modules/achievements/Achievements.jsx` | Rewards | 19 achievements (`gamification.js:90-110`) |
| `/chat` | `modules/chat/AIChat.jsx` | AI coach | Also floats everywhere via `ChatFab` |
| `/battle` | `modules/battle/Battle.jsx` | Battlefield hub | Create or join by 6-char PIN |
| `/battle/:pin` | `modules/battle/BattleRoom.jsx` | Room | Phase-driven: lobby → countdown → race → results |
| `/profile` | `modules/profile/Profile.jsx` | Account | Name, avatar, goal, leaderboard opt-out, data reset |
| `/about` | `modules/about/About.jsx` | About + help AI | Contact cards, help assistant |
| `/admin` | `modules/admin/AdminPanel.jsx` | Operator view | Not in nav; DB-enforced via `is_admin()` |
| `*` | → `/` | Catch-all redirect | |

**No public marketing page exists.** `/` is the app home. A signed-out visitor lands directly in a personal dashboard.

---

## 3. Data model (existing — `supabase/migrations/`)

Nine migrations, `0001`–`0009`. All tables have RLS enabled.

### Core (0001)
`profiles`, `sessions`, `daily_stats`, `key_stats`, `learn_progress`, `problem_progress`, `achievements`
- Policy shape: `auth.uid() = user_id` for all.
- `handle_new_user()` trigger creates a `profiles` row on signup.

### Admin (0002)
`user_roles` (enum `app_role`), `auth_events`, `ai_usage`
- `is_admin()` — `SECURITY DEFINER`, prevents RLS recursion.
- `admin_user_overview()` — function, not a view, because it joins `auth.users`.
- `admin_daily` — `security_invoker` view.
- **No self-service path to admin exists by design** (`0002` closing comment).

### Chat & votes (0003)
`chat_messages`, `beta_votes`, `beta_vote_tally` (public view)

### Seed (0004)
Promotes `admin@keystroke.ai` to admin. **Brand-coupled identifier.**

### Leaderboard (0005, rebuilt in 0007)
`leaderboard` view — `display_name`, `avatar`, `xp`, `rank()`. Deliberately narrow; honours `hide_from_leaderboard`.

### Repairs (0006, 0008)
Two migrations fixing a session-duplication bug caused by float/timestamp round-tripping through Postgres. Final identity is `(user_id, ts)` (`0008`).

### Battlefield (0009) — the most sophisticated part of the system
`battle_rooms`, `battle_passages`, `battle_players`, `battle_results` + **15 RPC functions**.

Notable engineering already present:
- Passage held in a separate table readable only after countdown starts — prevents lobby-sitters pre-reading the text (`0009:34-38`).
- Server owns the clock (`battle_server_time()`, `starts_at` written inside Postgres) — the one number a cheating client cannot move (`0009:629-632`).
- WPM **recomputed server-side**; `client_wpm` kept only to make divergence visible.
- Anti-cheat flags: `over-length`, `impossible-speed` (>20 chars/sec).
- `FOR UPDATE` row lock makes the capacity check race-free (`0009:357-359`).
- Explicit `REVOKE ... FROM public, anon` before `GRANT` — closes the default `PUBLIC` execute grant (`0009:775-783`).
- Realtime publication + `replica identity full` on the three battle tables.

**This is production-quality work and should be preserved essentially as-is.**

---

## 4. Client state

| Store | Key | File |
|---|---|---|
| App state | `keystroke.state.v2` | `store.jsx:9` |
| Chat | `keystroke.chat.v2` | `chatStore.js:16` |
| Theme | `keystroke.theme` | `theme.jsx:3`, also read in `index.html:34` |
| Rail pinned | `keystroke.rail.pinned` | `AppShell.jsx:68` |
| Sync adoption | `keystroke.adopted` | `sync.js:28` |
| Code intro panel | `keystroke.code.introOpen` | `IntroPanel.jsx:9` |

State shape (`store.jsx:11-41`): `profile`, `xp`, `streak`, `sessions` (capped 400), `keyStats`, `achievements`, `problems`, `daily`, `settings` (14 keys).

Persistence is debounced 220 ms (`store.jsx:194-205`). `storage.js` wraps every access in try/catch — private-mode and quota failures degrade to "forgets things" rather than a blank page.

---

## 5. Design system (existing)

Genuinely considered, and better than typical. Do not discard it — evolve it.

**Tokens** (`src/index.css:10-96`): colours as `R G B` triplets so Tailwind opacity modifiers work. Dark mode is a *selected* set of steps, not an inversion, with documented contrast ratios per token (`--ink-2` 7.7:1, `--ink-3` 4.7:1, `--brand` 11.5:1).

**Scale** (`tailwind.config.js`): 8px spacing grid; custom `fontSize` scale with per-step letter-spacing; radius `6→32px`; five-step shadow scale; two easing curves (`out`, `spring`).

**Type**: Manrope (sans) + JetBrains Mono (mono), loaded from Google Fonts (`index.html:25-28`).

**Chart palette** (`components/charts/palette.js`): CVD-validated, with recorded validator output. Light mode carries a documented contrast WARN, mitigated by shipping a legend + table view on every chart. Comment explicitly warns not to reorder the slots.

**Effects**: `.glass`, `.liquid-glass`, `.glow-panel`, `.aurora`, `.shimmer-sweep`, `.grad-text`, `.pop-in`.

**Brand mark** (`components/brand/Logo.jsx`): vectorised "K" glyph, 14-edge polygon, measured to 99.8% IoU against source raster. Colours are hardcoded literals *deliberately* — a mark that shifts with the palette is not a mark. Feeds favicon/PWA icons via `scripts/build-icons.mjs`.

**Assessment against the TypeForge brief:** The current identity is *lime-green + warm-neutral, calm, editorial*. The brief asks for *fast, precise, competitive, futuristic, energetic*. The token **architecture** is reusable; the **palette and mark are not** — they encode the wrong personality. §4 of the design brief will address this.

---

## 6. Technical debt — verified findings

### 6.1 The working tree is mid-surgery — **BLOCKER**
`git status` shows **8,713 uncommitted deletions across 37 files**. The entire `Learn` module has been ripped out but never committed:
- Deleted: `src/modules/learn/{Learn,LessonView,BetaBanner}.jsx`, `src/lib/curriculum.js`, `src/lib/paths.generated.js` (4,384 lines), `src/lib/betaVote.js`, `scripts/build-learn.mjs`, `content/learn/python.md` (2,088 lines).
- Modified: 20 source files, `README.md`, `index.html`, `package.json`.

Nothing can safely begin until this is committed or reverted. **This is the first thing to resolve.**

### 6.2 Zero tests
`find` for `*.test.*`, `*.spec.*`, `vitest.config.*`, `jest.config.*` → **no matches**. No test script in `package.json`. For a product with a scoring engine, an anti-cheat path and a real-time protocol, this is the largest risk in the codebase.

### 6.3 Zero lint/format configuration
No `.eslintrc*`, no `eslint.config.*`, no `.prettierrc*` — yet the source contains `// eslint-disable-next-line react-hooks/exhaustive-deps` in at least 4 places (`AppShell.jsx:110`, `useTypingEngine.js:90`, `Practice.jsx:77,154`). Directives aimed at a linter that is not installed.

### 6.4 recharts costs 421 kB for components that mostly don't need it
Build output: `charts-CjET08Tb.js` = **421.30 kB / 112.99 kB gzip**.

`Charts.jsx` exports five components. **`Sparkline` (line 302) and `Heatmap` (line 158) are hand-rolled SVG/DOM and use no recharts at all.** Because they share a module with the recharts components, any importer drags the whole library in:
- `SessionSummary.jsx:9` imports **only `Sparkline`** → pulls 421 kB.
- `Landing.jsx:11` imports `Sparkline` + `WeeklyBars` → the default route pulls 421 kB.

Splitting the pure-SVG components into their own module is a large, low-risk win.

### 6.5 AI provider keys are inlined into the client bundle
`config.js:13-18` documents this explicitly: anything `VITE_`-prefixed is readable by anyone who loads the site. `ai-runner.js` is named as the single file that would need repointing. Acceptable for a hobby deploy; **not acceptable for a product positioned as a platform**.

### 6.6 Dead schema
- `learn_progress` (0001) — the only writer was the deleted Learn module.
- `beta_votes` + `beta_vote_tally` (0003) — the only client was the deleted `betaVote.js`.
- `problem_progress` (0001) — `store.jsx:19-22` states outright: *"Nothing writes this yet."* Sync reads and merges it.

### 6.7 Duplicated constants
`DIFFICULTIES` is defined three times with three different shapes:
- `content.js:73` — `{id, name, note}`
- `Practice.jsx:37` — `{value, label}`
- `Battle.jsx:17` — `{value, label}` (identical to Practice)

### 6.8 `cx` is a zero-value indirection
`format.js:1-3` imports `clsx` and re-exports it unchanged as `cx`. `clsx` is a dependency used in exactly one file for one aliasing line.

### 6.9 Home route serves two incompatible jobs
`Landing.jsx:214` branches the entire hero on `stats.isNew`. One route is simultaneously the product's front door and the user's dashboard. Neither job is done as well as a dedicated surface would do it.

### 6.10 Brand strings are entangled with a domain term
This is the single most dangerous part of the rebrand:

| Category | Count | Rename? |
|---|---|---|
| `KeyStroke` (brand-cased) | 28 across 15 files | **Yes** |
| `keystroke.*` localStorage keys | 6 distinct keys | **Migration, not rename** |
| `keystroke`/`keystrokes` (domain term) | ~25 occurrences | **NO — never touch** |
| `admin@keystroke.ai` | `0004_seed_admin.sql` | Decision needed |
| `keystroke-ai@proton.me`, `@keystroke.ai` | `About.jsx:363-364` | Decision needed |

`useTypingEngine.js` alone has **9** uses of `keystrokes` as a variable name. A naive find-and-replace corrupts the typing engine. Any rename must be **case-sensitive, word-boundary anchored on `KeyStroke`**, with a corruption grep afterwards.

---

## 7. Accessibility — what is already good

Verified present, and worth protecting:
- Skip-to-content link (`AppShell.jsx:126-131`).
- Global brand-coloured `:focus-visible` outline (`index.css:114-118`).
- `prefers-reduced-motion` honoured globally (`index.css:141-150`) *and* per-component via `useReducedMotionSafe` (`lib/motion.js`).
- `role="progressbar"` with full aria value set (`Primitives.jsx:89-95`).
- Decorative SVG consistently `aria-hidden`; `Logo` takes an optional `title` and hides itself when adjacent text names it (`Logo.jsx:64-79`).
- Charts ship a `DataTable` alternative (`ChartFrame.jsx`) — the documented mitigation for the light-mode contrast WARN.

**No automated accessibility audit has been run.** Findings beyond the above are unverified — see §9.

---

## 8. Performance baseline (measured)

`npm run build` — **passes**, 41.24 s.

| Chunk | Raw | Gzip |
|---|---|---|
| `charts` (recharts) | 421.30 kB | 112.99 kB |
| `index` (vendor) | 383.06 kB | 114.21 kB |
| `react` | 165.58 kB | 54.18 kB |
| `motion` (framer-motion) | 115.28 kB | 38.27 kB |
| `CodeTyping` | 30.19 kB | 9.39 kB |
| `BattleRoom` | 28.38 kB | 9.10 kB |
| `Practice` | 27.77 kB | 9.37 kB |
| `Landing` | 21.56 kB | 6.83 kB |

Route-level code splitting is already in place (`App.jsx:8-18`) and manual chunks are configured (`vite.config.js`).

---

## 9. Unverified — must not be asserted without checking

1. **Runtime accessibility defects** — no axe/Lighthouse run yet. §7 lists only what I read in source.
2. **Actual Lighthouse / Core Web Vitals scores** — not measured.
3. **Whether the deployed Supabase project matches `migrations/`** — `supabase/.temp/` is gitignored machine state; drift is possible.
4. **Whether the AI providers in `config.js` are still reachable** — latency table is dated 2026-08-02.
5. **Real-world Battlefield behaviour under load / packet loss** — the code reads correct; not exercised.
6. **Broken UX claims** — the brief asks me to identify these. Beyond §6.9 I have not driven the app in a browser. Any further claim would be speculation.

---

## 10. Assumptions carried forward

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | The Learn-module deletion is intended and should be committed, not reverted | Rework; 8.7k lines return |
| A2 | Battlefield backend (`0009`) stays as-is; TypeForge builds *on* it | Large schema rewrite |
| A3 | Local-first / offline-capable is a product requirement, not an accident | Architecture change |
| A4 | Supabase stays the backend; no migration to another provider | Full data-layer rewrite |
| A5 | The rebrand includes a new visual identity, not just a name swap | Wasted design work |
| A6 | Stickman combat (vision item 7) is future scope, not this cycle | Scope explosion |
| A7 | The existing deploy URL / domain may change | Hardcoded URL updates |

---

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Naive brand find-and-replace corrupts `keystrokes` variables | **High** | Case-sensitive, word-boundary, corruption grep after |
| R2 | localStorage key rename silently wipes every existing user's progress | **High** | Read-old-write-new migration in `store.jsx`, never a bare rename |
| R3 | No tests → any refactor is unverifiable | **High** | Add a test runner + engine/scoring tests **before** refactoring |
| R4 | Uncommitted 8.7k-line deletion makes every diff unreadable | **High** | Resolve before Stage 6 |
| R5 | Redesigning charts risks losing the CVD validation already done | Medium | Re-run the validator; keep `palette.js` slot ordering rules |
| R6 | Client-side AI keys leak on a higher-traffic product | Medium | Route through a serverless proxy |
| R7 | Battlefield RLS/RPC changes could open a cheat vector | **High** | Do not modify `0009` without a written threat re-check |

---

## Stage 0 verification

| Check | Result |
|---|---|
| Every route in `App.jsx` accounted for in §2 | ✅ 12/12 |
| Every migration read | ✅ 9/9 |
| Every `package.json` dependency traced to a usage count | ✅ 7/7 |
| `npm run build` | ✅ passes, 41.24 s |
| Test/lint config existence | ✅ verified absent |
| Brand-string inventory | ✅ grep, case-split |
| Claims without evidence | ✅ isolated to §9 |
