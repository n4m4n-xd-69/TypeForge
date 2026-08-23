import { useReducedMotion } from 'framer-motion';

/**
 * One motion vocabulary for the whole app.
 *
 * Two rules hold everywhere in here:
 *
 * 1. Only `transform` and `opacity` are animated. Both are composited, so a
 *    running animation never triggers layout or paint. Animating width, top or
 *    filter would, and at the densities this app uses — a dashboard is a couple
 *    of hundred animated nodes — that is the difference between 60fps and jank.
 *
 * 2. Everything degrades through `useReducedMotionSafe`. Reduced motion means
 *    *reduce*, not *remove*: content still fades, it simply stops travelling.
 *    Movement is what triggers vestibular discomfort, opacity does not.
 *
 * The curve below is the one already used by the app shell and theme
 * transitions, so new motion feels like it belongs to the same object.
 */
/**
 * The house curve: decelerate, never overshoot. Matches `ease-out` in
 * tailwind.config.js so a CSS transition and a framer transition on the same
 * element agree.
 */
export const EASE = [0.2, 0, 0, 1];

/**
 * Durations, in seconds, mirroring the CSS `duration-*` tokens.
 *
 * Exit is deliberately faster than enter everywhere it is used. Something
 * arriving should be legible; something leaving is already decided, and
 * making the user wait for it to finish is the most common way an interface
 * starts feeling slow.
 */
export const DUR = {
  instant: 0.08,
  fast: 0.12,
  base: 0.18,
  slow: 0.28,
  deliberate: 0.42,
};

/**
 * `useReducedMotion` returns null until it has resolved, which reads as
 * "motion is fine" at exactly the moment first paint happens. Coercing to a
 * boolean keeps call sites from having to think about the tri-state.
 */
export function useReducedMotionSafe() {
  return useReducedMotion() === true;
}

/** Rise-and-fade. The workhorse for cards, rows and section bodies. */
export const fadeUp = (reduce, distance = 14) => ({
  hidden: { opacity: 0, y: reduce ? 0 : distance },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
});

/**
 * Container for staggered children.
 *
 * `staggerChildren` is capped deliberately: past roughly 60ms per item a list
 * of ten stops reading as one gesture and starts reading as ten separate
 * events, which makes the page feel slow rather than considered.
 */
export const staggerContainer = (reduce, step = 0.045, delay = 0) => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: reduce ? 0 : step,
      delayChildren: reduce ? 0 : delay,
    },
  },
});

/** Shared `whileInView` config — reveal once, slightly before the edge. */
export const REVEAL_VIEWPORT = { once: true, margin: '0px 0px -12% 0px' };

