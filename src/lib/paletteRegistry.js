/**
 * Contextual commands for the ⌘K palette.
 *
 * The palette's own list is static and global — Home, the practice modes, the
 * languages — which is right for things that are always reachable. A surface
 * with its own vocabulary (the admin console's eight modules, its jump-to-user
 * action) needs to add to that list while it is open and take its entries away
 * again when it is not, or the palette starts offering an operator view to
 * everyone who presses ⌘K.
 *
 * A module-level store rather than context because the palette lives in
 * AppShell and the registering surface is several routes deep inside it;
 * threading a provider between them would mean every route re-rendering when
 * one of them registers a command.
 *
 * Registration returns its own removal function, so the caller's cleanup is
 * `useEffect(() => register(cmds), [cmds])` with nothing else to remember.
 */

let entries = [];
const listeners = new Set();

function emit() {
  for (const l of listeners) l(entries);
}

/**
 * @param {string} scope  Owner id. Registering the same scope twice replaces
 *                        the first set rather than duplicating it, which is
 *                        what makes this safe under React's double-invoked
 *                        effects in development.
 * @param {Array} commands  { id, label, icon, group, run, keywords? }
 * @returns {() => void} unregister
 */
export function registerCommands(scope, commands) {
  entries = [...entries.filter((e) => e.scope !== scope), ...commands.map((c) => ({ ...c, scope }))];
  emit();
  return () => {
    entries = entries.filter((e) => e.scope !== scope);
    emit();
  };
}

export function getCommands() {
  return entries;
}

export function subscribeCommands(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
