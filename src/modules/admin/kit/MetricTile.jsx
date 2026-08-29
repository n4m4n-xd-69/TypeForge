import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { Sparkline } from '../../../components/charts/Charts.jsx';
import { Skeleton } from '../../../components/ui/Primitives.jsx';

/**
 * The console's unit of measurement.
 *
 * Four decisions worth stating:
 *
 * 1. **A tile is a button when it leads somewhere, and a `div` when it does
 *    not.** The brief asks for every major metric to drill down; a tile that
 *    only *looks* clickable is worse than one that plainly is not, so the
 *    element itself changes rather than a cursor style.
 *
 * 2. **The number is mono and tabular.** Every numeral in this product already
 *    is (`tnum`, JetBrains Mono) — an operator scanning a rack of tiles reads
 *    down the column, and proportional digits make that column ragged.
 *
 * 3. **A delta needs its comparison window named or it is not information.**
 *    `deltaLabel` is required whenever `delta` is passed; "+12%" with nothing
 *    to compare against is decoration.
 *
 * 4. **`null` is rendered, not coerced.** A metric with no configured source
 *    reads "not instrumented", never "0" — the same contract the AI module
 *    holds for unrated models. Revenue is the live example.
 */

function formatValue(value, { prefix = '', suffix = '', decimals = 0, compact = false }) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const body = compact && Math.abs(n) >= 10_000
    ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
    : n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${prefix}${body}${suffix}`;
}

export default function MetricTile({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel,
  /** Higher is worse for this metric — failure counts, latency, error rates. */
  invert = false,
  hint,
  source,
  spark,
  loading = false,
  unavailable,
  onClick,
  active = false,
  prefix = '',
  suffix = '',
  decimals = 0,
  compact = true,
  className,
}) {
  const shown = formatValue(value, { prefix, suffix, decimals, compact });
  const Tag = onClick ? 'button' : 'div';

  const dir = delta == null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const good = dir === 'flat' ? null : invert ? dir === 'down' : dir === 'up';
  const DeltaIcon = dir === 'flat' ? ArrowRight : dir === 'up' ? ArrowUpRight : ArrowDownRight;

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cx(
        'group relative flex w-full flex-col gap-1 rounded-md border bg-surface p-1.5 text-left',
        'transition-[border-color,background-color,transform] duration-fast ease-out',
        active ? 'border-brand/60 bg-brand-wash/40' : 'border-line',
        onClick &&
          'cursor-pointer hover:border-line-strong hover:bg-raised/60 focus-visible:outline-none focus-visible:shadow-focus active:translate-y-px',
        className,
      )}
    >
      <span className="flex items-center gap-0.5">
        {Icon ? <Icon size={13} strokeWidth={2.2} className="shrink-0 text-ink-3" aria-hidden /> : null}
        <span className="truncate text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</span>
      </span>

      <span className="flex items-end justify-between gap-1">
        {loading && shown == null ? (
          <Skeleton className="h-3 w-8" />
        ) : unavailable || shown == null ? (
          /* Not a zero. See the file header. */
          <span className="font-mono text-lg font-medium leading-none text-ink-3">
            {unavailable || 'not instrumented'}
          </span>
        ) : (
          <span className="font-mono text-3xl font-medium leading-none tnum text-ink">{shown}</span>
        )}

        {spark?.length > 1 ? (
          <span className="mb-px shrink-0 opacity-70 transition-opacity duration-fast group-hover:opacity-100">
            <Sparkline values={spark} width={64} height={22} />
          </span>
        ) : null}
      </span>

      {delta != null && deltaLabel ? (
        <span
          className={cx(
            'flex items-center gap-px text-xs font-semibold tnum',
            good == null ? 'text-ink-3' : good ? 'text-good' : 'text-bad',
          )}
        >
          <DeltaIcon size={12} strokeWidth={2.6} aria-hidden />
          {delta > 0 ? '+' : ''}
          {Math.abs(delta) >= 1000 ? Math.round(delta).toLocaleString() : delta.toFixed(1)}
          {typeof delta === 'number' && deltaLabel.includes('%') ? '%' : ''}
          <span className="ml-0.5 font-normal text-ink-3">{deltaLabel}</span>
        </span>
      ) : hint ? (
        <span className="text-xs text-ink-3">{hint}</span>
      ) : null}

      {/* Provenance. An operator acting on a number is entitled to know which
          table it came from and how fresh it is — see the console's eyebrow
          convention. */}
      {source ? (
        <span className="mt-px font-mono text-[10px] leading-none text-ink-3/70">{source}</span>
      ) : null}
    </Tag>
  );
}

/** A rack of tiles. Fixed column counts so tiles line up across panels. */
export function MetricRack({ children, cols = 4, className }) {
  const grid = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-4',
    5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
    6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }[cols];
  return <div className={cx('grid gap-1', grid, className)}>{children}</div>;
}
