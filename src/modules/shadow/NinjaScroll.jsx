import { useMemo } from 'react';
import { cx } from '../../lib/format.js';
import { MOVE_LABELS } from './avatars.js';

/**
 * The Shadow Ninja's scroll.
 *
 * A running paragraph rather than lanes: no choice to make, only footing to
 * keep. Three visual jobs, in priority order —
 *
 *   1. the cursor character must be unmistakable, because a wrong keystroke
 *      costs HP outright in this mode;
 *   2. already-typed text must recede without vanishing, so you can see the
 *      ground you have covered;
 *   3. upcoming text must fade toward the edge, so the eye is pulled forward
 *      rather than to the end of the paragraph.
 *
 * Only a window around the cursor is rendered. The scroll is ~300 characters
 * and each one is its own `<span>`, so painting the whole thing on every
 * keystroke would put ~300 DOM nodes on the typing hot path for no benefit —
 * nothing far from the cursor is legible anyway.
 */

/** Characters of context kept behind and ahead of the cursor. */
const TRAIL = 90;
const LEAD = 150;

export function NinjaScroll({
  text = '',
  cursor = 0,
  beats = [],
  beatIndex = 0,
  shakeKey = 0,
  className,
}) {
  const from = Math.max(0, cursor - TRAIL);
  const to = Math.min(text.length, cursor + LEAD);

  const slice = useMemo(() => [...text.slice(from, to)], [text, from, to]);
  const beat = beats[beatIndex] ?? null;
  const progress = text.length > 0 ? cursor / text.length : 0;

  return (
    <div
      key={shakeKey}
      className={cx(
        'rounded-md border border-line bg-surface/90 p-2 shadow-e2 backdrop-blur-[2px]',
        shakeKey ? 'animate-shake' : null,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="rounded-full bg-accent-wash px-1 py-px text-2xs font-bold uppercase tracking-[0.08em] text-accent">
          Scroll
        </span>
        {beat ? (
          <span className="truncate text-2xs font-semibold text-ink-3">
            Next strike · {MOVE_LABELS[beat.moveId] ?? beat.moveId}
          </span>
        ) : null}
      </div>

      {/* The text. `break-words` rather than `truncate`: a clipped scroll would
          hide the very characters the player is about to need. */}
      <p className="mt-1.5 break-words font-mono text-base leading-relaxed">
        {from > 0 ? <span className="text-ink-3/40" aria-hidden>…</span> : null}

        {slice.map((char, i) => {
          const abs = from + i;
          const isCursor = abs === cursor;
          const isTyped = abs < cursor;
          // Fade the last third of the lead window so the paragraph dissolves
          // forward instead of ending in a hard edge.
          const leadDepth = abs - cursor;
          const fading = leadDepth > LEAD * 0.6;

          return (
            <span
              key={abs}
              className={cx(
                isTyped && 'text-ink-3/70',
                isCursor && 'rounded-xs bg-accent px-px text-accent-ink',
                !isTyped && !isCursor && (fading ? 'text-ink-3/45' : 'text-ink'),
              )}
            >
              {char === ' ' && isCursor ? '\u2423' : char}
            </span>
          );
        })}

        {to < text.length ? <span className="text-ink-3/30" aria-hidden>…</span> : null}
      </p>

      {/* Scroll progress. A plain track — this is orientation, not a score. */}
      <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-line" aria-hidden>
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-fast ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <p className="sr-only" aria-live="polite">
        {`Character ${cursor} of ${text.length}.`}
      </p>
    </div>
  );
}
