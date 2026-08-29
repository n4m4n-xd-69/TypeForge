/**
 * Which conversation the coach is in, and where it should be shown.
 *
 * The floating panel and the /chat page used to be two separate transcripts:
 * asking a question in the corner and then opening the full page dropped
 * everything you had just said. They now share one thread id, stored here, so
 * expanding the panel and minimising the page are camera moves on a single
 * conversation rather than two conversations that look alike.
 *
 * Deliberately not React state or context. Both surfaces mount independently —
 * the panel lives in the app shell, the page is a lazily loaded route — and a
 * provider spanning them would have to wrap the whole tree to carry two
 * strings. Storage is already the transport chatStore uses; this is the same
 * pattern, one level up.
 *
 * Every accessor is wrapped: Safari in private mode throws on the first
 * `localStorage` read, and a coach that cannot remember which thread it is on
 * should degrade to a fresh one, not take the page down with it.
 */

const ACTIVE = 'keystroke.chat.active';
/** Where /chat was opened from, so minimising can go back there. */
const ORIGIN = 'keystroke.chat.origin';
/** Set by /chat on the way out; consumed once by the panel on arrival. */
const REOPEN = 'keystroke.chat.reopen';

const read = (store, key) => {
  try {
    return window[store].getItem(key);
  } catch {
    return null;
  }
};

const write = (store, key, value) => {
  try {
    if (value == null) window[store].removeItem(key);
    else window[store].setItem(key, value);
  } catch {
    /* Storage unavailable — the surfaces just stop sharing, which is the old
       behaviour rather than a broken one. */
  }
};

/** The thread both surfaces are looking at, or null on a first run. */
export function readActiveId() {
  return read('localStorage', ACTIVE);
}

export function writeActiveId(id) {
  write('localStorage', ACTIVE, id);
}

/**
 * The route to return to when the page is minimised.
 *
 * Stored rather than using `navigate(-1)`, which lands somewhere unhelpful
 * whenever /chat was opened directly, reloaded, or reached through the command
 * palette from a page that has since been replaced in the history stack.
 */
export function writeOrigin(path) {
  if (path && !path.startsWith('/chat')) write('sessionStorage', ORIGIN, path);
}

export function readOrigin() {
  return read('sessionStorage', ORIGIN) ?? '/home';
}

/** Ask the floating panel to be open when the next route mounts. */
export function requestPanelOpen() {
  write('sessionStorage', REOPEN, '1');
}

/** One-shot: returns true at most once per request, then clears the flag. */
export function consumePanelOpen() {
  const flag = read('sessionStorage', REOPEN);
  if (flag) write('sessionStorage', REOPEN, null);
  return Boolean(flag);
}
