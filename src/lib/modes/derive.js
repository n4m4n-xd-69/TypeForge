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

const NAV_LABEL_OVERRIDES = {
  time: 'Start typing practice',
  code: 'Start code typing',
  // The `battle` entry's navRoute is /arena, so this label has to describe the
  // gate rather than Battlefield. A command that says "Open Battlefield" and
  // navigates to a chooser is a command that lies about itself. CommandPalette
  // carries separate direct entries for /battle and /shadow so both real
  // destinations stay one keystroke away.
  battle: 'Open the Arena — Battlefield or Shadow',
};

// The palette has always shown `zen` before `quote`, but the registry
// declares the `quote` entry (quickLaunch: true) ahead of the `zen` entry,
// so a plain filter reverses them. Pin the historical order explicitly;
// an entry not listed here (e.g. a newly added quickLaunch mode) trails
// in registry order, so it still appears with zero changes required here.
const QUICK_LAUNCH_ORDER = ['zen', 'quote'];

// Same shape as NAV_LABEL_OVERRIDES above: a lookup map keyed by mode id,
// falling back to a generic label when a mode isn't listed. `zen`'s
// quick-launch copy ("no timer, no stats") doesn't fit the generic
// "Practice with a <name>" pattern the other quick-launch entries use.
const QUICK_LAUNCH_LABEL_OVERRIDES = {
  zen: 'Zen mode — no timer, no stats',
};

export function deriveModePaletteEntries(registry) {
  const navigateEntries = registry
    .filter((m) => m.navSurface)
    .map((m) => ({
      id: m.id,
      label: NAV_LABEL_OVERRIDES[m.id] ?? m.navLabel ?? m.name,
      icon: m.navIcon ?? m.icon,
      group: 'Navigate',
      route: m.navRoute ?? m.route,
    }));

  const quickLaunchRank = (id) => {
    const i = QUICK_LAUNCH_ORDER.indexOf(id);
    return i === -1 ? Infinity : i;
  };
  const quickLaunchEntries = registry
    .filter((m) => m.quickLaunch)
    .map((m) => ({
      id: m.id,
      label: QUICK_LAUNCH_LABEL_OVERRIDES[m.id] ?? `Practice with a ${m.name.toLowerCase()}`,
      icon: m.quickLaunchIcon ?? m.icon,
      group: 'Practice',
      route: m.route,
    }))
    .sort((a, b) => quickLaunchRank(a.id) - quickLaunchRank(b.id));

  return [...navigateEntries, ...quickLaunchEntries];
}

// Unlike `navIcon` (nav rail) and `quickLaunchIcon` (command palette), the
// Practice mode switcher has always shown each mode's own identity icon
// directly — no third override field is needed here. Verified against the
// pre-registry MODES literal (980d633): `icon` matches for all six
// practice-category entries (time: Clock, words: Hash, quote: Quote,
// drill: Keyboard, custom: PenLine, zen: Leaf).
export function deriveModeSegmentedOptions(registry, category) {
  return registry
    .filter((m) => m.category === category)
    .map((m) => ({ value: m.id, label: m.name, icon: m.icon }));
}
