import { cx } from '../../lib/format.js';

/**
 * Focus meter with the Mend threshold notch and the Overdrive state (PRD §11).
 *
 * Two thresholds matter and both are marked: 25 Focus unlocks Mend (the notch),
 * 100 unlocks Overdrive (the chip and the ring). Focus is already a 0–100 value
 * in the engine, so unlike HP there is no unit conversion here.
 *
 * Moved onto the app type scale — this used raw `text-[11px]` and `text-[10px]`
 * and a `w-0.5` notch that is 4px on this config's closed scale.
 */
export function FocusBar({ focus = 0, maxFocus = 100, isOpponent = false }) {
  const pct = Math.max(0, Math.min(100, (focus / maxFocus) * 100));
  const overdriveReady = focus >= 100;
  const mendReady = focus >= 25;

  return (
    <div className="flex w-full flex-col gap-0.5">
      <div className={cx('flex w-full items-center gap-1', isOpponent && 'flex-row-reverse')}>
        <span className="eyebrow text-warn">Focus</span>
        {overdriveReady ? (
          <span className="animate-pulse rounded-full bg-warn/15 px-1 py-px text-2xs font-bold uppercase tracking-[0.08em] text-warn">
            Overdrive
          </span>
        ) : null}
        <span className={cx('font-mono text-2xs font-bold text-ink-3 tnum', isOpponent ? 'mr-auto' : 'ml-auto')}>
          {Math.round(focus)}
        </span>
      </div>

      <div
        className={cx(
          'relative h-1 w-full overflow-hidden rounded-full border bg-raised',
          'transition-colors duration-base ease-out',
          overdriveReady ? 'border-warn' : 'border-transparent',
        )}
        role="progressbar"
        aria-valuenow={Math.round(focus)}
        aria-valuemin={0}
        aria-valuemax={maxFocus}
        aria-label="Focus"
      >
        <span
          aria-hidden
          className={cx(
            'absolute inset-y-0 transition-[width] duration-fast ease-out',
            isOpponent ? 'right-0' : 'left-0',
            overdriveReady ? 'bg-warn' : mendReady ? 'bg-warn/85' : 'bg-warn/60',
          )}
          style={{ width: `${pct}%` }}
        />
        {/* Mend threshold at 25 Focus. Mirrored for the opponent's right-anchored bar. */}
        <span
          aria-hidden
          title="25 Focus — Mend available"
          className="absolute inset-y-0 w-px bg-ink/40"
          style={{ [isOpponent ? 'right' : 'left']: '25%' }}
        />
      </div>
    </div>
  );
}
