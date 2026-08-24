import { describe, expect, it } from 'vitest';
import { Braces, Home, Keyboard, LineChart, Swords, Trophy } from 'lucide-react';
import { deriveNavGroups } from './derive.js';
import { MODE_REGISTRY } from './registry.js';

describe('deriveNavGroups', () => {
  it('reproduces the current Train/Compete nav exactly, given the current extras', () => {
    const extras = {
      Train: [{ to: '/', label: 'Home', icon: 'Home', end: true }],
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
      Train: [{ to: '/', label: 'Home', icon: Home, end: true }],
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
          { to: '/', label: 'Home', icon: Home, end: true },
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
});
