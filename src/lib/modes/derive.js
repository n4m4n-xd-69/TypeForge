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
