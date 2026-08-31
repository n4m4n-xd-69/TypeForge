import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cx } from '../../lib/format.js';
import { useReducedMotionSafe } from '../../lib/motion.js';

/**
 * The liquid-glass card used by every full-screen alert.
 *
 * One component rather than two similar ones, because the suspension notice
 * and operator notices are the same object with different contents — and the
 * moment they diverge visually, the product looks like two products.
 *
 * The optics live in `.lgx*` in index.css: a blurred/saturated surface, a
 * fixed top-left sheen, a directional rim, and a lift shadow, composed as
 * separate layers so each can be tuned without touching the others. Content
 * sits above all of it and is never blurred — text inside a lens is the
 * classic way glassmorphism becomes unreadable.
 *
 * Tilt is capped at 4 degrees and driven through CSS custom properties, so a
 * pointer move is one composited transform rather than a React render per
 * frame. It is off entirely without a fine pointer or under reduced motion.
 */

const MAX_TILT = 4;

export default function GlassAlert({
  children,
  /** Colour of the top edge line — carries severity without tinting the card. */
  edgeClass = 'via-brand-solid',
  onBackdropClick,
  labelledBy,
  describedBy,
  role = 'dialog',
  width = 'max-w-[480px]',
  className,
}) {
  const reduce = useReducedMotionSafe();
  const ref = useRef(null);
  const [tilting, setTilting] = useState(false);

  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el || reduce) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      // Y follows the pointer horizontally, X inverts so the card leans away
      // from the cursor the way a physical panel would.
      el.style.setProperty('--lgx-ry', `${px * MAX_TILT}deg`);
      el.style.setProperty('--lgx-rx', `${-py * MAX_TILT}deg`);
      if (!tilting) setTilting(true);
    },
    [reduce, tilting],
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--lgx-ry', '0deg');
    el.style.setProperty('--lgx-rx', '0deg');
    setTilting(false);
  }, []);

  return (
    <>
      {/* The scrim is part of the effect, not just a dimmer: the blur behind
          the card is what gives the glass something to transmit. */}
      <motion.div
        className="absolute inset-0 bg-bg/65 backdrop-blur-[14px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onBackdropClick}
        aria-hidden
      />

      <motion.div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 330, damping: 28 }}
        className={cx('lgx lgx--tilt w-full', width, className)}
      >
        <span className="lgx__surface" aria-hidden />
        <span className="lgx__sheen" aria-hidden />

        {/* Severity reads as a lit edge along the top rather than a coloured
            card, so the glass stays glass. */}
        <span
          aria-hidden
          className={cx(
            'pointer-events-none absolute inset-x-0 top-0 z-[3] h-[2px] rounded-t-[16px]',
            'bg-gradient-to-r from-transparent to-transparent',
            edgeClass,
          )}
        />

        <div className="lgx__content">{children}</div>
      </motion.div>
    </>
  );
}
