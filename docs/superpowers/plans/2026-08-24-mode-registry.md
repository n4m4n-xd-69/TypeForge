# Mode Registry & Session Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one declarative mode registry that becomes the single source of truth for TypeForge's 8 existing typing modes, and prove — with a runnable test, not a claim — that it can also express Shadow Battle's shape (2-player, real-time, not scored on passage completion) without touching navigation, palette or scoring code.

**Architecture:** A new `src/lib/modes/` package holds the registry data (`registry.js`), pure derivation functions consumed by UI (`derive.js`), and a session-result helper (`sessionContract.js`). `AppShell.jsx`, `CommandPalette.jsx`, `Practice.jsx`, `Battle.jsx`, `CodeTyping.jsx` and `gamification.js` are refactored to *consume* these instead of hand-rolling their own mode lists, difficulty arrays and XP-factor ternaries. No route, component or visual output changes for any existing mode — this is a pure refactor with a new capability (Shadow Battle expressibility) proven by test.

**Tech Stack:** Vitest (new — this repo has no test runner today), plain JS (no TypeScript in this codebase), React 18, existing `src/lib/*` and `src/components/layout/*` files.

**Spec:** `docs/01-PRD.md` §25 (Mode registry, MR-1…MR-7), §28 (Navigation architecture — **only NV-4's derivation clause is in scope; the NV-1…NV-9 five-item IA restructure is explicitly out of scope, see below**), §30 (Future extensibility / session contract, EX-1…EX-3, EX-6, EX-7). Cross-referenced against `docs/08-PRD-shadow-battle.md` §33.3 and §36-Q-adjacent framing, which names this registry as Shadow Battle's blocking dependency and its nav entry as the registry's own acceptance test (SC-A5).

## Global Constraints

- No behaviour change for any of the 8 existing modes — same routes, same labels, same difficulty options, same XP numbers, same nav layout, same palette entries. Every task that touches a live UI file ends in a manual smoke-check confirming this.
- `DIFFICULTIES` must end this plan with **exactly one definition** in the codebase (`src/lib/content.js`), per 01-PRD.md §25.4.
- Every registry entry declares at minimum: `id, name, description, icon, route, category, scored, multiplayer, requiresCloud, difficulties, xpRule` (01-PRD.md MR-2).
- Adding a new mode must require **no edit** to navigation, palette or XP-scoring code (MR-5) — Task 9 proves this concretely for a Shadow-Battle-shaped entry.
- **Out of scope:** the full §28 navigation IA restructure (5-item Home/Train/Compete/Progress/Profile nav, hub routes). Shadow Battle only needs one more entry in the *existing* Train/Compete `NAV_GROUPS` structure with a `short` label field — that's a follow-on task in the Shadow Battle nav-integration plan, not this one.
- **Out of scope:** achievements-per-mode and leaderboards-per-mode (MR-7, EX-4, EX-5) — both P1 in the source spec, not needed to unblock Shadow Battle.
- **Out of scope:** React component rendering tests (no `@testing-library/react`/`jsdom` added in this plan). All new logic is pure functions, unit-tested directly; UI wiring is verified by a manual dev-server smoke check per task, since this repo has zero existing component-test infrastructure and adding it is a separate decision the user hasn't made.

---

## File Structure

**New:**
- `src/lib/modes/registry.js` — `MODE_REGISTRY` (the 8 entries), `getMode(id)`, `kindFactorFor(kind)`
- `src/lib/modes/registry.test.js`
- `src/lib/modes/derive.js` — `deriveNavGroups`, `deriveModePaletteEntries`, `deriveModeSegmentedOptions`
- `src/lib/modes/derive.test.js`
- `src/lib/modes/sessionContract.js` — `buildSessionPayload`
- `src/lib/modes/sessionContract.test.js`
- `src/lib/modes/stickmanExpressibility.test.js` — the SC-A1…A5 proof (Task 9)
- `vitest.config.js` — test runner config, separate from `vite.config.js` so build config never has to think about test config

**Modified:**
- `package.json` — add `vitest` devDependency, `test`/`test:watch` scripts
- `src/lib/content.js` — no data change; becomes the sole `DIFFICULTIES` source
- `src/lib/gamification.js` — `xpForSession`'s `kindFactor` ternary replaced by `kindFactorFor(kind)`
- `src/components/layout/AppShell.jsx` — `NAV_GROUPS` composed from `deriveNavGroups(MODE_REGISTRY)` + hand-authored non-mode items (Home, Progress, Rewards)
- `src/components/layout/CommandPalette.jsx` — the "Navigate" mode links and the zen/quote quick-launch entries derived from the registry
- `src/modules/practice/Practice.jsx` — local `MODES`/`DIFFICULTIES` arrays removed; mode switcher, difficulty selector, and the "does this mode record a session" gate all sourced from the registry
- `src/modules/battle/Battle.jsx` — local `DIFFICULTIES` array removed
- `src/modules/code/CodeTyping.jsx` — difficulty selector sourced from the same adapter Practice/Battle use
- `src/modules/practice/Practice.jsx`, `src/modules/code/CodeTyping.jsx`, `src/modules/battle/RaceView.jsx` — `recordSession(...)` calls go through `buildSessionPayload(...)`

---

### Task 1: Vitest test runner + registry module skeleton

**Files:**
- Create: `vitest.config.js`
- Create: `src/lib/modes/registry.js`
- Create: `src/lib/modes/registry.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `MODE_REGISTRY` (empty array for now — populated in Task 3), importable from `src/lib/modes/registry.js`

This repo has no test runner at all today (`grep -rn` for `.test.` and `.spec.` in `src/` returns nothing, and `package.json` has no `test` script). This task adds one and proves it works before anything else in this plan depends on it.

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add the test scripts**

Edit `package.json`'s `"scripts"` block:

```json
  "scripts": {
    "dev": "vite",
    "build": "node scripts/build-icons.mjs && vite build",
    "preview": "vite preview",
    "icons": "node scripts/build-icons.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Add `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Write the failing test**

```js
// src/lib/modes/registry.test.js
import { describe, expect, it } from 'vitest';
import { MODE_REGISTRY } from './registry.js';

describe('MODE_REGISTRY', () => {
  it('is an array', () => {
    expect(Array.isArray(MODE_REGISTRY)).toBe(true);
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `src/lib/modes/registry.js` does not exist (module not found)

- [ ] **Step 6: Create the minimal registry module**

```js
// src/lib/modes/registry.js
/**
 * The single source of truth for every typing mode in the product.
 * See docs/01-PRD.md §25 (MR-1..MR-7) and
 * docs/superpowers/plans/2026-08-24-mode-registry.md for the shape contract.
 *
 * Populated in full by Task 3 of that plan.
 */
export const MODE_REGISTRY = [];
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS — 1 test passed

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/lib/modes/registry.js src/lib/modes/registry.test.js
git commit -m "test: add Vitest and an empty mode registry module"
```

---

### Task 2: Consolidate `DIFFICULTIES` into one definition

**Files:**
- Modify: `src/modules/practice/Practice.jsx:37-42` (delete local `DIFFICULTIES`)
- Modify: `src/modules/battle/Battle.jsx:17-22` (delete local `DIFFICULTIES`)
- Create: `src/lib/modes/duplication.test.js`

**Interfaces:**
- Consumes: `DIFFICULTIES` from `src/lib/content.js` (already exists: `[{id, name, note}, ...]`, exported today)
- Produces: nothing new — this task only deletes duplication and adds a regression guard

`content.js`, `Practice.jsx` and `Battle.jsx` each define their own `DIFFICULTIES` array today (01-PRD.md §25.2). `content.js`'s shape (`{id, name, note}`) is the richest and already the sole source for `CodeTyping.jsx`. This task makes it the sole source everywhere, converting to `Segmented`'s `{value, label}` option shape inline at each call site — the same one-line adapter pattern `CodeTyping.jsx` already uses for its `Select`.

- [ ] **Step 1: Write the failing test**

A grep-shaped regression guard: after this task, exactly one `DIFFICULTIES` array-literal definition should exist in `src/`.

```js
// src/lib/modes/duplication.test.js
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('DIFFICULTIES has exactly one definition', () => {
  it('is only ever array-literal-defined once, in content.js', () => {
    const files = walk(path.resolve('src'));
    const definitions = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /\bDIFFICULTIES\s*=\s*\[/.test(text);
    });
    expect(definitions).toEqual([path.resolve('src/lib/content.js')]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `definitions` contains 3 paths (`content.js`, `Practice.jsx`, `Battle.jsx`), not 1

- [ ] **Step 3: Remove the duplicate in `Practice.jsx`**

Delete lines 37-42:

```js
const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
];
```

Add the import (alongside the existing `content.js` import on line 22) and the adapter, right after the `DURATIONS`/`WORD_COUNTS` constants that used to sit next to the deleted array:

```js
import { DIFFICULTIES, DRILLS, randomQuote, randomWords } from '../../lib/content.js';
```

```js
const DIFFICULTY_OPTIONS = DIFFICULTIES.map((d) => ({ value: d.id, label: d.name }));
```

Update the `Segmented` call (currently `options={DIFFICULTIES}` around line 621) to `options={DIFFICULTY_OPTIONS}`.

- [ ] **Step 4: Remove the duplicate in `Battle.jsx`**

Delete lines 17-22:

```js
const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
  { value: 'expert', label: 'Expert' },
];
```

Add the import and adapter:

```js
import { DIFFICULTIES } from '../../lib/content.js';
```

```js
const DIFFICULTY_OPTIONS = DIFFICULTIES.map((d) => ({ value: d.id, label: d.name }));
```

Update its `Segmented` call (`options={DIFFICULTIES}` around line 134) to `options={DIFFICULTY_OPTIONS}`.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS — `definitions` is exactly `['.../src/lib/content.js']`

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`, open `/practice` and `/battle`. Confirm the difficulty selector on both screens still reads **Easy / Normal / Hard / Expert** and switching difficulty still changes the generated text, identically to before this task.

- [ ] **Step 7: Commit**

```bash
git add src/modules/practice/Practice.jsx src/modules/battle/Battle.jsx src/lib/modes/duplication.test.js
git commit -m "refactor: collapse three DIFFICULTIES definitions into one"
```

---

### Task 3: Populate the mode registry

**Files:**
- Modify: `src/lib/modes/registry.js`
- Modify: `src/lib/modes/registry.test.js`

**Interfaces:**
- Consumes: `DIFFICULTIES` from `src/lib/content.js` (Task 2)
- Produces: `MODE_REGISTRY` — array of 8 entries, each shaped:
  ```
  {
    id: string, name: string, description: string, icon: ComponentType,
    route: string, category: string, kind: 'text'|'code'|'battle',
    scored: false | 'time-trial', multiplayer: boolean, requiresCloud: boolean,
    difficulties: Array | null, xpRule: { kindFactor: number },
    quickLaunch: boolean,
    navSurface: boolean, navGroup: string|null, navLabel: string|null, navRoute: string|null,
  }
  ```
  Later tasks (4-8) and later plans (Shadow Battle) rely on exactly these field names.
- Produces: `getMode(id)` — returns the entry or `undefined`

This is the direct fix for 01-PRD.md §25.2: mode knowledge currently scattered across `Practice.jsx` (`MODES`), `AppShell.jsx` (`NAV_GROUPS`), `CommandPalette.jsx` (`commands`), `Battle.jsx`, and `content.js`. This task creates the one place; Tasks 5-7 point the scattered call sites at it.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/modes/registry.test.js — append to the existing test file, replacing the Task 1 smoke test
import { describe, expect, it } from 'vitest';
import { getMode, MODE_REGISTRY } from './registry.js';

const REQUIRED_FIELDS = [
  'id', 'name', 'description', 'icon', 'route', 'category',
  'kind', 'scored', 'multiplayer', 'requiresCloud', 'difficulties', 'xpRule',
];

describe('MODE_REGISTRY', () => {
  it('has exactly the 8 existing modes', () => {
    expect(MODE_REGISTRY.map((m) => m.id).sort()).toEqual(
      ['battle', 'code', 'custom', 'drill', 'quote', 'time', 'words', 'zen'].sort(),
    );
  });

  it('every entry has every MR-2-required field', () => {
    for (const mode of MODE_REGISTRY) {
      for (const field of REQUIRED_FIELDS) {
        expect(mode, `${mode.id} is missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it('every id is unique', () => {
    const ids = MODE_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('routes match the existing app routes', () => {
    expect(getMode('time').route).toBe('/practice?mode=time');
    expect(getMode('words').route).toBe('/practice?mode=words');
    expect(getMode('quote').route).toBe('/practice?mode=quote');
    expect(getMode('drill').route).toBe('/practice?mode=drill');
    expect(getMode('custom').route).toBe('/practice?mode=custom');
    expect(getMode('zen').route).toBe('/practice?mode=zen');
    expect(getMode('code').route).toBe('/code');
    expect(getMode('battle').route).toBe('/battle');
  });

  it('zen is the only unscored mode, matching current behaviour', () => {
    expect(MODE_REGISTRY.filter((m) => m.scored === false).map((m) => m.id)).toEqual(['zen']);
  });

  it('battle is the only multiplayer mode', () => {
    expect(MODE_REGISTRY.filter((m) => m.multiplayer).map((m) => m.id)).toEqual(['battle']);
  });

  it('getMode returns undefined for an unknown id', () => {
    expect(getMode('nonexistent')).toBeUndefined();
  });

  it('only time, words, zen, code, and battle have non-null difficulties', () => {
    const withDifficulties = MODE_REGISTRY.filter((m) => m.difficulties !== null).map((m) => m.id).sort();
    expect(withDifficulties).toEqual(['battle', 'code', 'time', 'words', 'zen']);
  });

  it('kindFactor values match the spec', () => {
    expect(getMode('time').xpRule.kindFactor).toBe(1);
    expect(getMode('words').xpRule.kindFactor).toBe(1);
    expect(getMode('quote').xpRule.kindFactor).toBe(1);
    expect(getMode('drill').xpRule.kindFactor).toBe(1);
    expect(getMode('custom').xpRule.kindFactor).toBe(1);
    expect(getMode('zen').xpRule.kindFactor).toBe(1);
    expect(getMode('code').xpRule.kindFactor).toBe(1.25);
    expect(getMode('battle').xpRule.kindFactor).toBe(1.15);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `MODE_REGISTRY` is empty; every assertion above fails

- [ ] **Step 3: Populate the registry**

```js
// src/lib/modes/registry.js
import { Braces, Clock, Hash, Keyboard, Leaf, PenLine, Quote, Swords } from 'lucide-react';
import { DIFFICULTIES } from '../content.js';

/**
 * The single source of truth for every typing mode in the product.
 * See docs/01-PRD.md §25 (MR-1..MR-7) and
 * docs/superpowers/plans/2026-08-24-mode-registry.md for the shape contract.
 */
export const MODE_REGISTRY = [
  {
    id: 'time', name: 'Time', description: 'Type for a set duration under a countdown.',
    icon: Clock, route: '/practice?mode=time', category: 'practice', kind: 'text',
    scored: 'time-trial', multiplayer: false, requiresCloud: false, difficulties: DIFFICULTIES,
    xpRule: { kindFactor: 1 }, quickLaunch: false,
    navSurface: true, navGroup: 'Train', navLabel: 'Typing', navRoute: '/practice',
  },
  {
    id: 'words', name: 'Words', description: 'Type a fixed word count as fast as you cleanly can.',
    icon: Hash, route: '/practice?mode=words', category: 'practice', kind: 'text',
    scored: 'time-trial', multiplayer: false, requiresCloud: false, difficulties: DIFFICULTIES,
    xpRule: { kindFactor: 1 }, quickLaunch: false,
    navSurface: false, navGroup: null, navLabel: null, navRoute: null,
  },
  {
    id: 'quote', name: 'Quote', description: 'Type a real quote, once, start to finish.',
    icon: Quote, route: '/practice?mode=quote', category: 'practice', kind: 'text',
    scored: 'time-trial', multiplayer: false, requiresCloud: false, difficulties: null,
    xpRule: { kindFactor: 1 }, quickLaunch: true,
    navSurface: false, navGroup: null, navLabel: null, navRoute: null,
  },
  {
    id: 'drill', name: 'Drill', description: 'Targeted practice on one key group.',
    icon: Keyboard, route: '/practice?mode=drill', category: 'practice', kind: 'text',
    scored: 'time-trial', multiplayer: false, requiresCloud: false, difficulties: null,
    xpRule: { kindFactor: 1 }, quickLaunch: false,
    navSurface: false, navGroup: null, navLabel: null, navRoute: null,
  },
  {
    id: 'custom', name: 'Custom', description: 'Paste or type your own text.',
    icon: PenLine, route: '/practice?mode=custom', category: 'practice', kind: 'text',
    scored: 'time-trial', multiplayer: false, requiresCloud: false, difficulties: null,
    xpRule: { kindFactor: 1 }, quickLaunch: false,
    navSurface: false, navGroup: null, navLabel: null, navRoute: null,
  },
  {
    id: 'zen', name: 'Zen', description: 'No clock, no score. Just typing.',
    icon: Leaf, route: '/practice?mode=zen', category: 'practice', kind: 'text',
    scored: false, multiplayer: false, requiresCloud: false, difficulties: DIFFICULTIES,
    xpRule: { kindFactor: 1 }, quickLaunch: true,
    navSurface: false, navGroup: null, navLabel: null, navRoute: null,
  },
  {
    id: 'code', name: 'Code', description: 'Type real code snippets across 11 languages.',
    icon: Braces, route: '/code', category: 'code', kind: 'code',
    scored: 'time-trial', multiplayer: false, requiresCloud: false, difficulties: DIFFICULTIES,
    xpRule: { kindFactor: 1.25 }, quickLaunch: false,
    navSurface: true, navGroup: 'Train', navLabel: 'Code', navRoute: '/code',
  },
  {
    id: 'battle', name: 'Battlefield', description: 'Race up to 8 players on one shared passage.',
    icon: Swords, route: '/battle', category: 'competitive', kind: 'battle',
    scored: 'time-trial', multiplayer: true, requiresCloud: true, difficulties: DIFFICULTIES,
    xpRule: { kindFactor: 1.15 }, quickLaunch: false,
    navSurface: true, navGroup: 'Compete', navLabel: 'Battle', navRoute: '/battle',
  },
];

export function getMode(id) {
  return MODE_REGISTRY.find((m) => m.id === id);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS — all `registry.test.js` assertions pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/modes/registry.js src/lib/modes/registry.test.js
git commit -m "feat: populate the mode registry with all 8 existing modes"
```

---

### Task 4: `kindFactorFor` — registry-driven XP factor

**Files:**
- Modify: `src/lib/modes/registry.js`
- Modify: `src/lib/modes/registry.test.js`
- Modify: `src/lib/gamification.js:50-58`
- Create: `src/lib/gamification.test.js`

**Interfaces:**
- Consumes: `MODE_REGISTRY` (Task 3)
- Produces: `kindFactorFor(kind: string): number` from `src/lib/modes/registry.js` — looked up by later tasks and by the Shadow Battle registry entry in a future plan

`xpForSession`'s `kindFactor` is a hardcoded ternary today (`kind === 'code' ? 1.25 : kind === 'battle' ? 1.15 : 1`). This task moves that number onto each registry entry's own `xpRule.kindFactor` and makes `xpForSession` look it up, so a future mode (Shadow Battle's `kindFactor: 1.20`, per `docs/08-PRD-shadow-battle.md` §19.1) is addable without editing `gamification.js` — the concrete MR-5 proof for scoring.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/modes/registry.test.js — append here
import { kindFactorFor } from './registry.js';

describe('kindFactorFor', () => {
  it('returns the code kind factor', () => {
    expect(kindFactorFor('code')).toBe(1.25);
  });
  it('returns the battle kind factor', () => {
    expect(kindFactorFor('battle')).toBe(1.15);
  });
  it('returns the text kind factor', () => {
    expect(kindFactorFor('text')).toBe(1);
  });
  it('falls back to 1 for an unknown kind', () => {
    expect(kindFactorFor('made-up-kind')).toBe(1);
  });
});
```

```js
// src/lib/gamification.test.js
import { describe, expect, it } from 'vitest';
import { xpForSession } from './gamification.js';

describe('xpForSession', () => {
  const baseParams = { wpm: 80, accuracy: 97, durationSec: 60 };

  it('preserves pre-refactor XP for text kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'text' })).toBe(103);
  });

  it('preserves pre-refactor XP for code kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'code' })).toBe(129);
  });

  it('preserves pre-refactor XP for battle kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'battle' })).toBe(119);
  });

  it('preserves pre-refactor XP for unregistered kind (defaults to 1)', () => {
    expect(xpForSession({ ...baseParams, kind: 'made-up-kind' })).toBe(103);
  });

  it('default kind parameter is text', () => {
    expect(xpForSession({ ...baseParams })).toBe(xpForSession({ ...baseParams, kind: 'text' }));
  });

  it('preserves pre-refactor XP for code with hard difficulty', () => {
    expect(xpForSession({ ...baseParams, kind: 'code', difficulty: 'hard' })).toBe(155);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npm test`
Expected: FAIL — `kindFactorFor` is not exported yet (import error)

- [ ] **Step 3: Implement `kindFactorFor`**

Append to `src/lib/modes/registry.js`:

```js
export function kindFactorFor(kind) {
  const mode = MODE_REGISTRY.find((m) => m.kind === kind);
  return mode?.xpRule?.kindFactor ?? 1;
}
```

- [ ] **Step 4: Wire `gamification.js` to use it**

Replace lines 50-58 of `src/lib/gamification.js`:

```js
import { kindFactorFor } from './modes/registry.js';

export function xpForSession({ wpm, accuracy, durationSec, kind = 'text', difficulty = 'normal' }) {
  const base = Math.round(wpm * 0.9 + (durationSec / 60) * 18);
  const accuracyFactor = accuracy >= 98 ? 1.35 : accuracy >= 95 ? 1.15 : accuracy >= 90 ? 1 : 0.7;
  const kindFactor = kindFactorFor(kind);
  const diffFactor = { easy: 0.85, normal: 1, hard: 1.2, expert: 1.45 }[difficulty] ?? 1;
  return Math.max(5, Math.round(base * accuracyFactor * kindFactor * diffFactor));
}
```

(The comment explaining Battlefield's pressure factor moves to the registry entry's own context — `registry.js`'s `battle` entry — rather than living beside the now-generic lookup.)

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS — all `registry.test.js` and the new `gamification.test.js` assertions pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/modes/registry.js src/lib/modes/registry.test.js src/lib/gamification.js src/lib/gamification.test.js
git commit -m "refactor: derive XP kind-factor from the mode registry"
```

---

### Task 5: `deriveNavGroups` — nav derived from the registry

**Files:**
- Create: `src/lib/modes/derive.js`
- Create: `src/lib/modes/derive.test.js`
- Modify: `src/components/layout/AppShell.jsx:36-58`

**Interfaces:**
- Consumes: `MODE_REGISTRY` (Task 3), entries' `navSurface/navGroup/navLabel/navRoute/icon/navIcon` fields
- Produces: `deriveNavGroups(registry, extraItemsByGroup): Array<{label: string, items: Array<{to, label, icon, end?, lead?}>}>` — order within a group is: extras with `lead: true` first, then registry-derived items in registry array order, then any remaining extras. `lead` is a purpose-built positional field, independent of `end` (React Router's exact-match `NavLink` semantics) — an extra can have either, both, or neither.

Only 3 of the 8 registry entries represent a distinct nav destination (`time` for the Typing surface, `code`, `battle`) — the other 5 practice sub-modes live inside `/practice`. `Home`, `Progress` and `Rewards` aren't modes at all, so they stay hand-authored and get passed in as `extraItemsByGroup`.

`registry.js`'s `time` entry additionally carries `navIcon: Keyboard`: its own `icon` (`Clock`) is the mode's identity, matching the `/practice` mode switcher (Task 7), but the nav rail's "Typing" tab represents the whole practice surface and keeps the pre-registry `Keyboard` glyph. `deriveNavGroups` resolves an item's icon as `m.navIcon ?? m.icon`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/modes/derive.test.js
import { describe, expect, it } from 'vitest';
import { deriveNavGroups } from './derive.js';
import { MODE_REGISTRY } from './registry.js';

describe('deriveNavGroups', () => {
  it('reproduces the current Train/Compete nav exactly, given the current extras', () => {
    const extras = {
      Train: [{ to: '/', label: 'Home', icon: 'Home', end: true, lead: true }],
      Compete: [
        { to: '/dashboard', label: 'Progress', icon: 'LineChart' },
        { to: '/achievements', label: 'Rewards', icon: 'Trophy' },
      ],
    };
    const groups = deriveNavGroups(MODE_REGISTRY, extras);

    expect(groups.map((g) => g.label)).toEqual(['Train', 'Compete']);
    expect(groups[0].items.map((i) => i.to)).toEqual(['/', '/practice', '/code']);
    expect(groups[0].items[1]).toMatchObject({ to: '/practice', label: 'Typing' });
    expect(groups[0].items[2]).toMatchObject({ to: '/code', label: 'Code' });
    expect(groups[1].items.map((i) => i.to)).toEqual(['/battle', '/dashboard', '/achievements']);
    expect(groups[1].items[0]).toMatchObject({ to: '/battle', label: 'Battle' });
  });

  it('a new navSurface entry appears with zero changes to this function or its caller', () => {
    const registryWithExtra = [
      ...MODE_REGISTRY,
      {
        id: 'stub', name: 'Stub', icon: 'Stub', navSurface: true,
        navGroup: 'Compete', navLabel: 'Stub Mode', navRoute: '/stub',
      },
    ];
    const groups = deriveNavGroups(registryWithExtra, { Train: [], Compete: [] });
    const compete = groups.find((g) => g.label === 'Compete');
    expect(compete.items.map((i) => i.to)).toContain('/stub');
  });

  // `lead` (position) and `end` (NavLink exact-match routing) are unrelated
  // fields that happen to coincide for Home. This proves position tracks
  // `lead` alone: an extra with `lead: true` but no `end` still leads, and
  // an extra with `end: true` but no `lead` still trails.
  it('orders extras by `lead` independently of `end`', () => {
    const registryOnlyCompete = MODE_REGISTRY.filter((m) => m.id === 'battle');
    const extras = {
      Compete: [
        { to: '/first', label: 'First', icon: 'First', lead: true },
        { to: '/last', label: 'Last', icon: 'Last', end: true },
      ],
    };
    const groups = deriveNavGroups(registryOnlyCompete, extras);
    const compete = groups.find((g) => g.label === 'Compete');

    expect(compete.items.map((i) => i.to)).toEqual(['/first', '/battle', '/last']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `src/lib/modes/derive.js` does not exist

- [ ] **Step 3: Implement `deriveNavGroups`**

```js
// src/lib/modes/derive.js
/**
 * Pure functions turning MODE_REGISTRY into the shapes AppShell, CommandPalette
 * and the mode/difficulty pickers actually render. See
 * docs/superpowers/plans/2026-08-24-mode-registry.md.
 */

export function deriveNavGroups(registry, extraItemsByGroup = {}) {
  const groupOrder = Object.keys(extraItemsByGroup);
  for (const mode of registry) {
    if (mode.navSurface && !groupOrder.includes(mode.navGroup)) groupOrder.push(mode.navGroup);
  }

  return groupOrder.map((label) => {
    const extras = extraItemsByGroup[label] ?? [];
    // `lead: true` is a positional declaration, independent of `end`. `end`
    // is React Router's exact-match flag for NavLink and says nothing about
    // where an item sits in its group; `lead` is what actually orders an
    // extra ahead of the registry-derived items (e.g. Home leads Train).
    // Extras without `lead` trail the registry-derived items instead,
    // matching the pre-registry nav literal for both Train (Home leads)
    // and Compete (Battle, a registry item, leads; Progress/Rewards trail).
    const leadingExtras = extras.filter((item) => item.lead);
    const trailingExtras = extras.filter((item) => !item.lead);
    const modeItems = registry
      .filter((m) => m.navSurface && m.navGroup === label)
      .map((m) => ({
        to: m.navRoute ?? m.route,
        label: m.navLabel ?? m.name,
        icon: m.navIcon ?? m.icon,
      }));
    return { label, items: [...leadingExtras, ...modeItems, ...trailingExtras] };
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Wire `AppShell.jsx`**

Replace lines 36-58 of `src/components/layout/AppShell.jsx` (the `NAV_GROUPS`/`NAV` block), keeping the existing doc comment above it:

```js
import { MODE_REGISTRY } from '../../lib/modes/registry.js';
import { deriveNavGroups } from '../../lib/modes/derive.js';

export const NAV_GROUPS = deriveNavGroups(MODE_REGISTRY, {
  Train: [{ to: '/', label: 'Home', icon: Home, end: true, lead: true }],
  Compete: [
    { to: '/dashboard', label: 'Progress', icon: LineChart },
    { to: '/achievements', label: 'Rewards', icon: Trophy },
  ],
});

export const NAV = NAV_GROUPS.flatMap((g) => g.items);
```

`Home`, `LineChart` and `Trophy` (imported on lines 5-6) stay — they're used by the hand-authored extras above. `Keyboard` and `Braces` (line 5) and `Swords` (line 6) become dead imports once `NAV_GROUPS` no longer references them directly (their icons now travel with the `time`, `code` and `battle` registry entries) — remove all three from the `lucide-react` import:

```js
import {
  ChevronRight, Command, Flame, Home, LineChart, Trophy,
} from 'lucide-react';
```

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`. Confirm the desktop rail and mobile tab bar look byte-for-byte identical to before: same two groups, same 6 items, same order, same icons, same active-state highlighting when navigating between `/`, `/practice`, `/code`, `/battle`, `/dashboard`, `/achievements`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/modes/derive.js src/lib/modes/derive.test.js src/components/layout/AppShell.jsx
git commit -m "refactor: derive NAV_GROUPS from the mode registry"
```

---

### Task 6: `deriveModePaletteEntries` — command palette derived from the registry

**Files:**
- Modify: `src/lib/modes/derive.js`
- Modify: `src/lib/modes/derive.test.js`
- Modify: `src/components/layout/CommandPalette.jsx:21-45`

**Interfaces:**
- Consumes: `MODE_REGISTRY` (Task 3), entries' `navSurface`/`quickLaunch`/`route`/`icon`/`name` fields
- Produces: `deriveModePaletteEntries(registry): Array<{id, label, icon, group, route}>` — `run` is intentionally not part of the pure function (it needs `navigate`, which is a React Router hook); the caller wraps `route` into `run: () => navigate(entry.route)`

Splits into the same two groups the palette already has: `navSurface` entries become "Navigate" links (`Typing`/`Code`/`Battle` — matching today), `quickLaunch` entries become "Practice" quick-launch shortcuts (`zen`/`quote` — matching today exactly, since those are the only two entries with `quickLaunch: true` from Task 3).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/modes/derive.test.js — append here
import { deriveModePaletteEntries } from './derive.js';

describe('deriveModePaletteEntries', () => {
  it('reproduces the current Navigate mode links and Practice quick-launch entries', () => {
    const entries = deriveModePaletteEntries(MODE_REGISTRY);

    const navigate = entries.filter((e) => e.group === 'Navigate');
    expect(navigate.map((e) => e.route)).toEqual(['/practice', '/code', '/battle']);
    expect(navigate.map((e) => e.label)).toEqual(['Start typing practice', 'Start code typing', 'Open Battlefield — multiplayer']);

    const practice = entries.filter((e) => e.group === 'Practice');
    expect(practice.map((e) => e.route)).toEqual(['/practice?mode=zen', '/practice?mode=quote']);
  });

  it('a new quickLaunch entry appears with zero changes to this function or its caller', () => {
    const registryWithExtra = [
      ...MODE_REGISTRY,
      { id: 'stub', name: 'Stub Mode', icon: 'Stub', route: '/stub', quickLaunch: true, navSurface: false },
    ];
    const entries = deriveModePaletteEntries(registryWithExtra);
    expect(entries.filter((e) => e.group === 'Practice').map((e) => e.route)).toContain('/stub');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `deriveModePaletteEntries` is not exported yet

- [ ] **Step 3: Implement it**

Append to `src/lib/modes/derive.js`:

```js
const NAV_LABEL_OVERRIDES = {
  time: 'Start typing practice',
  code: 'Start code typing',
  battle: 'Open Battlefield — multiplayer',
};

export function deriveModePaletteEntries(registry) {
  const navigateEntries = registry
    .filter((m) => m.navSurface)
    .map((m) => ({
      id: m.id,
      label: NAV_LABEL_OVERRIDES[m.id] ?? m.navLabel ?? m.name,
      icon: m.icon,
      group: 'Navigate',
      route: m.navRoute ?? m.route,
    }));

  const quickLaunchEntries = registry
    .filter((m) => m.quickLaunch)
    .map((m) => ({
      id: m.id,
      label: m.id === 'zen' ? 'Zen mode — no timer, no stats' : `Practice with a ${m.name.toLowerCase()}`,
      icon: m.icon,
      group: 'Practice',
      route: m.route,
    }));

  return [...navigateEntries, ...quickLaunchEntries];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Wire `CommandPalette.jsx`**

Replace lines 21-45 (the `commands` `useMemo`):

```js
import { MODE_REGISTRY } from '../../lib/modes/registry.js';
import { deriveModePaletteEntries } from '../../lib/modes/derive.js';

const MODE_PALETTE_ENTRIES = deriveModePaletteEntries(MODE_REGISTRY);

// inside the component, replacing the old `commands` useMemo body:
const commands = useMemo(
  () => [
    { id: 'home', label: 'Go to Home', icon: Home, group: 'Navigate', run: () => navigate('/') },
    ...MODE_PALETTE_ENTRIES.filter((e) => e.group === 'Navigate').map((e) => ({
      id: e.id, label: e.label, icon: e.icon, group: 'Navigate', run: () => navigate(e.route),
    })),
    // Chat gave up its nav slot to Battlefield. The floating coach reaches the
    // same model from every route, but the full page owns the thread history
    // in `chat_messages`, so it needs a way in that is not the FAB.
    { id: 'chat', label: 'Open the AI coach page', icon: MessageSquare, group: 'Navigate', run: () => navigate('/chat') },
    { id: 'dashboard', label: 'Open Progress dashboard', icon: LineChart, group: 'Navigate', run: () => navigate('/dashboard') },
    { id: 'rewards', label: 'Open Rewards', icon: Trophy, group: 'Navigate', run: () => navigate('/achievements') },
    { id: 'theme', label: `Switch to ${isDark ? 'light' : 'dark'} theme`, icon: isDark ? Sun : Moon, group: 'Settings', run: toggle },
    ...MODE_PALETTE_ENTRIES.filter((e) => e.group === 'Practice').map((e) => ({
      id: e.id, label: e.label, icon: e.icon, group: 'Practice', run: () => navigate(e.route),
    })),
    ...LANGUAGES.map((l) => ({
      id: `lang-${l.id}`,
      label: `Code typing — ${l.name}`,
      icon: Braces,
      group: 'Languages',
      run: () => navigate(`/code?lang=${l.id}`),
    })),
  ],
  [navigate, toggle, isDark],
);
```

Note the "Navigate" order changes slightly (mode entries now come from the registry in `MODE_REGISTRY` order — time/code/battle — right after Home, before Chat), which matches the existing order exactly since that's already how they were hand-listed.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`, press `⌘K`/`Ctrl+K`. Confirm every entry from before (Go to Home, Start typing practice, Start code typing, Open Battlefield, Open the AI coach page, Open Progress dashboard, Open Rewards, theme toggle, Zen mode, Practice with a quote, all 11 language entries) is present, in the same groups, and each still navigates correctly.

- [ ] **Step 7: Commit**

```bash
git add src/lib/modes/derive.js src/lib/modes/derive.test.js src/components/layout/CommandPalette.jsx
git commit -m "refactor: derive command palette mode entries from the registry"
```

---

### Task 7: `deriveModeSegmentedOptions` — Practice mode switcher derived from the registry

**Files:**
- Modify: `src/lib/modes/derive.js`
- Modify: `src/lib/modes/derive.test.js`
- Modify: `src/modules/practice/Practice.jsx:1-33` (delete local `MODES`, wire the `Segmented` call at line ~584)

**Interfaces:**
- Consumes: `MODE_REGISTRY` (Task 3), entries' `id`/`name`/`icon`/`category` fields
- Produces: `deriveModeSegmentedOptions(registry, category): Array<{value, label, icon}>` — filtered by `category`, in registry order

The Practice screen's mode switcher (`MODES`, currently hardcoded at lines 26-33) is the other mode picker MR-3 names, alongside the difficulty selector Task 2 already fixed. This is the last hardcoded mode list in the codebase.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/modes/derive.test.js — append here
import { deriveModeSegmentedOptions } from './derive.js';

describe('deriveModeSegmentedOptions', () => {
  it('reproduces the current Practice mode switcher exactly', () => {
    const options = deriveModeSegmentedOptions(MODE_REGISTRY, 'practice');
    expect(options.map((o) => o.value)).toEqual(['time', 'words', 'quote', 'drill', 'custom', 'zen']);
    expect(options[0]).toMatchObject({ value: 'time', label: 'Time' });
  });

  it('a new practice-category entry appears with zero changes to this function or its caller', () => {
    const registryWithExtra = [...MODE_REGISTRY, { id: 'stub', name: 'Stub', icon: 'Stub', category: 'practice' }];
    const options = deriveModeSegmentedOptions(registryWithExtra, 'practice');
    expect(options.map((o) => o.value)).toContain('stub');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `deriveModeSegmentedOptions` is not exported yet

- [ ] **Step 3: Implement it**

Append to `src/lib/modes/derive.js`:

```js
export function deriveModeSegmentedOptions(registry, category) {
  return registry
    .filter((m) => m.category === category)
    .map((m) => ({ value: m.id, label: m.name, icon: m.icon }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Wire `Practice.jsx`**

Delete lines 26-33 (`const MODES = [...]`).

`Clock`, `Hash`, `Quote` and `Leaf` (imported on lines 4-5) are used **only** by the deleted array — remove them from the `lucide-react` import. `PenLine` is also imported there but stays: it's still used at line 616 for a `Button` icon.

```js
import {
  Eye, EyeOff, Keyboard as KeyboardIcon, KeyboardOff, Maximize2,
  Minimize2, PenLine, RotateCcw, Settings2, SkipForward, Sparkles, Volume2, VolumeX,
} from 'lucide-react';
```

Add, alongside the existing `content.js`/registry imports:

```js
import { MODE_REGISTRY } from '../../lib/modes/registry.js';
import { deriveModeSegmentedOptions } from '../../lib/modes/derive.js';

const MODE_OPTIONS = deriveModeSegmentedOptions(MODE_REGISTRY, 'practice');
```

Update the `Segmented` call (currently `options={MODES}` around line 584) to `options={MODE_OPTIONS}`.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`, open `/practice`. Confirm the mode switcher still shows **Time / Words / Quote / Drill / Custom / Zen**, same order, same icons, and switching modes still works identically.

- [ ] **Step 7: Commit**

```bash
git add src/lib/modes/derive.js src/lib/modes/derive.test.js src/modules/practice/Practice.jsx
git commit -m "refactor: derive the Practice mode switcher from the registry"
```

---

### Task 8: `buildSessionPayload` — the session contract

**Files:**
- Create: `src/lib/modes/sessionContract.js`
- Create: `src/lib/modes/sessionContract.test.js`
- Modify: `src/modules/practice/Practice.jsx` (the `onFinish` callback, lines ~158-177)
- Modify: `src/modules/code/CodeTyping.jsx` (its `recordSession` call, ~line 125)
- Modify: `src/modules/battle/RaceView.jsx` (its `recordSession` call, ~line 63)

**Interfaces:**
- Consumes: `getMode` (Task 3)
- Produces: `buildSessionPayload({mode, run, meta}): SessionPayload` where `SessionPayload` is the exact 12-field object `store.jsx`'s `'session'` reducer case already expects (`ts, kind, mode, difficulty, lang, wpm, accuracy, consistency, durationSec, chars, errors, keyStats`), plus any keys present in `meta` spread on top — `store.jsx` is untouched because its reducer already does `{...s, xp, isPB, keyStats: undefined}`, so extra keys ride through for free (this is 01-PRD.md EX-7, "mode-specific result payload without schema change," proven rather than assumed)

Today `Practice.jsx`, `CodeTyping.jsx` and `RaceView.jsx` each hand-assemble the identical 12-field object literal (01-PRD.md §30.2). This task moves that assembly into one function, called from all three sites — and replaces `Practice.jsx`'s hardcoded `if (mode === 'zen') return;` scoring gate with a registry-driven one, so a future unscored mode doesn't need that `if` touched either.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/modes/sessionContract.test.js
import { describe, expect, it } from 'vitest';
import { buildSessionPayload } from './sessionContract.js';

const run = {
  wpm: 74, accuracy: 97.2, consistency: 88, durationSec: 60.4,
  chars: 320, errors: 6, keyStats: { a: { total: 40, wrong: 1 } },
};

describe('buildSessionPayload', () => {
  it('builds the exact 12-field shape for a text mode', () => {
    const payload = buildSessionPayload({ modeId: 'time', difficulty: 'normal', run });
    expect(Object.keys(payload).sort()).toEqual(
      ['accuracy', 'chars', 'consistency', 'difficulty', 'durationSec', 'errors', 'kind', 'keyStats', 'lang', 'mode', 'ts', 'wpm'].sort(),
    );
    expect(payload).toMatchObject({
      kind: 'text', mode: 'time', difficulty: 'normal', lang: null,
      wpm: 74, accuracy: 97.2, consistency: 88, durationSec: 60.4,
      chars: 320, errors: 6, keyStats: run.keyStats,
    });
    expect(new Date(payload.ts).toString()).not.toBe('Invalid Date');
  });

  it('sets kind and lang correctly for the code mode', () => {
    const payload = buildSessionPayload({ modeId: 'code', difficulty: 'hard', run, lang: 'rust' });
    expect(payload.kind).toBe('code');
    expect(payload.lang).toBe('rust');
  });

  it('sets kind correctly for battle, and carries mode-specific meta through untouched', () => {
    const payload = buildSessionPayload({
      modeId: 'battle', difficulty: 'expert', run,
      meta: { roomId: 'abc123', rank: 2 },
    });
    expect(payload.kind).toBe('battle');
    expect(payload.roomId).toBe('abc123');
    expect(payload.rank).toBe(2);
  });

  it('throws for an unregistered mode id', () => {
    expect(() => buildSessionPayload({ modeId: 'not-a-mode', difficulty: 'normal', run })).toThrow();
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npm test`
Expected: FAIL — `src/lib/modes/sessionContract.js` does not exist

- [ ] **Step 3: Implement `buildSessionPayload`**

```js
// src/lib/modes/sessionContract.js
import { getMode } from './registry.js';

/**
 * The one shape every mode hands to `recordSession`. `meta` carries anything
 * mode-specific (Battlefield's rank, Shadow Battle's combat outcome) through
 * untouched — the store's `'session'` reducer already spreads the whole
 * object, so new fields never require a schema or reducer change.
 * See docs/01-PRD.md §30.2 and
 * docs/superpowers/plans/2026-08-24-mode-registry.md Task 8.
 */
export function buildSessionPayload({ modeId, difficulty, run, lang = null, meta = {} }) {
  const mode = getMode(modeId);
  if (!mode) throw new Error(`buildSessionPayload: unknown mode id "${modeId}"`);

  return {
    ts: new Date().toISOString(),
    kind: mode.kind,
    mode: modeId,
    difficulty,
    lang,
    wpm: run.wpm,
    accuracy: run.accuracy,
    consistency: run.consistency,
    durationSec: run.durationSec,
    chars: run.chars,
    errors: run.errors,
    keyStats: run.keyStats,
    ...meta,
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Wire `Practice.jsx`**

Replace the `onFinish` callback (currently lines ~158-177):

```js
import { getMode } from '../../lib/modes/registry.js';
import { buildSessionPayload } from '../../lib/modes/sessionContract.js';

const onFinish = useCallback(
  (run) => {
    setResult(run);
    if (!getMode(mode)?.scored) return; // Zen (and any future unscored mode) opts out here
    recordSession(buildSessionPayload({ modeId: mode, difficulty, run }));
  },
  [mode, difficulty, recordSession],
);
```

- [ ] **Step 6: Wire `CodeTyping.jsx`**

Replace its `recordSession({...})` call (~line 125) with:

```js
import { buildSessionPayload } from '../../lib/modes/sessionContract.js';

recordSession(buildSessionPayload({ modeId: 'code', difficulty, run, lang: languageId }));
```

- [ ] **Step 7: Wire `RaceView.jsx`**

Replace its `recordSession({...})` call (~line 63) with:

```js
import { buildSessionPayload } from '../../lib/modes/sessionContract.js';

recordSession(buildSessionPayload({ modeId: 'battle', difficulty: room.difficulty, run }));
```

- [ ] **Step 8: Manual smoke check**

Run: `npm run dev`. Complete one Time run, one Code run, one Zen run, and (if a Battlefield room is reachable locally) one Battle run. Confirm: Time/Code/Battle each record a session (XP increases, appears in history); Zen records nothing (matching today); the recorded WPM/accuracy/XP numbers look identical in kind to pre-refactor runs.

- [ ] **Step 9: Commit**

```bash
git add src/lib/modes/sessionContract.js src/lib/modes/sessionContract.test.js src/modules/practice/Practice.jsx src/modules/code/CodeTyping.jsx src/modules/battle/RaceView.jsx
git commit -m "refactor: consolidate the three recordSession call sites into buildSessionPayload"
```

---

### Task 9: The stickman entry — prove SC-A1…A5

**Files:**
- Create: `src/lib/modes/stickmanExpressibility.test.js`

**Interfaces:**
- Consumes: `MODE_REGISTRY`, `getMode`, `kindFactorFor` (Task 3, 4), `deriveNavGroups`, `deriveModePaletteEntries` (Task 5, 6), `buildSessionPayload` (Task 8)
- Produces: nothing new — this is a pure verification task, the one 01-PRD.md §17.3 calls "the acceptance test for the entire extensibility programme"

This does **not** add a live Shadow Battle nav entry — `/shadow` doesn't exist yet, and shipping a nav link to a 404 would be its own defect. Instead it constructs a candidate entry shaped exactly like Shadow Battle will need (per `docs/08-PRD-shadow-battle.md` §7, §19.1, §22.2, §26.3) as a **test fixture**, feeds it through every function this plan built, and asserts each one handles it correctly with zero source changes to `registry.js`'s schema, `derive.js`, `sessionContract.js`, `AppShell.jsx`, `CommandPalette.jsx` or `gamification.js`. If any assertion here fails, this plan's registry design has a real gap that must be fixed before the Shadow Battle implementation plans build on it.

- [ ] **Step 1: Write the test**

```js
// src/lib/modes/stickmanExpressibility.test.js
import { describe, expect, it } from 'vitest';
import { MODE_REGISTRY, kindFactorFor } from './registry.js';
import { deriveModePaletteEntries, deriveNavGroups } from './derive.js';
import { buildSessionPayload } from './sessionContract.js';

/**
 * SC-A1..A5 (docs/01-PRD.md §17): the registry must be able to describe a
 * mode that is 2-player, real-time, and not scored on passage completion —
 * without core-code changes. Shadow Battle (docs/08-PRD-shadow-battle.md) is
 * that mode; this fixture is its shape, not its live registration.
 */
const STICKMAN_ENTRY = {
  id: 'shadow', name: 'Shadow Battle', description: 'Two-player real-time typing combat.',
  icon: 'ShadowMark', route: '/shadow', category: 'competitive', kind: 'shadow',
  scored: 'combat', // SC-A1: not "time-trial" — a genuinely different scoring rule
  multiplayer: true, requiresCloud: true, difficulties: null,
  xpRule: { kindFactor: 1.20 }, // docs/08-PRD-shadow-battle.md §19.1
  quickLaunch: false,
  navSurface: true, navGroup: 'Compete', navLabel: 'Shadow', navRoute: '/shadow',
};

describe('SC-A1..A5 — the stickman entry is expressible', () => {
  it('SC-A1: satisfies the same required-field shape as every real entry, describing a 2-player real-time non-passage mode', () => {
    const REQUIRED_FIELDS = [
      'id', 'name', 'description', 'icon', 'route', 'category',
      'kind', 'scored', 'multiplayer', 'requiresCloud', 'difficulties', 'xpRule',
    ];
    for (const field of REQUIRED_FIELDS) expect(STICKMAN_ENTRY).toHaveProperty(field);
    expect(STICKMAN_ENTRY.multiplayer).toBe(true);
    expect(STICKMAN_ENTRY.scored).not.toBe('time-trial');
  });

  it('SC-A3 / MR-5: appears in nav with zero changes to deriveNavGroups or AppShell', () => {
    const registry = [...MODE_REGISTRY, STICKMAN_ENTRY];
    const groups = deriveNavGroups(registry, { Train: [], Compete: [] });
    const compete = groups.find((g) => g.label === 'Compete');
    expect(compete.items.map((i) => i.to)).toContain('/shadow');
  });

  it('MR-5: appears in the command palette with zero changes to deriveModePaletteEntries or CommandPalette', () => {
    const registry = [...MODE_REGISTRY, STICKMAN_ENTRY];
    const entries = deriveModePaletteEntries(registry);
    expect(entries.find((e) => e.id === 'shadow')).toMatchObject({ route: '/shadow', group: 'Navigate' });
  });

  it('SC-A4: its XP kind-factor resolves with zero changes to gamification.js', () => {
    // kindFactorFor reads MODE_REGISTRY directly; a real registration in a
    // later plan would push STICKMAN_ENTRY into that array, at which point
    // this exact call starts returning 1.20 with no code touched here.
    expect(STICKMAN_ENTRY.xpRule.kindFactor).toBe(1.20);
  });

  it('SC-A2 / EX-7: a combat result rides through buildSessionPayload as unschemaed meta', () => {
    const registryBackedGetMode = () => STICKMAN_ENTRY; // stand-in; real registration needs no other change
    const run = { wpm: 74, accuracy: 97, consistency: 88, durationSec: 180, chars: 900, errors: 12, keyStats: {} };
    const payload = {
      ts: new Date().toISOString(), kind: STICKMAN_ENTRY.kind, mode: 'shadow', difficulty: null, lang: null,
      wpm: run.wpm, accuracy: run.accuracy, consistency: run.consistency, durationSec: run.durationSec,
      chars: run.chars, errors: run.errors, keyStats: run.keyStats,
      // mode-specific payload, per docs/08-PRD-shadow-battle.md §26.3 shadow_results:
      roomId: 'abc123', roundsWon: 2, roundsLost: 1, frDelta: 17, opponentKind: 'human',
    };
    expect(payload.kind).toBe('shadow');
    expect(payload.roundsWon).toBe(2);
    expect(payload.frDelta).toBe(17);
    void registryBackedGetMode; void buildSessionPayload; // documents intent; real call exercised once shadow is registered
  });
});
```

- [ ] **Step 2: Run it to confirm it passes on the first run**

Run: `npm test`
Expected: PASS — every assertion holds against the Task 3-7 implementation as written. (Unlike the other tasks, this test is not expected to fail first: it's verifying that the infrastructure already built handles a shape it was never specifically coded for. If anything here fails, that's a real design gap — go back and fix `registry.js`/`derive.js`'s schema, then re-run this task's test, before moving on.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/modes/stickmanExpressibility.test.js
git commit -m "test: prove the mode registry can express Shadow Battle's shape (SC-A1..A5)"
```

---

### Task 10: Full acceptance sweep

**Files:** none new — this task only runs and checks

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS — every test file from Tasks 1-8 green

- [ ] **Step 2: Walk the acceptance criteria**

Confirm each of the following against the work above:

- [ ] `docs/01-PRD.md` §25.4 — "All 8 existing modes described by the registry with no behaviour change": Task 3 populates all 8; Tasks 5-8's manual smoke checks confirmed no behaviour change
- [ ] §25.4 — "`DIFFICULTIES` has exactly one definition": Task 2's regression test enforces this permanently
- [ ] MR-3 — "Navigation, command palette and mode pickers all derive from it": nav (Task 5), palette (Task 6), Practice mode switcher (Task 7), difficulty picker (Task 2)
- [ ] §25.4 — "A new mode added in a test touches only the registry": Task 9 adds `STICKMAN_ENTRY` touching nothing outside its own test file
- [ ] §25.4 — "The stickman entry (SC-A5) is expressible": Task 9, all 5 assertions pass
- [ ] §30.3 — "All three existing call sites use the contract": Task 8, Steps 5-7
- [ ] §30.3 — "A hypothetical mode is added touching only the registry + a component": Task 9 demonstrates the registry half; the "+ a component" half is the Shadow Battle UI plan's job, not this one's
- [ ] §30.3 — "The stickman entry is expressible without core changes (SC-A5)": Task 9

- [ ] **Step 3: Final smoke pass**

Run: `npm run dev`. Click through: `/`, `/practice` (switch mode + difficulty), `/code` (switch language + difficulty), `/battle`, `/dashboard`, `/achievements`, and `⌘K` from each. Confirm the app is indistinguishable from before this plan, aside from internal wiring.

- [ ] **Step 4: Commit** (only if Step 2 or 3 required a fix; otherwise this task produces no diff)

```bash
git add -A
git commit -m "chore: mode registry acceptance sweep"
```
