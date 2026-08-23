import DecayCounter from '../ui/DecayCounter.jsx';
import { cx, mmss } from '../../lib/format.js';

/**
 * The live readout.
 *
 * WPM is the number people actually watch, so it gets roughly double the type
 * size of its neighbours. Labels sit on --ink-2 rather than --ink-3: at the
 * 10px uppercase size they were technically legible and practically not.
 *
 * Two layouts from one source of truth. `compact` is a single horizontal row
 * sized to sit in a page header; the default is the full bordered grid that
 * sits under a stage. They exist together so the two typing surfaces can never
 * drift apart on which figures they show or how they round them.
 */
export default function LiveStats({ live, limitSeconds, wordTarget, className, compact = false }) {
  const cells = [
    // Raw, not rounded: DecayCounter does its own rounding and needs the
    // continuous value to ease against.
    { label: 'Words / min', short: 'WPM', value: live.wpm, accent: true, lead: true, decay: true },
    { label: 'Accuracy', short: 'ACC', value: `${Math.round(live.accuracy)}%` },
    { label: 'Errors', short: 'ERR', value: live.errors, tone: live.errors > 0 ? 'bad' : undefined },
    limitSeconds
      ? { label: 'Time left', short: 'LEFT', value: mmss(live.remaining ?? limitSeconds) }
      : wordTarget
        ? { label: 'Progress', short: 'PROG', value: `${Math.round(live.progress * 100)}%` }
        : { label: 'Elapsed', short: 'TIME', value: mmss(live.elapsedSec) },
  ];

  const render = (c) => (c.decay ? <DecayCounter value={c.value} /> : c.value);

  if (compact) {
    return (
      <dl className={cx('flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-1', className)}>
        {cells.map((c) => (
          <div key={c.label} className="flex items-baseline gap-0.5">
            <dd
              className={cx(
                'font-mono font-medium tnum leading-none',
                c.lead ? 'text-2xl' : 'text-lg',
                c.accent && 'text-brand',
                c.tone === 'bad' && 'text-bad',
                !c.accent && !c.tone && 'text-ink',
              )}
            >
              {render(c)}
            </dd>
            <dt className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{c.short}</dt>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className={cx('grid grid-cols-2 sm:grid-cols-4', className)}>
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cx(
            'flex flex-col justify-center px-2.5 py-2 border-line',
            i < cells.length - 1 && 'sm:border-r',
            i < 2 && 'border-b sm:border-b-0',
            i === 0 && 'border-r',
          )}
        >
          <dd
            className={cx(
              'font-mono font-medium tnum leading-none',
              c.lead ? 'text-4xl' : 'text-2xl',
              c.accent && 'text-brand',
              c.tone === 'bad' && 'text-bad',
              !c.accent && !c.tone && 'text-ink',
            )}
          >
            {render(c)}
          </dd>
          <dt
            className={cx(
              'font-bold uppercase tracking-[0.09em] text-ink-2',
              c.lead ? 'mt-1 text-xs' : 'mt-0.5 text-2xs',
            )}
          >
            {c.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}
