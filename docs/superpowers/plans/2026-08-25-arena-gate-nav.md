# Arena Gate — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking. Work
> task-by-task, top to bottom. Every task ends with a check that can fail.

**Goal:** The nav rail's competitive entry currently drops you straight into the
Battlefield hub. Replace that with a **gate page** at `/arena` that presents the
two competitive modes side by side — **Battlefield** on the left with a short
intro and a `Let's Battle` CTA, **Shadow Battle** on the right with its own intro
and a `Let's War` CTA — and route the nav item there instead.

Neither existing hub is rewritten. `/battle` and `/shadow` keep working exactly
as they do today; the gate sits in front of them.

---

## 1. Why a gate instead of a second nav item

`docs/08-PRD-shadow-battle.md` §23.2 specifies the opposite design: a **seventh**
nav item, `{ to: '/shadow', label: 'Shadow Battle', short: 'Shadow', icon: ShadowMark }`,
placed in `Compete` immediately after `Battle`. That was never implemented — the
`Compete` group today is `Battle → Progress → Rewards` and Shadow Battle is
reachable only from the Home action card and the ⌘K palette.

The gate is a deliberate divergence, and it discharges two of that section's own
open problems rather than ignoring them:

| PRD item | What it says | How the gate answers it |
|---|---|---|
| **SB-NAV-1** | A 7th tab at 360px gives each item ~50px; "Shadow Battle" needs ~68px, so `NAV` entries must gain a `short` field — "a small, real schema change… it must not be discovered during QA." | The gate adds **zero** nav items. The tab bar stays at six. `derive.js` needs no `short` concept, so the schema change is not required at all. |
| **SB-NAV-2** | "'Battle' is taken by Battlefield, and two nav items that both say Battle is the clearest possible way to make a product feel unfinished." | One item, named **Arena**. Neither destination has to fight the other for the word "Battle". |
| **§23.2 rationale** | "…so the two competitive modes sit together and the pairing reads as a choice between them." | A gate *is* that pairing, made literal — the choice is the page, not two adjacent tabs. |

**SB-NAV-3** (an original `ShadowMark.jsx` mark, distinguishable from `Swords` at
17px) stays open and out of scope here: the rail keeps `Swords` for the single
Arena entry, which is correct — `Swords` now denotes "competitive", not
"Battlefield specifically".

---

## 2. Decisions

- **Route:** `/arena`. Free today; no collision with `/battle`, `/battle/:pin`,
  `/shadow`, `/shadow/:pin`.
