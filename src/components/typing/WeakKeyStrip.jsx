import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { cx } from '../../lib/format.js';

/**
 * The keys costing you most, directly under the keyboard.
 *
 * This lived only on the dashboard, which is the wrong place for it: by the
 * time you open a chart you are no longer typing. Sitting under the visualiser
 * it is in view during the run that will change it, and it points at the same
 * keys the visualiser is highlighting.
 *
 * Requires a real sample before it says anything — `weakestKeys` needs at least
 * eight attempts on a key — because "your worst key is z" after one typo is
 * noise dressed as insight.
 */
export default function WeakKeyStrip({ keyStats, className, limit = 6 }) {
  const weak = weakestKeys(keyStats, limit);
  if (!weak.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cx(
        'mx-auto flex max-w-[560px] flex-wrap items-center justify-center gap-1 rounded-md',
        // A wash rather than a solid fill: this is a hint beside a keyboard,
        // not an error state, and a saturated red band under the stage reads
        // as something having gone wrong.
        'border border-bad/30 bg-bad/[0.06] px-1.5 py-1',
        className,
      )}
    >
      <span className="flex items-center gap-0.5 text-2xs font-bold uppercase tracking-[0.07em] text-bad/90">
        <AlertTriangle size={11} strokeWidth={2.6} aria-hidden />
        You miss these most
      </span>

      {weak.map((k) => {
        const pct = Math.round(k.rate * 100);
        return (
          <span
            key={k.key}
            title={`${k.wrong} wrong out of ${k.total}`}
            className="flex items-center gap-0.5 rounded-sm border border-bad/40 bg-surface px-1 py-px"
          >
            <kbd className="font-mono text-xs font-bold text-ink">{keyLabel(k.key)}</kbd>
            <span className="font-mono text-2xs tnum text-bad">{pct}%</span>
          </span>
        );
      })}
    </motion.div>
  );
}
