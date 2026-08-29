import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, KeyRound, Pause, Play, Swords, Type } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { useReducedMotionSafe } from '../../../lib/motion.js';
import { useConsole } from './ConsoleContext.jsx';

/**
 * The platform pulse.
 *
 * A seismograph, not a notification list: one continuous spine with a tick per
 * event, newest at the top, four interleaved streams distinguishable at a
 * glance. It is the console's one deliberately atmospheric element, and it
 * earns the motion because the motion *is* the information — an operator
 * watching this should be able to tell a busy platform from a quiet one
 * without reading a single row.
 *
 * The stream colour is a data encoding, so it is paired with a glyph and a
 * word. `good` and `bad` collapse under deuteranopia (the note in
 * Primitives.jsx), and a colour-only feed would be unreadable to the operators
 * most likely to be staring at it at 3am.
 *
 * Motion is suppressed entirely under `prefers-reduced-motion`; the feed still
 * updates, it just does not slide.
 */

const STREAMS = {
  session: { icon: Type, label: 'Session', dot: 'bg-accent', text: 'text-accent' },
  auth: { icon: KeyRound, label: 'Auth', dot: 'bg-ink-3', text: 'text-ink-2' },
  ai: { icon: Bot, label: 'AI', dot: 'bg-brand-solid', text: 'text-brand' },
  match: { icon: Swords, label: 'Match', dot: 'bg-warn', text: 'text-warn' },
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'session', label: 'Sessions' },
  { id: 'ai', label: 'AI' },
  { id: 'match', label: 'Matches' },
  { id: 'auth', label: 'Auth' },
];

function clockTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function LiveRail({ events = [], loading = false, onSelectUser, className }) {
  const { live, setLive } = useConsole();
  const reduce = useReducedMotionSafe();
  const [filter, setFilter] = useState('all');
  const seen = useRef(null);

  /* Keys are derived from the event's own content, never from its position.
     A feed is prepended to, so an index-based key would shift under every
     arrival and make the entire list look new — animating all sixty rows for
     one incoming event. Identical content within a batch (the same user
     finishing two identical sessions in the same second) is disambiguated
     with a counter rather than an index, so a given row keeps its key however
     far down the list it slides. */
  const rows = useMemo(() => {
    const list = filter === 'all' ? events : events.filter((e) => e.stream === filter);
    const counts = new Map();
    return list.slice(0, 60).map((e) => {
      const base = `${e.stream}|${e.at}|${e.actor_id ?? 'anon'}|${e.summary}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return { ...e, key: n === 1 ? base : `${base}#${n}` };
    });
  }, [events, filter]);

  /* Only rows that were not on screen at the last commit animate in.
     Without this the whole feed replays its entrance on every poll, which
     reads as the platform suddenly doing sixty things at once.

     Recorded in an effect rather than during render: `isNew` is called once
     per row while rendering, and a ref mutated there would give a different
     answer on a re-render React decided to throw away — which is exactly what
     StrictMode does in development. `null` on the first pass means nothing
     animates on mount, which is the intended behaviour anyway. */
  useEffect(() => {
    seen.current = new Set(rows.map((r) => r.key));
  }, [rows]);

  const isNew = (key) => seen.current != null && !seen.current.has(key);

  return (
    <div className={cx('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <span className="relative flex h-1 w-1 shrink-0" aria-hidden>
          <span
            className={cx(
              'absolute inline-flex h-full w-full rounded-full',
              live ? 'bg-good' : 'bg-ink-3',
              live && !reduce && 'animate-ping opacity-60',
            )}
          />
          <span className={cx('relative inline-flex h-1 w-1 rounded-full', live ? 'bg-good' : 'bg-ink-3')} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            admin_activity_feed · {live ? '10s' : 'paused'}
          </p>
          <h2 className="text-base font-bold tracking-[-0.01em]">Platform pulse</h2>
        </div>
        <button
          onClick={() => setLive(!live)}
          aria-pressed={live}
          className="grid h-[26px] w-[26px] place-items-center rounded-xs border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
          title={live ? 'Pause the live feed' : 'Resume the live feed'}
        >
          {live ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
          <span className="sr-only">{live ? 'Pause live feed' : 'Resume live feed'}</span>
        </button>
      </div>

      <div className="flex shrink-0 gap-px overflow-x-auto border-b border-line px-1 py-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cx(
              'shrink-0 rounded-xs px-1 py-px text-2xs font-bold uppercase tracking-[0.08em] transition-colors',
              filter === f.id ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ol
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Live platform activity"
      >
        {/* The spine. Everything hangs off it. */}
        <span
          className="pointer-events-none absolute bottom-1 left-[22px] top-1 w-px bg-gradient-to-b from-line via-line to-transparent"
          aria-hidden
        />

        {loading && rows.length === 0 ? (
          <li className="py-3 text-center text-sm text-ink-3">Listening…</li>
        ) : rows.length === 0 ? (
          <li className="py-3 text-center text-sm text-ink-3">
            Nothing on this stream yet. Activity appears here as it happens.
          </li>
        ) : null}

        <AnimatePresence initial={false}>
          {rows.map((e) => {
            const s = STREAMS[e.stream] ?? STREAMS.auth;
            const Icon = s.icon;
            const fresh = isNew(e.key);
            return (
              <motion.li
                key={e.key}
                layout={!reduce}
                initial={fresh && !reduce ? { opacity: 0, y: -8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
                className="relative flex gap-1.5 py-1 pl-3.5"
              >
                <span
                  className={cx(
                    'absolute left-[18px] top-[13px] h-[7px] w-[7px] rounded-full ring-2 ring-[rgb(var(--surface))]',
                    s.dot,
                    e.tone === 'bad' && 'bg-bad',
                    e.tone === 'good' && 'bg-good',
                  )}
                  aria-hidden
                />
                <span className="w-[52px] shrink-0 pt-px font-mono text-[10px] leading-4 text-ink-3 tnum">
                  {clockTime(e.at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-0.5">
                    <Icon size={11} className={cx('shrink-0', s.text)} aria-hidden />
                    {onSelectUser && e.actor_id ? (
                      <button
                        onClick={() => onSelectUser(e.actor_id)}
                        className="truncate text-xs font-semibold underline-offset-2 hover:underline"
                      >
                        {e.actor}
                      </button>
                    ) : (
                      <span className="truncate text-xs font-semibold">{e.actor}</span>
                    )}
                    <span className="sr-only">{s.label}:</span>
                  </span>
                  <span
                    className={cx(
                      'mt-px block truncate font-mono text-[11px] leading-4',
                      e.tone === 'bad' ? 'text-bad' : 'text-ink-3',
                    )}
                    title={e.summary}
                  >
                    {e.summary}
                  </span>
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}
