import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import Arena from './Arena.jsx';
import { ARENA_COMPARISON, ARENA_LANES, REQUIRED_LANE_FIELDS, getLane } from './lanes.js';
import { MODE_REGISTRY, getMode } from '../../lib/modes/registry.js';
import { deriveModePaletteEntries, deriveNavGroups } from '../../lib/modes/derive.js';

/**
 * Coverage for the Arena gate
 * (docs/superpowers/plans/2026-08-25-arena-gate-nav.md).
 *
 * `vitest.config.js` runs `environment: 'node'` and collects only `*.test.js`,
 * so there is no DOM here and nothing renders — the same constraint
 * `src/modules/shadow/ui.test.js` works under. What is testable is therefore
 * the data contract, the module surface, and the wiring between the registry,
 * the router and the lanes. That last one is the part worth having: a CTA
 * pointing at a route that no longer exists is the failure mode a gate page
 * actually has, and reading App.jsx catches it.
 */

const APP_JSX = readFileSync(resolve('src/App.jsx'), 'utf8');

describe('Arena gate surface', () => {
  it('exports a component', () => {
    expect(Arena).toBeDefined();
    expect(typeof Arena).toBe('function');
  });
});

describe('ARENA_LANES', () => {
  it('is exactly the two competitive modes, in render order', () => {
    expect(ARENA_LANES.map((l) => l.id)).toEqual(['battlefield', 'shadow']);
    expect(ARENA_LANES.map((l) => l.to)).toEqual(['/battle', '/shadow']);
  });

  it('every lane carries every required field', () => {
    for (const lane of ARENA_LANES) {
      for (const field of REQUIRED_LANE_FIELDS) {
        expect(lane, `${lane.id} is missing ${field}`).toHaveProperty(field);
      }
    }
  });

  it('every lane has three beats and non-empty prose', () => {
    for (const lane of ARENA_LANES) {
      expect(lane.beats).toHaveLength(3);
      for (const beat of lane.beats) expect(beat.trim().length).toBeGreaterThan(0);
      expect(lane.tagline.trim().length).toBeGreaterThan(0);
      expect(lane.intro.trim().length).toBeGreaterThan(40);
    }
  });

  it('carries the two calls to action, distinct from each other', () => {
    const ctas = ARENA_LANES.map((l) => l.cta);
    expect(ctas).toEqual(["Let's Battle", "Let's War"]);
    expect(new Set(ctas).size).toBe(ctas.length);
  });

  /**
   * docs/08-PRD-shadow-battle.md §23.2 SB-NAV-2 fixes the name as "Shadow
   * Battle" — not "Shadow Fight", not "Combat". ShadowHub's own <h1>, Home's
   * action card and the ⌘K entry already agree; this pins the gate to the same
   * spelling so a fourth variant cannot creep in through the copy.
   */
  it('SB-NAV-2: names the 1v1 mode "Shadow Battle"', () => {
    expect(getLane('shadow').title).toBe('Shadow Battle');
  });

  it('assigns brand to the left lane and accent to the right, per the Side-Color Rule', () => {
    expect(ARENA_LANES.map((l) => l.tone)).toEqual(['brand', 'accent']);
  });

  it('hotkeys are unique single characters', () => {
    const keys = ARENA_LANES.map((l) => l.hotkey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[A-Z]$/);
  });

  it('getLane returns undefined for an unknown id', () => {
    expect(getLane('nonexistent')).toBeUndefined();
  });
});

describe('ARENA_COMPARISON', () => {
  it('has a cell for every lane on every row', () => {
    expect(ARENA_COMPARISON.length).toBeGreaterThan(0);
    for (const row of ARENA_COMPARISON) {
      expect(row.label.trim().length).toBeGreaterThan(0);
      // Arena.jsx renders `row[lane.id]`, so a lane id with no matching key
      // would render an empty cell rather than throwing. Assert the join.
      for (const lane of ARENA_LANES) {
        expect(row, `row "${row.label}" is missing a cell for ${lane.id}`).toHaveProperty(lane.id);
        expect(String(row[lane.id]).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('gate wiring', () => {
  it('the nav rail Compete entry points at /arena, not at a mode', () => {
    const groups = deriveNavGroups(MODE_REGISTRY, { Train: [], Compete: [] });
    const compete = groups.find((g) => g.label === 'Compete');
    expect(compete.items.map((i) => i.to)).toContain('/arena');
    expect(compete.items.find((i) => i.to === '/arena').label).toBe('Arena');
  });

  /**
   * The surface-vs-identity split, stated as an assertion rather than left in
   * a comment: the rail points at the gate while the mode itself still owns
   * /battle, which is what every scoring and XP path reads through getMode.
   */
  it('the battle mode keeps /battle as its own route while nav points at the gate', () => {
    expect(getMode('battle').route).toBe('/battle');
    expect(getMode('battle').navRoute).toBe('/arena');
  });

  it('the palette command for the gate describes the gate', () => {
    const entry = deriveModePaletteEntries(MODE_REGISTRY).find((e) => e.id === 'battle');
    expect(entry.route).toBe('/arena');
    expect(entry.label).toBe('Open the Arena — Battlefield or Shadow');
  });

  it('/arena is a registered route', () => {
    expect(APP_JSX).toContain('path="/arena"');
  });

  it('every lane CTA points at a route that still exists', () => {
    for (const lane of ARENA_LANES) {
      expect(APP_JSX, `no route declared for ${lane.to}`).toContain(`path="${lane.to}"`);
    }
  });

  /**
   * The gate must stay skippable. A shared room PIN, Home's action cards and
   * ResultsView's "Play again" all deep-link past it, and routing those through
   * a choice the user already made would be a regression.
   */
  it('both modes remain directly addressable, gate or no gate', () => {
    expect(APP_JSX).toContain('path="/battle"');
    expect(APP_JSX).toContain('path="/battle/:pin"');
    expect(APP_JSX).toContain('path="/shadow"');
    expect(APP_JSX).toContain('path="/shadow/:pin"');
  });

  /**
   * SB-NAV-1 says a seventh nav item forces a `short` field onto the nav
   * schema, because "Shadow Battle" clips at 360px. The gate's whole structural
   * argument is that it adds no item — so if a future change pushes the rail
   * past six, that argument is void and this test says so.
   */
  it('SB-NAV-1: the nav stays within the six-item budget, so no `short` field is needed', () => {
    const groups = deriveNavGroups(MODE_REGISTRY, {
      Train: [{ to: '/', label: 'Home', icon: 'Home', end: true, lead: true }],
      Compete: [
        { to: '/dashboard', label: 'Progress', icon: 'LineChart' },
        { to: '/achievements', label: 'Rewards', icon: 'Trophy' },
      ],
    });
    const items = groups.flatMap((g) => g.items);
    expect(items.length).toBeLessThanOrEqual(6);
    // The mobile tab bar renders `{item.label}` at text-[10px] with flex-1.
    for (const item of items) expect(item.label.length).toBeLessThanOrEqual(8);
  });
});