- **Nav label:** `Arena` (5 chars — fits the 360px tab bar with room to spare,
  so SB-NAV-1's `short` field stays unnecessary). Icon stays `Swords`.
- **Lane naming:** the right lane is titled **Shadow Battle**, not "Shadow
  Fight". SB-NAV-2 fixes that name, and `ShadowHub.jsx`'s `<h1>`, the Home
  action card and the ⌘K entry all already say "Shadow Battle" — a fourth
  spelling would be drift. The *fight* energy goes into the CTA (`Let's War`)
  and the tagline, which is where it belongs.
- **Mechanism:** route the existing `battle` registry entry's `navRoute` at
  `/arena`. This is the established registry pattern, not a new one — the `time`
  entry already does exactly this (`route: '/practice?mode=time'`,
  `navRoute: '/practice'`) with the in-file rationale *"the nav rail's tab
  represents the whole practice surface, not the submode."* `getMode('battle').route`
  stays `/battle`, so scoring, XP and `registry.test.js` are untouched.
- **No new registry entry for Shadow Battle.** Registering `shadow` for real
  means touching `registry.test.js`'s "exactly the 8 existing modes", "battle is
  the only multiplayer mode", the difficulties list and the kindFactor list, plus
  reconciling `stickmanExpressibility.test.js`'s fixture with a now-real entry.
  That is a separate, larger change; the gate does not need it. Tracked in §8.
- **Active-state honesty:** `NavLink to="/arena"` will not highlight while you
  are on `/battle` or `/shadow`. Rather than widen the match (which would light
  the rail during a live match, where the rail is not where you are), both hubs
  gain a visible `Arena` back-link — the same affordance `BattleRoom.jsx` already
  uses with its `← Battlefield` button.

---

## 3. File structure

**New:**
- `src/modules/arena/lanes.js` — the two lane definitions as pure data.
- `src/modules/arena/Arena.jsx` — the gate surface.
- `src/modules/arena/arena.test.js` — content contract + wiring assertions.

**Modified:**
- `src/App.jsx` — lazy import + `/arena` route.
- `src/lib/modes/registry.js` — `battle` entry: `navRoute`, `navLabel`.
- `src/lib/modes/derive.js` — `NAV_LABEL_OVERRIDES.battle` palette copy.
- `src/lib/modes/derive.test.js` — the pinned nav/palette literals.
- `src/components/layout/CommandPalette.jsx` — direct Battlefield entry.
- `src/modules/battle/Battle.jsx` — Arena back-link.
- `src/modules/shadow/ShadowHub.jsx` — Arena back-link.

**Untouched on purpose:** `AppShell.jsx` (the rail derives from the registry, so
it needs no edit — that is MR-5 working), `Home.jsx`, `Landing.jsx`,
`ResultsView.jsx`, `BattleRoom.jsx`, `ShadowRoom.jsx`, every `src/lib/shadow/*`
and `src/lib/battle/*` module.

---

## 4. Content

Copy lives in `lanes.js` as data, not inline in JSX, so `arena.test.js` can
assert it in the `node` test environment without a DOM.

### Left lane — Battlefield → `/battle`

- **eyebrow:** `Up to 8 fighters`
- **title:** `Battlefield`
- **tagline:** `One passage. One clock. Everybody types.`
- **intro:** `A shared passage drops, a server-owned countdown burns down, and up to eight people race the same text at once. No handicaps, no head start — the cleanest run takes it.`
- **beats:** `2–8 players in one room` · `Start time owned by the server, not your laptop` · `Fewest mistakes wins, then speed`
- **cta:** `Let's Battle`
- **tone:** `brand`

### Right lane — Shadow Battle → `/shadow`

- **eyebrow:** `1v1 combat`
- **title:** `Shadow Battle`
- **tagline:** `Every word is a move. Type to strike, type to survive.`
- **intro:** `A tactical duel, not a race. Commit to a Strike lane or a Guard lane, read what your opponent commits to, bank Focus off clean chains — then spend it on an Overdrive that ends the round.`
- **beats:** `Best of three rounds` · `Parry, chain and Overdrive finishers` · `Five bot profiles offline, or a live opponent`
- **cta:** `Let's War`
- **tone:** `accent`

### Page chrome

- eyebrow `Compete`, `<h1>` **Choose your war**, one-line subtitle.
- A `VS` medallion on the divider between the lanes at `lg` and up.
- A three-row comparison strip below the lanes: **Players**, **Win condition**,
  **Needs an account** — so the page answers "which one" without either lane
  having to badmouth the other.

Side colours follow the Shadow Battle Side-Color Rule already enforced in
`FighterCanvas.jsx`: `brand` left, `accent` right. All colour comes from existing
tokens (`brand`, `brand-wash`, `brand-solid`, `accent`, `accent-wash`, `line`,
`ink-3`); no new hex values, no `tailwind.config.js` change.

---

## 5. Tasks

### Task 1 — Lane data

**Files:** create `src/modules/arena/lanes.js`

**Objectives:**
- Export `ARENA_LANES`: a frozen two-element array in render order
  (`battlefield`, `shadow`) carrying `id, to, eyebrow, title, tagline, intro,
  beats[], cta, tone, icon, hotkey`.
- Export `ARENA_COMPARISON`: three `{ label, battlefield, shadow }` rows.
- Icons imported from `lucide-react` (`Swords` left, `Flame` right) — no new
  asset, and no dependency on the unbuilt `ShadowMark.jsx`.

- [x] **Step 1:** Write `lanes.js`.
- [x] **Check:** `node -e "import('./src/modules/arena/lanes.js')"` equivalent via
      the test in Task 6 — every lane has all keys, `to` values are exactly
      `/battle` and `/shadow`, `beats` has 3 entries each.

---

### Task 2 — The gate surface

**Files:** create `src/modules/arena/Arena.jsx`

**Objectives:**
- Default-export `Arena`. Header (eyebrow / h1 / subtitle), then a
  `lg:grid-cols-[1fr_auto_1fr]` split: lane, `VS` divider, lane. Stacks to one
  column below `lg`, Battlefield first.
- Each lane is a `Card` with a tinted icon tile, eyebrow, `<h2>`, tagline,
  intro paragraph, a `beats` list with `Check`-style markers, and a full-width
  `Button` (`variant="primary"`, `as={Link}`, `iconRight={ArrowRight}`) whose
  label is the lane's `cta`.
- Reuse only what exists: `Card`/`Chip` from `Primitives.jsx`, `Button` from
  `Button.jsx`, `Reveal` from `Motion.jsx`, `cx` from `lib/format.js`.
  **Do not** pass `variant="outline"` — that variant does not exist in
  `Button.jsx`'s `VARIANTS` map (see §9).
- Keyboard shortcuts: `B` → `/battle`, `S` → `/shadow`. Guarded — ignored when
  any of `metaKey/ctrlKey/altKey` is held, or when the event target is an
  `input`/`textarea`/`[contenteditable]`. Hint rendered as a `<kbd>` inside each
  lane so the shortcut is discoverable rather than secret.
- Comparison strip rendered from `ARENA_COMPARISON` as a real `<table>` with a
  `<caption class="sr-only">`.
- Motion: `Reveal` with staggered `delay` only. No `Floating`, no infinite
  animation — `Reveal` already honours `prefers-reduced-motion` through
  `useReducedMotionSafe()`.

- [x] **Step 1:** Write `Arena.jsx`.
- [x] **Check:** imports resolve and the module exports a function (Task 6 test).

---

### Task 3 — Route

**Files:** modify `src/App.jsx`

**Objectives:**
- `const Arena = lazy(() => import('./modules/arena/Arena.jsx'));` beside the
  other lazy imports.
- `<Route path="/arena" element={<Arena />} />` immediately above the `/battle`
  route, with a comment explaining that `/battle` and `/shadow` stay directly
  addressable so shared PINs, `ResultsView`'s "Play again" and the Home action
  cards keep resolving without passing through the gate.

- [x] **Step 1:** Add import and route.
- [x] **Check:** `rg -n "arena" src/App.jsx` shows both lines; build passes in
      Task 7.

---

### Task 4 — Nav rail

**Files:** modify `src/lib/modes/registry.js`

**Objectives:**
- `battle` entry only: `navLabel: 'Battle' → 'Arena'`,
  `navRoute: '/battle' → '/arena'`. `route: '/battle'` is **unchanged**.
- Add a comment in the same voice as the existing `navIcon` note, explaining the
  surface-vs-identity split and pointing at this plan.

- [x] **Step 1:** Edit the entry + comment.
- [x] **Check:** `getMode('battle').route === '/battle'` still holds
      (`registry.test.js` line 32 asserts it and must keep passing untouched).

---

### Task 5 — ⌘K and back-links

**Files:** modify `src/lib/modes/derive.js`, `src/components/layout/CommandPalette.jsx`,
`src/modules/battle/Battle.jsx`, `src/modules/shadow/ShadowHub.jsx`

**Objectives:**
- `derive.js`: `NAV_LABEL_OVERRIDES.battle` becomes
  `'Open the Arena — Battlefield or Shadow'`. Without this the palette would
  offer "Open Battlefield — multiplayer" and navigate to `/arena`, which is a
  lie about where the command goes.
- `CommandPalette.jsx`: add a direct
  `{ id: 'battlefield', label: 'Battlefield — 8-player race', icon: Swords, route: '/battle' }`
  entry next to the existing `shadow` one, so **both** destinations stay one
  keystroke away and the gate is never mandatory. (Fully deriving these from the
  registry is SB-NAV-5's job and is out of scope — see §8.)
- `Battle.jsx` and `ShadowHub.jsx`: a small `ghost` `Button as={Link} to="/arena"`
  with `icon={ArrowLeft}` labelled `Arena`, placed in each hub's header. This is
  the same pattern as `BattleRoom.jsx:327`.

- [x] **Step 1:** `derive.js` label.
- [x] **Step 2:** `CommandPalette.jsx` entry.
- [x] **Step 3:** Both back-links.
- [x] **Check:** `rg -n -F "/arena" src` lists `App.jsx`, `registry.js`,
      `Battle.jsx`, `ShadowHub.jsx` and the tests.

---

### Task 6 — Tests

**Files:** create `src/modules/arena/arena.test.js`; modify `src/lib/modes/derive.test.js`

The test environment is `environment: 'node'` with `include: ['src/**/*.test.js']`
— there is no jsdom and `.test.jsx` is not collected. So: **no render tests.**
Assert the data contract, the module exports and the derived wiring, exactly the
way `src/modules/shadow/ui.test.js` does.

**`arena.test.js` objectives:**
- `Arena` is a defined function; `ARENA_LANES` has length 2 with ids
  `['battlefield', 'shadow']` and `to` values `['/battle', '/shadow']`.
- Every lane carries every key in a `REQUIRED_LANE_FIELDS` list exported from
  `lanes.js` (same single-source pattern `REQUIRED_MODE_FIELDS` uses).
- Both CTAs are present and distinct: `Let's Battle` / `Let's War`.
- Hotkeys are unique and single characters.
- Regression: the lane titled `Shadow Battle` is spelled that way, pinning
  SB-NAV-2 against a future drift to "Shadow Fight"/"Combat".
- Wiring: `deriveNavGroups(MODE_REGISTRY, …)` puts `/arena` in `Compete`, and
  every `ARENA_LANES[].to` is a live route literal in `src/App.jsx` (read the
  file, assert `path="/battle"` and `path="/shadow"` are present) — so deleting a
  route without updating the gate fails a test instead of shipping a dead CTA.
- Guard: `getMode('battle').route` is still `/battle` while `navRoute` is
  `/arena`, stating the split as an assertion rather than a comment.

**`derive.test.js` edits** — four pinned literals move, and each edit gets a
comment saying the gate is the reason:
- line ~21: `['/battle', …]` → `['/arena', '/dashboard', '/achievements']`
- line ~22: `{ to: '/battle', label: 'Battle' }` → `{ to: '/arena', label: 'Arena' }`
- line ~70: `{ to: '/battle', label: 'Battle', icon: Swords }` → `{ to: '/arena', label: 'Arena', icon: Swords }`
- line ~95: `['/first', '/battle', '/last']` → `['/first', '/arena', '/last']`
- line ~104/105: palette route `'/battle'` → `'/arena'`, label
  `'Open Battlefield — multiplayer'` → `'Open the Arena — Battlefield or Shadow'`

- [x] **Step 1:** Write `arena.test.js`.
- [x] **Step 2:** Update `derive.test.js`.
- [x] **Check:** `npx vitest run src/lib/modes src/modules/arena` — green.

---

### Task 7 — Verification

- [x] **Step 1:** `npm test` — full suite green, and the count is **≥** the
      pre-change count (no test silently dropped).
- [x] **Step 2:** `npm run build` — clean, no new warnings.
- [x] **Step 3:** `rg -n -F "Let's Battle" src && rg -n -F "Let's War" src` — both
      strings present exactly once each, in `lanes.js`, and reachable from JSX.
- [x] **Step 4:** Corruption grep after the `derive.test.js` edits:
      `rg -n -F "'/battle'" src/lib/modes/derive.test.js` should return **only**
      intentional survivors, and `rg -n "arenaarena|//arena|/arena/arena" src`
      must return nothing.

---

## 6. Acceptance criteria

1. Clicking the rail's `Arena` item (expanded, collapsed, and the mobile tab bar)
   lands on `/arena` — not `/battle`.
2. `/arena` shows Battlefield left and Shadow Battle right, each with eyebrow,
   title, tagline, intro, three beats, and its CTA.
3. `Let's Battle` navigates to `/battle`; `Let's War` navigates to `/shadow`.
4. Below `lg` the lanes stack, Battlefield first, no horizontal scroll at 360px.
5. `/battle`, `/battle/:pin`, `/shadow`, `/shadow/:pin` all still resolve
   directly. A shared PIN link never routes through the gate.
6. `Home.jsx`'s three action cards, `Landing.jsx`'s footer `Battle` link and
   `ResultsView.jsx`'s "Play again" are unchanged and still work.
7. ⌘K offers Arena, Battlefield and Shadow Battle as three separate commands,
   each going where its label says.
8. The mobile tab bar still has six items.
9. `npm test` and `npm run build` are both clean.

---

## 7. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `derive.test.js` pins the old nav literal byte-for-byte and fails | **Certain** — this is by design, the test exists to catch exactly this | Task 6 updates it deliberately, with a comment per line. Never by loosening an assertion. |
| Palette command label stops matching its destination | High if `derive.js` is missed | Task 5 Step 1; asserted in `derive.test.js`. |
| One more click to reach Battlefield for existing muscle memory | Certain | `B` hotkey on the gate, a direct ⌘K entry, and Home's action cards still deep-link. |
| A CTA points at a route that later gets renamed | Low | `arena.test.js` reads `App.jsx` and asserts both route literals exist. |
| Find-and-replace of `/battle` → `/arena` corrupting `/battle/:pin`, `lib/battle/*` imports, `components/battle/PinInput.jsx` | Medium | **No global replace.** Every edit is a targeted single-site edit, followed by the §5 Task 7 Step 4 corruption grep. |

---

## 8. Explicitly out of scope

- Registering `shadow` in `MODE_REGISTRY` for real (SC-A3 / SB-NAV-5 fallout,
  and four assertions in `registry.test.js`).
- `src/components/brand/ShadowMark.jsx` (SB-NAV-3) — the rail keeps `Swords`.
- The `short` nav field (SB-NAV-1) — the gate removes the need for it.
- The in-progress dot (SB-NAV-4) and live-game/match-history palette entries
  (SB-NAV-5).
- `docs/09-PRD-shadow-battle-ui-redesign.md` — untracked and unimplemented; the
  gate does not touch the arena interior.
- Any change to `ShadowArena.jsx`, `FighterCanvas.jsx` or the combat reducer.

---

## 9. Batched pre-existing findings

All three confirmed by reading the source, not inferred. None was introduced by
this plan and none blocked it.

1. **`variant="outline"` does not exist.** `src/modules/shadow/ShadowHub.jsx`
   lines 185, 212 and 239 pass `variant="outline"` to `Button`. `Button.jsx`'s
   `VARIANTS` map holds exactly `primary, brand, secondary, ghost, quiet,
   danger` — so `VARIANTS['outline']` is `undefined` and those three buttons
   render with size, layout and press classes but **no background, no border and
   no text colour**. Two of them are the "Sign in to play ranked" / "Sign in to
   play custom duels" gates, i.e. the buttons an unauthenticated visitor is meant
   to click. Verified scope: 3 sites, all in `ShadowHub.jsx` — `ShadowRoom.jsx`
   and `MatchSummary.jsx` are clean. Fix is either an `outline` variant in
   `Button.jsx` or migrating the three call sites to `secondary`; the latter
   needs no design-system change. The Arena gate deliberately uses neither.
2. **A dead bot id and a dead variable in `ShadowHub.jsx`.** `BOT_PROFILES` in
   `src/lib/shadow/bot.js` defines exactly `recruit, adept, ronin, shade,
   mirror`. Line 278 branches on `bot.id === 'master'` for a `warn` chip tone —
   no such id exists, so that branch never runs and `ronin`/`shade`/`mirror` all
   fall through to `neutral`. Separately, `activeBotDef` (line 123) is computed
   and never read; `botDef` at line 109 is the one actually used.
3. **The working tree is uncommitted.** ~40 untracked files and 17 modified ones
   from the Shadow Battle build, none committed. This plan adds five more files
   to that pile. Worth scoping into commits before it grows further.

---

## 10. Outcome

Implemented as planned; no deviation from §5 was needed.

| Check | Result |
|---|---|
| `npm test` | **298 passed / 28 files**, up from 281 / 27 — the 17 new assertions are the Arena suite, and no existing test was dropped or loosened |
| `npm run build` | Clean, built in 1m 2s, no new warnings |
| Code splitting | `dist/assets/Arena-*.js` — **6.05 kB raw / 2.39 kB gzip**, so the gate is its own lazy chunk and costs nothing on any other route |
| CTA strings | `Let's Battle` and `Let's War` each appear once in `lanes.js` (plus once in the test that pins them) |
| Corruption grep | `arenaarena` / `//arena` / `/arena/arena` / `/battlearena` / `arena/battle` — zero matches |
| Surviving `'/battle'` in `derive.test.js` | Two, both inside explanatory comments — no stranded assertion |

**Not verified, and why:** acceptance criteria 1–4, 7 and 8 are visual/interaction
claims. The `chrome-devtools` MCP tools were unavailable in the implementing
session, and the test environment is `node` with no jsdom, so nothing rendered.
The compile-time and wiring halves of those criteria are covered by
`arena.test.js` (nav route, nav label, six-item budget, label length, live route
literals) and by the clean build; the pixel halves — lanes side by side at `lg`,
stacking order below it, no horizontal scroll at 360px, the ⌘K list reading
correctly — still want one pass in a real browser.

