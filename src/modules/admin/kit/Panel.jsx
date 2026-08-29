import { AlertTriangle, Loader2, Lock } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { EmptyState, Skeleton } from '../../../components/ui/Primitives.jsx';

/**
 * A titled region of the console.
 *
 * The `source` prop is the console's one piece of consistent chrome, and it is
 * not decoration: it names the table or function the panel's numbers came from
 * and how they refresh (`admin_daily · live`, `forge_model_health · 30s`). An
 * operator about to suspend an account or disable a model is entitled to know
 * whether they are looking at a live reading or a five-minute-old cache, and
 * the alternative convention — a numbered eyebrow — would encode a sequence
 * that does not exist here.
 */
export function Panel({ title, hint, source, action, children, className, bodyClassName, refreshing = false }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-1 border-b border-line px-2 py-1.5">
          <div className="min-w-0">
            {source ? (
              <p className="mb-px flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                {source}
                {refreshing ? <Loader2 size={10} className="animate-spin" aria-label="Refreshing" /> : null}
              </p>
            ) : null}
            <h2 className="truncate text-base font-bold tracking-[-0.01em]">{title}</h2>
            {hint ? <p className="mt-px text-xs text-ink-3">{hint}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
        </header>
      )}
      <div className={cx('p-2', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * The four states, in one place.
 *
 * Wraps the real content rather than standing beside it:
 *
 *   <StateBlock status={q.status} error={q.error} empty={!rows.length} onRetry={q.reload}>
 *     <RealContent rows={rows} />
 *   </StateBlock>
 *
 * When none of loading/error/empty applies, it renders its children unchanged.
 * The obvious alternative — returning `null` so a caller can write
 * `<StateBlock … /> ?? <RealContent />` — silently never falls through, because
 * a JSX element is an object and therefore always truthy. Taking children
 * makes the correct usage the only usage.
 *
 * Every message says what is wrong and what to do about it; an error that only
 * apologises is not an error message.
 */
export function StateBlock({
  status,
  error,
  empty = false,
  children = null,
  emptyTitle = 'Nothing to show yet',
  emptyDescription = 'Data will appear here as the platform is used.',
  emptyIcon,
  emptyAction,
  onRetry,
  rows = 4,
}) {
  if (status === 'loading') {
    return (
      <div className="space-y-1" aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-2.5 w-full" />
        ))}
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (status === 'error') {
    const denied = error?.code === '42501';
    return (
      <EmptyState
        icon={denied ? Lock : AlertTriangle}
        title={denied ? 'Not available at your tier' : 'This could not load'}
        description={
          denied
            ? 'Your admin tier does not include the scope this panel reads. Ask an owner to widen it.'
            : error?.message || 'The query failed. It may be a transient network problem.'
        }
        action={
          !denied && onRetry ? (
            <button
              onClick={onRetry}
              className="h-[32px] rounded-sm border border-line px-1.5 text-sm font-semibold transition-colors hover:border-line-strong"
            >
              Try again
            </button>
          ) : null
        }
      />
    );
  }

  if (empty) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return children;
}

/** Page header shared by every view, so the eight modules read as one product. */
export function ViewHeader({ title, description, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-1.5">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-px max-w-[62ch] text-sm text-ink-3">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-1">{children}</div> : null}
    </header>
  );
}

/**
 * Shown in place of a control an operator's tier does not carry.
 *
 * A hidden control is confusing — an operator cannot tell whether the feature
 * is missing or they are — so the affordance stays visible and explains
 * itself. The database enforces the same scope regardless of what renders.
 */
export function ScopeGate({ can, scope, children, inline = false }) {
  if (can) return children;
  return (
    <span
      title={`Requires the ${scope} scope`}
      className={cx(
        'inline-flex items-center gap-0.5 rounded-xs border border-dashed border-line px-1 py-0.5 text-2xs font-semibold text-ink-3',
        inline ? '' : 'w-full justify-center py-1',
      )}
    >
      <Lock size={11} aria-hidden />
      {scope}
    </span>
  );
}
