import { Check, Target } from 'lucide-react';
import { motion } from 'framer-motion';
import { cx } from '../../lib/format.js';

/**
 * Today's three missions. `compact` renders the inline header pill; the full
 * form is the card used on Home.
 */
export default function MissionStrip({ missions, compact = false, className }) {
  const done = missions.filter((m) => m.done).length;

  if (compact) {
    return (
      <div className={cx('flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-1', className)}>
        <Target size={14} className="text-brand" aria-hidden />
        <span className="text-xs font-bold">
          {done}/{missions.length} daily missions
        </span>
        <div className="flex gap-px" aria-hidden>
          {missions.map((m) => (
            <span
              key={m.id}
              className={cx('h-0.5 w-1.5 rounded-full', m.done ? 'bg-brand-solid' : 'bg-line-strong')}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <ul className={cx('space-y-1', className)}>
      {missions.map((m, i) => (
        <motion.li
          key={m.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className={cx(
            'flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 transition-colors',
            m.done ? 'border-brand/40 bg-brand-wash/60' : 'border-line',
          )}
        >
          <span
            className={cx(
              'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full transition-colors',
              m.done ? 'bg-brand-solid text-brand-ink' : 'bg-subtle text-ink-3',
            )}
            aria-hidden
          >
            {m.done ? <Check size={14} strokeWidth={3} /> : <Target size={13} strokeWidth={2.4} />}
          </span>

          <div className="min-w-0 flex-1">
            <p className={cx('truncate text-sm font-bold', m.done && 'text-brand')}>{m.label}</p>
            <div className="mt-0.5 h-[4px] overflow-hidden rounded-full bg-subtle">
              <motion.div
                className={cx('h-full rounded-full', m.done ? 'bg-brand-solid' : 'bg-ink-3/50')}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (m.value / m.goal) * 100)}%` }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>

          <span className="shrink-0 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">+{m.xp} XP</span>
        </motion.li>
      ))}
    </ul>
  );
}
