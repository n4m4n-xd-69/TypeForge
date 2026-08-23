import { useId } from 'react';
import { motion } from 'framer-motion';
import { cx } from '../../lib/format.js';

/**
 * Radio-group segmented control. The selected pill is a shared layout element,
 * so switching options slides rather than jumps.
 */
export default function Segmented({ options, value, onChange, size = 'md', className, label }) {
  const layoutId = useId();

  /**
   * Heights are set explicitly rather than left to padding.
   *
   * The small variant was rendering at 24px tall, and it is the mode switcher
   * on both Practice and Battle — the most-tapped control on either screen.
   * The coarse-pointer floor lifts every segment to 44px on touch without
   * changing the density on a desktop, the same rule Button uses.
   */
  const pad =
    size === 'sm'
      ? 'h-[28px] px-1.5 text-xs'
      : 'h-[34px] px-2 text-sm';

  return (
    <div
      role="radiogroup"
      aria-label={label}
      /**
       * Scrolls rather than clipping.
       *
       * As a bare inline-flex this overflowed its column at 375px: the six
       * practice modes ran past the edge and Custom and Zen were simply
       * unreachable on a phone. `max-w-full` plus an x-scroll keeps every
       * option in the control instead of pushing two of them out of the
       * product, and the segments stay `shrink-0` so they scroll at full size
       * rather than compressing into unreadable slivers.
       */
      className={cx(
        'flex max-w-full items-center gap-px overflow-x-auto rounded-sm bg-subtle p-px no-scrollbar',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            className={cx(
              'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] font-semibold',
              'transition-colors duration-fast',
              '[@media(pointer:coarse)]:min-h-[44px]',
              pad,
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[8px] bg-surface shadow-xs"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative flex items-center gap-0.5">
              {opt.icon ? <opt.icon size={13} strokeWidth={2.2} aria-hidden /> : null}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
