import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Console-wide operator state: the time window, the row density, the scope set
 * the database will enforce, and a refresh signal every view listens to.
 *
 * It is one context rather than four because all four change together in
 * practice — an operator narrows the range and expects every panel on screen
 * to follow — and because a view that reads the range must also re-run when it
 * changes. Splitting them would mean four subscriptions per view for state
 * that is written a handful of times per session.
 */

const ConsoleContext = createContext(null);

const DAY = 86_400_000;

/**
 * Presets, not a free-form picker by default.
 *
 * `days` is what the comparison window is derived from: `admin_kpis` compares
 * against the immediately preceding span of equal length, so "7d" always means
 * "these 7 days versus the 7 before them" with no ambiguity about what a delta
 * is measured against.
 */
export const RANGE_PRESETS = [
  { id: '24h', label: '24h', days: 1 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '12m', label: '12 months', days: 365 },
];

function rangeFromPreset(id) {
  const preset = RANGE_PRESETS.find((r) => r.id === id) ?? RANGE_PRESETS[2];
  const to = new Date();
  const from = new Date(to.getTime() - preset.days * DAY);
  return { id: preset.id, label: preset.label, days: preset.days, from, to };
}

/** Persisted so an operator's density and window survive a reload. */
function readStored(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode; the default is fine */
  }
}

export function ConsoleProvider({ scopes = [], tier = null, userId = null, children }) {
  const [rangeId, setRangeId] = useState(() => readStored('tf.console.range', '30d'));
  const [customRange, setCustomRange] = useState(null);
  const [density, setDensity] = useState(() => readStored('tf.console.density', 'comfortable'));
  const [live, setLive] = useState(() => readStored('tf.console.live', '1') === '1');
  const [nonce, setNonce] = useState(0);

  useEffect(() => writeStored('tf.console.range', rangeId), [rangeId]);
  useEffect(() => writeStored('tf.console.density', density), [density]);
  useEffect(() => writeStored('tf.console.live', live ? '1' : '0'), [live]);

  const range = useMemo(() => customRange ?? rangeFromPreset(rangeId), [rangeId, customRange]);

  const selectRange = useCallback((id) => {
    setCustomRange(null);
    setRangeId(id);
  }, []);

  const selectCustomRange = useCallback((from, to) => {
    const days = Math.max(1, Math.round((to - from) / DAY));
    setCustomRange({ id: 'custom', label: 'Custom', days, from, to });
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const can = useCallback((scope) => scopes.includes(scope), [scopes]);

  const value = useMemo(
    () => ({
      range,
      rangeId: range.id,
      selectRange,
      selectCustomRange,
      density,
      setDensity,
      live,
      setLive,
      nonce,
      refresh,
      scopes,
      can,
      tier,
      userId,
    }),
    [range, selectRange, selectCustomRange, density, live, nonce, refresh, scopes, can, tier, userId],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole() {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole must be used inside <ConsoleProvider>');
  return ctx;
}

/** Row padding per density. The one place the two modes differ dimensionally. */
export function useDensityClasses() {
  const { density } = useConsole();
  return density === 'compact'
    ? { cell: 'px-1 py-0.5', head: 'px-1 py-1', text: 'text-xs' }
    : { cell: 'px-1.5 py-1.5', head: 'px-1.5 py-1', text: 'text-sm' };
}

/**
 * The console's one data-fetching primitive.
 *
 * Every view has the same four states and the same two race hazards (a stale
 * response landing after a newer one; a response landing after unmount), so
 * they are solved once here rather than re-derived per view — the existing
 * admin tabs each hand-rolled a `cancelled` flag, which handles unmount but
 * not out-of-order arrival.
 *
 * `keepPrevious` is what makes a range change feel like a refresh rather than
 * a teardown: the old numbers stay on screen, dimmed by the caller, until the
 * new ones arrive.
 */
export function useConsoleQuery(fn, deps, { keepPrevious = true, enabled = true } = {}) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const seq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (!enabled) {
      setState({ status: 'ready', data: null, error: null });
      return;
    }
    const id = ++seq.current;
    setState((s) => ({
      status: 'loading',
      data: keepPrevious ? s.data : null,
      error: null,
    }));
    Promise.resolve()
      .then(fn)
      .then((data) => {
        if (id !== seq.current || !mounted.current) return;
        setState({ status: 'ready', data, error: null });
      })
      .catch((error) => {
        if (id !== seq.current || !mounted.current) return;
        setState({ status: 'error', data: null, error });
      });
    // `fn` is intentionally not a dependency: callers pass an inline closure,
    // so including it would re-run on every render. `deps` is the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(run, [run]);

  return { ...state, reload: run, isRefreshing: state.status === 'loading' && state.data != null };
}

/**
 * Poll while the tab is visible and the operator has live mode on.
 *
 * Backgrounded tabs stop polling entirely. An admin console left open on a
 * second monitor overnight should not spend the night issuing queries, and
 * `visibilitychange` is the difference between a console and a load generator.
 */
export function usePolling(callback, intervalMs = 15_000) {
  const { live, nonce } = useConsole();
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!live || !intervalMs) return undefined;
    let timer = null;
    const tick = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    const start = () => {
      stop();
      timer = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [live, intervalMs, nonce]);
}
