import { describe, expect, it } from 'vitest';
import { Braces, Clock, Hash, Home, Keyboard, Leaf, LineChart, PenLine, Quote, Swords, Trophy, Zap } from 'lucide-react';
import { deriveModePaletteEntries, deriveModeSegmentedOptions, deriveNavGroups } from './derive.js';
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
    // Compete's lead item is the /arena gate rather than /battle directly. The
    // registry's `battle` entry still owns `route: '/battle'` — only its
    // navRoute/navLabel moved, the same surface-vs-identity split `time` uses
    // to put /practice in the rail instead of /practice?mode=time. See
    // docs/superpowers/plans/2026-08-25-arena-gate-nav.md.
    expect(groups[1].items.map((i) => i.to)).toEqual(['/arena', '/dashboard', '/achievements']);
    expect(groups[1].items[0]).toMatchObject({ to: '/arena', label: 'Arena' });
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

  // Regression coverage beyond the brief's own test: the brief's Step 3
  // ordering rule ("extra items first, then registry items") reorders
  // Compete to [Progress, Rewards, Battle], which contradicts both this
  // file's first test and the pre-registry NAV_GROUPS literal (Battle
  // led). It also used `icon: m.icon` unconditionally, which would swap
  // the Typing tab's icon from Keyboard to Clock (registry.js's `time`
  // entry uses Clock for its own identity, matching the /practice mode
  // switcher). These tests pin the full literal, including icon identity
  // and item order, using the exact extras AppShell.jsx passes.
  //
  // One documented departure from the pre-registry literal: Compete's lead
  // item is now `{ to: '/arena', label: 'Arena' }` rather than
  // `{ to: '/battle', label: 'Battle' }`. The icon (Swords) and the position
  // (leading) are unchanged — only the destination and the word moved, when
  // that tab stopped meaning "Battlefield" and started meaning "pick a
  // competitive mode". See
  // docs/superpowers/plans/2026-08-25-arena-gate-nav.md.
  it('matches the NAV_GROUPS literal exactly, including icon identity and order', () => {
    const extras = {
      Train: [{ to: '/', label: 'Home', icon: Home, end: true, lead: true }],
      Compete: [
        { to: '/dashboard', label: 'Progress', icon: LineChart },
        { to: '/achievements', label: 'Rewards', icon: Trophy },
      ],
    };
    const groups = deriveNavGroups(MODE_REGISTRY, extras);

    expect(groups).toEqual([
      {
        label: 'Train',
        items: [
          { to: '/', label: 'Home', icon: Home, end: true, lead: true },
          { to: '/practice', label: 'Typing', icon: Keyboard },
          { to: '/code', label: 'Code', icon: Braces },
        ],
      },
      {
        label: 'Compete',
        items: [
          { to: '/arena', label: 'Arena', icon: Swords },
          { to: '/dashboard', label: 'Progress', icon: LineChart },
          { to: '/achievements', label: 'Rewards', icon: Trophy },
        ],
      },
    ]);
  });

  // `lead` (position) and `end` (NavLink exact-match routing) are unrelated
  // fields that happen to coincide for Home. This proves position tracks
  // `lead` alone: an extra with `lead: true` but no `end` still leads, and
  // an extra with `end: true` but no `lead` still trails.
  it('orders extras by `lead` independently of `end`', () => {
    const registryOnlyCompete = MODE_REGISTRY.filter((m) => m.id === 'battle');
    const extras = {
      Compete: [
        // No `end`, but should lead.
        { to: '/first', label: 'First', icon: 'First', lead: true },
        // `end: true`, but no `lead`, so it should trail — not lead.
        { to: '/last', label: 'Last', icon: 'Last', end: true },
      ],
    };
    const groups = deriveNavGroups(registryOnlyCompete, extras);
    const compete = groups.find((g) => g.label === 'Compete');

    // '/arena' is the `battle` entry's navRoute — this test is about ordering,
    // not about which route that entry points at.
    expect(compete.items.map((i) => i.to)).toEqual(['/first', '/arena', '/last']);
  });
});

