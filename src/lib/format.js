/**
 * Class-name joiner.
 *
 * This was `export const cx = clsx` — a dependency, a build edge and an
 * indirection for one aliasing line. Every call site in this codebase passes
 * strings and conditionals, never the objects or nested arrays clsx also
 * handles, so the full implementation was never reached.
 */
export function cx(...parts) {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const value = typeof part === 'string' ? part : Array.isArray(part) ? cx(...part) : '';
    if (value) out += out ? ` ${value}` : value;
  }
  return out;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function pct(value, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

/** 95 → "1:35". Used for the countdown and for total practice time. */
export function mmss(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function humanDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function longDate(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Stable pseudo-random in [0,1) from a string — used for demo leaderboards. */
export function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
