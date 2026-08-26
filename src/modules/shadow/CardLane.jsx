import { cx } from '../../lib/format.js';
import { LANE_PRESENTATION, MOVE_LABELS } from './avatars.js';

/**
 * The Stickman avatar's three lanes — Fight, Shield, Jump.
 *
 * The first character of a lane's word is what commits you to it, so that
 * character is the one thing this component must never make hard to read: it is
 * rendered as its own emphasised cell, separate from the rest of the word.
 *
 * Everything is driven by `arenaSession.view().deck`, which arrives already
 * flattened (`committed`, `dimmed`, `typed` per lane). No engine state is read
 * here and no progress is tracked locally — an earlier version pushed
 * per-keystroke updates through imperative refs into DOM nodes, which is what
 * made the whole surface impossible to reason about.
 */

const TONES = {
  brand: {
    rule: 'bg-brand-solid',
    chip: 'bg-brand-wash text-brand',
    ring: 'border-brand/50 ring-1 ring-brand/25',
    cursor: 'bg-brand-wash text-brand',
  },
  accent: {
    rule: 'bg-accent',
    chip: 'bg-accent-wash text-accent',
    ring: 'border-accent/50 ring-1 ring-accent/25',
    cursor: 'bg-accent-wash text-accent',
  },
  neutral: {
    rule: 'bg-line-strong',
    chip: 'bg-raised text-ink-2',
    ring: 'border-ink-3/50 ring-1 ring-ink-3/20',
    cursor: 'bg-raised text-ink',
  },
};

export function CardLane({ deck, shakeKey = 0, className }) {
  if (!deck) return null;

  return (
    <div
      // `key` on the shake wrapper restarts the animation on every whiff. Without
      // it a second whiff inside the animation window would not re-trigger.
      key={shakeKey}
      className={cx(
        'grid gap-1.5',
        shakeKey ? 'animate-shake' : null,
        deck.overdrive ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3',
        className,
      )}
    >
      {deck.lanes.map((lane) => (
        <Lane key={lane.id} lane={lane} overdrive={deck.overdrive} />
      ))}
    </div>
  );
}

function Lane({ lane, overdrive }) {
  const presentation = LANE_PRESENTATION[lane.id] ?? LANE_PRESENTATION.jump;
  const tone = TONES[overdrive ? 'brand' : presentation.tone];
  const typed = lane.typed ?? 0;

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-md border bg-surface p-1.5 shadow-e1',
        'transition-[opacity,border-color,box-shadow] duration-fast ease-out',
        lane.committed ? tone.ring : 'border-line',
        lane.dimmed ? 'opacity-35' : 'opacity-100',
      )}
    >
      <span className={cx('absolute inset-x-0 top-0 h-[2px]', tone.rule)} aria-hidden />

      <div className="flex items-center justify-between gap-1">
        <span className={cx('rounded-full px-1 py-px text-2xs font-bold uppercase tracking-[0.08em]', tone.chip)}>
          {overdrive ? 'Overdrive' : presentation.label}
        </span>
        <span className="truncate text-2xs font-semibold text-ink-3">
          {MOVE_LABELS[lane.moveId] ?? lane.moveId}
        </span>
      </div>

      <p className="mt-1 break-words font-mono text-lg font-bold leading-snug">
        {[...lane.word].map((char, i) => (
          <span
            // Index keys are correct here: this is a fixed-length character
            // sequence, not a reorderable list.
            key={`${lane.id}-${i}`}
            className={cx(
              i < typed && 'text-ink-3 line-through decoration-1',
              i === typed && lane.committed && cx('rounded-xs px-px', tone.cursor),
              i > typed && 'text-ink',
              // The commit character, while nothing is committed yet.
              i === 0 && !lane.committed && 'text-ink underline decoration-2 underline-offset-4',
            )}
          >
            {char === ' ' ? '\u00b7' : char}
          </span>
        ))}
      </p>

      {!overdrive ? (
        <p className="mt-px text-2xs text-ink-3">{presentation.hint}</p>
      ) : (
        <p className="mt-px text-2xs text-brand">Full burn — no other lane available.</p>
      )}
    </div>
  );
}
