import { describe, expect, it } from 'vitest';
import { Braces, Home, Keyboard, LineChart, Swords, Trophy, Zap } from 'lucide-react';
import { deriveModePaletteEntries, deriveNavGroups } from './derive.js';
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

  // Regression coverage beyond the brief's own test: the brief's Step 3
  // ordering rule ("extra items first, then registry items") reorders
  // Compete to [Progress, Rewards, Battle], which contradicts both this
  // file's first test and the pre-registry NAV_GROUPS literal (Battle
  // led). It also used `icon: m.icon` unconditionally, which would swap
  // the Typing tab's icon from Keyboard to Clock (registry.js's `time`
  // entry uses Clock for its own identity, matching the /practice mode
  // switcher). These tests pin the full old literal byte-for-byte,
  // including icon identity and item order, using the exact extras
  // AppShell.jsx passes.
  it('matches the pre-registry NAV_GROUPS literal exactly, including icon identity and order', () => {
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
          { to: '/battle', label: 'Battle', icon: Swords },
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

    expect(compete.items.map((i) => i.to)).toEqual(['/first', '/battle', '/last']);
  });
});

describe('deriveModePaletteEntries', () => {
  it('reproduces the current Navigate mode links and Practice quick-launch entries', () => {
    const entries = deriveModePaletteEntries(MODE_REGISTRY);

    const navigate = entries.filter((e) => e.group === 'Navigate');
    expect(navigate.map((e) => e.route)).toEqual(['/practice', '/code', '/battle']);
    expect(navigate.map((e) => e.label)).toEqual(['Start typing practice', 'Start code typing', 'Open Battlefield — multiplayer']);
    // The palette's "Typing" entry has always shown Keyboard, not the Time
    // mode's own identity icon (Clock) — same surface-vs-identity split as
    // the nav rail's `navIcon` from Task 5. Code/Battle icons already match
    // their mode's own icon, so this only bites for `time`.
    expect(navigate.map((e) => e.icon)).toEqual([Keyboard, Braces, Swords]);

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
