import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cx } from '../../lib/format.js';
import { IconButton } from './Button.jsx';

/**
 * Portal dialog with focus containment. Escape closes, focus returns to
 * whatever opened it, and the page behind is inert to the keyboard.
 */
export default function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissable = true }) {
  const panelRef = useRef(null);
  const restoreTo = useRef(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement;
    // Restore whatever was there rather than blanking it — the full-screen
    // practice surface also sets `hidden`, and clearing it on modal close left
    // the page behind scrollable again.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
    const timer = setTimeout(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') ?? panelRef.current;
      target?.focus?.();
    }, 40);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      clearTimeout(timer);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose, dismissable]);

  const widths = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[980px]' };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-3">
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={dismissable ? onClose : undefined}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cx(
              'relative w-full overflow-hidden bg-surface shadow-xl outline-none',
              'rounded-t-xl sm:rounded-xl border border-line',
              widths[size],
            )}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            {title ? (
              <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
                <div>
                  <h2 className="text-xl font-bold">{title}</h2>
                  {description ? <p className="mt-px text-sm text-ink-3">{description}</p> : null}
                </div>
                {dismissable ? <IconButton label="Close" icon={X} onClick={onClose} /> : null}
              </header>
            ) : null}
            <div className="max-h-[70dvh] overflow-y-auto">{children}</div>
            {footer ? <footer className="border-t border-line px-3 py-2">{footer}</footer> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
