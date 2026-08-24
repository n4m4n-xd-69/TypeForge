/**
 * Pure functions turning MODE_REGISTRY into the shapes AppShell, CommandPalette
 * and the mode/difficulty pickers actually render. See
 * docs/superpowers/plans/2026-08-24-mode-registry.md.
 */

export function deriveNavGroups(registry, extraItemsByGroup = {}) {
  const groupOrder = [...new Set(Object.keys(extraItemsByGroup))];
  for (const mode of registry) {
    if (mode.navSurface && !groupOrder.includes(mode.navGroup)) groupOrder.push(mode.navGroup);
  }

  return groupOrder.map((label) => {
    const extras = extraItemsByGroup[label] ?? [];
    // An extra's `end: true` marks it as the group's index route (e.g. Home
    // at '/'), so it leads. Any other extra (e.g. Progress, Rewards) trails
    // the registry-derived items instead, matching the pre-registry nav
    // literal exactly for both Train (Home-first) and Compete (Battle-first).
    const leadingExtras = extras.filter((item) => item.end);
    const trailingExtras = extras.filter((item) => !item.end);
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
