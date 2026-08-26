import { cx } from '../../lib/format.js';

/**
 * Layout and feedback primitives.
 *
 * This file used to import framer-motion so that ProgressBar and ProgressRing
 * could tween. Twenty-two of the app's fifty-seven components import from
 * here, so that one import put a 38 kB gzip dependency on almost every route
 * — including the public landing page — to animate a width and a stroke
 * offset. Both are now CSS transitions, which produce the same result, are
 * interruptible, and cost nothing.
 */

/* ── Surfaces ──────────────────────────────────────────────────────────── */

export function Card({ as: Tag = 'div', interactive = false, className, children, ...props }) {
  return (
    <Tag className={cx(interactive ? 'card-interactive' : 'card', className)} {...props}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ title, hint, action, className }) {
  return (
    <div className={cx('flex items-center justify-between gap-2', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {hint ? <p className="mt-px text-xs text-ink-3">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ── Small bits ────────────────────────────────────────────────────────── */

/**
 * Status chip.
 *
 * Every tone reads its colour from a token that has been measured against
 * both themes, so the previous hardcoded `text-[#8a6100]` override on `warn`
 * — which existed because the token itself failed contrast in light mode —
 * is gone.
 *
 * A chip is never the only signal. Where one marks a state that matters
 * (a flagged result, a failed sync) the caller pairs it with a word, because
 * `good` and `bad` collapse to 1.49:1 separation under deuteranopia.
 */
export function Chip({ tone = 'neutral', className, children, ...props }) {
  const tones = {
    neutral: 'bg-raised text-ink-2',
    brand: 'bg-brand-wash text-brand',
    accent: 'bg-accent-wash text-accent',
    good: 'bg-good/12 text-good',
    warn: 'bg-warn/12 text-warn',
    bad: 'bg-bad/12 text-bad',
    outline: 'border border-line text-ink-2',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 rounded-full px-1 py-px text-2xs font-medium uppercase',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Loading placeholder with a single travelling highlight. */
export function Skeleton({ className, rounded = 'rounded-sm' }) {
  return (
    <div className={cx('relative overflow-hidden bg-raised', rounded, className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-ink/[0.06] to-transparent" />
    </div>
  );
}

/**
 * Empty state.
 *
 * Three things, always: what will fill this, how to make that happen, and a
 * control that does it. An empty state without the third is a dead end.
 */
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-3 py-6 text-center', className)}>
      {Icon ? (
        <div className="mb-2 grid h-6 w-6 place-items-center rounded-md bg-raised text-ink-3">
          <Icon size={22} strokeWidth={1.8} aria-hidden />
        </div>
      ) : null}
      <p className="text-base font-semibold">{title}</p>
      {description ? <p className="mt-0.5 max-w-[340px] text-sm text-ink-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ── Progress ──────────────────────────────────────────────────────────── */

/**
 * Linear progress.
 *
 * 6px rather than the 4px this used to be: at 4px the filled track sat below
 * the 3:1 non-text contrast threshold against its own background, which made
 * a bar that was technically present and practically invisible.
 *
 * Animated with a scale transform rather than a width so the browser
 * composites it instead of laying out every frame.
 */
export function ProgressBar({ value, tone = 'brand', className, label }) {
  const clamped = Math.max(0, Math.min(1, value || 0));
  const fill = {
    brand: 'bg-brand-solid',
    accent: 'bg-accent',
    ink: 'bg-ink',
    good: 'bg-good',
    warn: 'bg-warn',
  }[tone];

  return (
    <div
      className={cx('h-[6px] w-full overflow-hidden rounded-full bg-line', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cx('h-full origin-left rounded-full transition-transform duration-slow ease-out', fill)}
        style={{ transform: `scaleX(${clamped})` }}
      />
    </div>
  );
}

/**
 * Concentric ring.
 *
 * `strokeDashoffset` is a presentation attribute CSS can transition, so this
 * needs no animation library — the value changes and the browser tweens it.
 */
export function ProgressRing({
  value,
  size = 112,
  stroke = 8,
  children,
  tone = 'brand',
  trackClass = 'stroke-line',
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value || 0));
  const strokeClass = {
    brand: 'stroke-brand-solid',
    accent: 'stroke-accent',
    ink: 'stroke-ink',
    good: 'stroke-good',
  }[tone];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={trackClass} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cx(strokeClass, 'transition-[stroke-dashoffset] duration-slow ease-out')}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
