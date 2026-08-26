import { Flame, Swords } from 'lucide-react';

/**
 * The Arena gate's two lanes, as data.
 *
 * Copy lives here rather than inline in `Arena.jsx` for one concrete reason:
 * `vitest.config.js` runs `environment: 'node'` and collects only `*.test.js`,
 * so there is no DOM to render into and no way to assert a string that only
 * exists inside JSX. Keeping the words in a module makes them testable —
 * `arena.test.js` pins the lane contract, the CTA labels and the "Shadow
 * Battle" spelling without needing jsdom.
 *
 * See docs/superpowers/plans/2026-08-25-arena-gate-nav.md.
 */

/**
 * The field set every lane must carry, exported so `arena.test.js` and
 * `Arena.jsx` agree on one list instead of each pinning its own copy — the
 * same arrangement `REQUIRED_MODE_FIELDS` uses in `lib/modes/registry.js`.
 */
export const REQUIRED_LANE_FIELDS = [
  'id', 'to', 'eyebrow', 'title', 'tagline', 'intro', 'beats', 'cta', 'tone', 'icon', 'hotkey',
];

/**
 * Order is render order: Battlefield left, Shadow Battle right.
 *
 * `tone` drives which token pair a lane paints with, and it is not decorative.
 * Shadow Battle's own Side-Color Rule (docs/08-PRD-shadow-battle.md, enforced
 * in FighterCanvas.jsx) puts player one in `--brand` and player two in
 * `--accent`; the gate uses the same left/right assignment so the colour you
 * choose here is the colour you fight in.
 *
 * The right lane is titled "Shadow Battle", not "Shadow Fight". SB-NAV-2 fixes
 * that name, and ShadowHub's <h1>, the Home action card and the ⌘K palette all
 * already say it — a fourth spelling would be drift. The fight goes in the
 * tagline and the CTA instead.
 */
export const ARENA_LANES = Object.freeze([
  Object.freeze({
    id: 'battlefield',
    to: '/battle',
    eyebrow: 'Up to 8 fighters',
    title: 'Battlefield',
    tagline: 'One passage. One clock. Everybody types.',
    intro:
      'A shared passage drops, a server-owned countdown burns down, and up to eight '
      + 'people race the same text at once. No handicaps, no head start — the cleanest '
      + 'run takes it.',
    beats: Object.freeze([
      'Two to eight players in one room',
      'Start time owned by the server, not your laptop',
      'Fewest mistakes wins, then speed',
    ]),
    cta: "Let's Battle",
    tone: 'brand',
    icon: Swords,
    hotkey: 'B',
  }),
  Object.freeze({
    id: 'shadow',
    to: '/shadow',
    eyebrow: '1v1 combat',
    title: 'Shadow Battle',
    tagline: 'Every word is a move. Type to strike, type to survive.',
    intro:
      'A tactical duel, not a race. Fight as the Stickman and three lanes — Fight, Shield, '
      + 'Jump — sit in front of you, one keystroke each to commit. Fight as the Shadow Ninja '
      + 'and a paragraph unrolls instead, where a single wrong character costs you health.',
    beats: Object.freeze([
      'Two fighters: Stickman lanes or Ninja prose',
      'Parry, chain and Overdrive finishers',
      'Five bot profiles offline, or a live opponent',
    ]),
    cta: "Let's War",
    tone: 'accent',
    icon: Flame,
    hotkey: 'S',
  }),
]);

/**
 * The tie-breaker strip under the lanes.
 *
 * A gate that only sells both sides leaves you no way to choose, and neither
 * lane should have to badmouth the other to differentiate itself. Three rows
 * of plain fact do the job that marketing copy cannot.
 */
export const ARENA_COMPARISON = Object.freeze([
  Object.freeze({ label: 'Players', battlefield: '2 – 8', shadow: '1 v 1' }),
  Object.freeze({ label: 'Win condition', battlefield: 'Cleanest run', shadow: 'Last one standing' }),
  Object.freeze({ label: 'Plays offline', battlefield: 'No — needs the cloud', shadow: 'Yes — Trial vs. bots' }),
]);

/** Lookup by id. Returns undefined for anything unknown, like `getMode`. */
export function getLane(id) {
  return ARENA_LANES.find((lane) => lane.id === id);
}
