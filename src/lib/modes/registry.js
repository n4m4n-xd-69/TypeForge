import { Braces, Clock, Hash, Keyboard, Leaf, PenLine, Quote, Swords, Zap } from 'lucide-react';
import { DIFFICULTIES } from '../content.js';

/**
 * The MR-2-required field set every registry entry must carry, per
 * docs/01-PRD.md §25. Exported so registry.test.js and
 * stickmanExpressibility.test.js check the same real/hypothetical entries
 * against one single list, instead of each file pinning its own literal
 * copy that could silently drift out of sync with the real contract.
 */
export const REQUIRED_MODE_FIELDS = [
  'id', 'name', 'description', 'icon', 'route', 'category',
  'kind', 'scored', 'multiplayer', 'requiresCloud', 'difficulties', 'xpRule',
];

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
    // navIcon overrides icon here: `icon` is this mode's own identity (Clock,
    // matching the /practice mode switcher), but the nav rail's "Typing" tab
    // represents the whole practice surface, not the Time submode, so it
    // keeps the pre-registry Keyboard glyph.
    navSurface: true, navGroup: 'Train', navLabel: 'Typing', navRoute: '/practice', navIcon: Keyboard,
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
    // quickLaunchIcon overrides icon here: `icon` is this mode's own identity
    // (Quote), but the command palette's quick-launch shortcut has always
    // shown the generic Keyboard glyph instead, same split as `navIcon`.
    quickLaunchIcon: Keyboard,
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
    // quickLaunchIcon overrides icon here: `icon` is this mode's own identity
    // (Leaf), but the command palette's quick-launch shortcut has always
    // shown Zap instead, same split as `navIcon`.
    quickLaunchIcon: Zap,
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
    // Battlefield sits between prose and code: someone is watching, which is its
    // own kind of pressure, but the text is ordinary English.
    xpRule: { kindFactor: 1.15 }, quickLaunch: false,
    // navRoute overrides route here, the same surface-vs-identity split the
    // `time` entry uses above: `route` is this mode's own destination
    // (/battle, still what getMode('battle').route returns and what every
    // scoring path reads), but the nav rail's one competitive tab represents
    // the whole Compete surface — Battlefield *and* Shadow Battle — so it
    // points at the /arena gate that lets you choose between them. Naming it
    // "Arena" rather than "Battle" is what discharges SB-NAV-2, and holding
    // the nav at six items is what makes SB-NAV-1's `short` field unnecessary.
    // See docs/superpowers/plans/2026-08-25-arena-gate-nav.md §1.
    navSurface: true, navGroup: 'Compete', navLabel: 'Arena', navRoute: '/arena',
  },
];

export function getMode(id) {
  return MODE_REGISTRY.find((m) => m.id === id);
}

export function kindFactorFor(kind) {
  const mode = MODE_REGISTRY.find((m) => m.kind === kind);
  return mode?.xpRule?.kindFactor ?? 1;
}
