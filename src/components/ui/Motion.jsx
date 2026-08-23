import { motion } from 'framer-motion';
import {
  DUR,
  EASE,
  REVEAL_VIEWPORT,
  fadeUp,
  hoverLift,
  staggerContainer,
  useReducedMotionSafe,
} from '../../lib/motion.js';

/**
 * Motion primitives.
 *
 * These exist so surfaces don't each hand-roll their own variants and drift out
 * of step. Everything here reveals *once* — `whileInView` with `once: true`
 * means the observer detaches after firing, so a long dashboard is not paying
 * for dozens of live intersection callbacks while you scroll it. Content that
 * re-animates every time it crosses the viewport also gets annoying fast on the
 * second pass through a page.
 */

/** Scroll-triggered rise-and-fade. */
export function Reveal({ children, delay = 0, distance = 14, className, as = 'div', ...rest }) {
  const reduce = useReducedMotionSafe();
  const Tag = motion[as] ?? motion.div;

  return (
    <Tag
      className={className}
      variants={fadeUp(reduce, distance)}
      initial="hidden"
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      transition={{ delay: reduce ? 0 : delay }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Staggered group. Children must be `<StaggerItem>` (or anything declaring the
 * same `hidden`/`show` variant names) for the cascade to reach them.
 */
export function Stagger({ children, step = 0.045, delay = 0, className, as = 'div', ...rest }) {
  const reduce = useReducedMotionSafe();
  const Tag = motion[as] ?? motion.div;

  return (
    <Tag
      className={className}
      variants={staggerContainer(reduce, step, delay)}
      initial="hidden"
      whileInView="show"
      viewport={REVEAL_VIEWPORT}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({ children, distance = 12, className, as = 'div', ...rest }) {
  const reduce = useReducedMotionSafe();
  const Tag = motion[as] ?? motion.div;

  return (
    <Tag className={className} variants={fadeUp(reduce, distance)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Ambient drift for decorative elements.
 *
 * Deliberately slow and small: this is meant to register as "the surface is
 * alive" in peripheral vision, not to be watchable. Anything with text in it is
 * the wrong thing to wrap — moving type is hard to read and nauseating at
 * length. Under reduced motion it renders a plain div and never animates.
 */
export function Floating({ children, amplitude = 8, duration = 7, delay = 0, className, ...rest }) {
  const reduce = useReducedMotionSafe();

  if (reduce) {
    return (
      <div className={className} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      animate={{ y: [0, -amplitude, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}


/* Counting numbers are handled by `Counter.jsx`, which already ramps with rAF
   and snaps under reduced motion — no motion-library equivalent needed here. */

