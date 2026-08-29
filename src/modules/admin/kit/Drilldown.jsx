import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { IconButton } from '../../../components/ui/Button.jsx';
import { useReducedMotionSafe } from '../../../lib/motion.js';

/**
 * Side sheet for drilling into one record.
 *
 * A sheet rather than the app's centred `Modal` because the console's whole
 * interaction model is "open a row, keep the list". A centred dialog covers
 * the table it came from; a sheet leaves the row visible, which is what lets an
 * operator work down a filtered list without losing their place.
 *
 * Focus containment, Escape, scroll lock and focus restore are the same
 * contract Modal.jsx established — this is not a laxer dialog, only a
 * differently placed one.
 */
export default function Drilldown({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  tabs,
  activeTab,
  onTabChange,
  footer,
  width = 'lg',
  children,
}) {
  const panelRef = useRef(null);
  const restoreTo = useRef(null);
  const reduce = useReducedMotionSafe();

  useEffect(() => {
    if (!open) return undefined;
    restoreTo.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') ?? panelRef.current;
      target?.focus?.();
    }, 40);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  const widths = { md: 'sm:max-w-[520px]', lg: 'sm:max-w-[760px]', xl: 'sm:max-w-[1040px]' };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cx(
              'relative flex h-full w-full flex-col border-l border-line bg-surface shadow-e4 outline-none',
              widths[width],
            )}
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 38 }}
          >
            <header className="flex items-start justify-between gap-2 border-b border-line px-2.5 py-2">
              <div className="min-w-0">
                {eyebrow ? (
                  <p className="mb-px font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{eyebrow}</p>
                ) : null}
                <h2 className="truncate font-display text-xl font-bold tracking-[-0.02em]">{title}</h2>
                {subtitle ? <p className="mt-px truncate text-sm text-ink-3">{subtitle}</p> : null}
              </div>
              <IconButton label="Close" icon={X} onClick={onClose} />
            </header>

            {tabs?.length ? (
              <div className="flex shrink-0 gap-px overflow-x-auto border-b border-line px-1.5" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.value}
                    role="tab"
                    aria-selected={activeTab === t.value}
                    onClick={() => onTabChange?.(t.value)}
                    className={cx(
                      'relative shrink-0 px-1.5 py-1 text-sm font-semibold transition-colors duration-fast',
                      activeTab === t.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                    )}
                  >
                    {t.label}
                    {t.count != null ? (
                      <span className="ml-0.5 font-mono text-2xs text-ink-3 tnum">{t.count}</span>
                    ) : null}
                    {activeTab === t.value ? (
                      <span className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-brand-solid" aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>

            {footer ? (
              <footer className="shrink-0 border-t border-line bg-raised/40 px-2.5 py-1.5">{footer}</footer>
            ) : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** Label/value pair, the sheet's basic unit. */
export function Field({ label, children, mono = false, className }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{label}</dt>
      <dd className={cx('mt-px truncate text-sm', mono && 'font-mono tnum')}>
        {children ?? <span className="text-ink-3">—</span>}
      </dd>
    </div>
  );
}

export function FieldGrid({ children, cols = 3, className }) {
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[cols];
  return <dl className={cx('grid gap-1.5', grid, className)}>{children}</dl>;
}