describe('deriveModePaletteEntries', () => {
  it('reproduces the current Navigate mode links and Practice quick-launch entries', () => {
    const entries = deriveModePaletteEntries(MODE_REGISTRY);

    const navigate = entries.filter((e) => e.group === 'Navigate');
    // The `battle` entry resolves to `navRoute ?? route`, and its navRoute is
    // the /arena gate — so both the route and its label describe the gate here.
    // CommandPalette.jsx carries separate direct commands for /battle and
    // /shadow, which are hand-added rather than derived (SB-NAV-5 tracks
    // deriving them) and so are out of this function's scope.
    expect(navigate.map((e) => e.route)).toEqual(['/practice', '/code', '/arena']);
    expect(navigate.map((e) => e.label)).toEqual(['Start typing practice', 'Start code typing', 'Open the Arena — Battlefield or Shadow']);
    // The palette's "Typing" entry has always shown Keyboard, not the Time
    // mode's own identity icon (Clock) — same surface-vs-identity split as
    // the nav rail's `navIcon` from Task 5. Code/Battle icons already match
    // their mode's own icon, so this only bites for `time`.
    expect(navigate.map((e) => e.icon)).toEqual([Keyboard, Braces, Swords]);
    // Inert today (React `key` only, verified against the rest of the
    // codebase), but cheap insurance against a silent id drift: these come
    // straight from the registry's own ids, not a hand-picked palette id.
    expect(navigate.map((e) => e.id)).toEqual(['time', 'code', 'battle']);

    const practice = entries.filter((e) => e.group === 'Practice');
    expect(practice.map((e) => e.route)).toEqual(['/practice?mode=zen', '/practice?mode=quote']);
    expect(practice.map((e) => e.label)).toEqual(['Zen mode — no timer, no stats', 'Practice with a quote']);
    // Same split for the quick-launch shortcuts: the pre-registry palette
    // used Zap for zen (not the mode's own Leaf) and Keyboard for quote
    // (not the mode's own Quote icon).
    expect(practice.map((e) => e.icon)).toEqual([Zap, Keyboard]);
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

describe('deriveModeSegmentedOptions', () => {
  it('reproduces the current Practice mode switcher exactly', () => {
    const options = deriveModeSegmentedOptions(MODE_REGISTRY, 'practice');
    expect(options.map((o) => o.value)).toEqual(['time', 'words', 'quote', 'drill', 'custom', 'zen']);
    expect(options[0]).toMatchObject({ value: 'time', label: 'Time' });
  });

  // Unlike the nav rail (`navIcon`) and the command palette (`quickLaunchIcon`),
  // the pre-registry Practice switcher literal used each mode's own identity
  // icon directly — Clock/Hash/Quote/Keyboard/PenLine/Leaf, matching
  // registry.js's plain `icon` field for all six practice-category entries.
  // No third icon override field is needed for this surface; this pins that
  // decision against the pre-registry MODES literal (980d633) byte-for-byte.
  it('matches the pre-registry MODES literal exactly, including icon identity and order', () => {
    const options = deriveModeSegmentedOptions(MODE_REGISTRY, 'practice');
    expect(options).toEqual([
      { value: 'time', label: 'Time', icon: Clock },
      { value: 'words', label: 'Words', icon: Hash },
      { value: 'quote', label: 'Quote', icon: Quote },
      { value: 'drill', label: 'Drill', icon: Keyboard },
      { value: 'custom', label: 'Custom', icon: PenLine },
      { value: 'zen', label: 'Zen', icon: Leaf },
    ]);
  });

  it('a new practice-category entry appears with zero changes to this function or its caller', () => {
    const registryWithExtra = [...MODE_REGISTRY, { id: 'stub', name: 'Stub', icon: 'Stub', category: 'practice' }];
    const options = deriveModeSegmentedOptions(registryWithExtra, 'practice');
    expect(options.map((o) => o.value)).toContain('stub');
  });
});
