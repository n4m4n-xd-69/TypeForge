import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings2 } from 'lucide-react';

/**
 * Full-screen orientation overlay, in the same register as the first-run name
 * prompt: it owns the whole viewport, blurs everything behind it, and is the
 * only thing on screen.
 *
 * Two jobs — tell a first-time user where their hands go, then get out of the
 * way. It dismisses on any click or keypress, auto-hides after `autoHideMs`,
 * and the caller retires it permanently after a few showings.
 */

/**
 * Finger geometry, mirrored per hand. Length and width follow real proportions —
 * pinky shortest and thinnest, middle longest — because four identical bars read
 * as a bar chart, not a hand.
 */
const PINKY = { len: 30, width: 11 };
const RING = { len: 43, width: 13 };
const MIDDLE = { len: 49, width: 14 };
const INDEX = { len: 39, width: 14 };

const HOME_LEFT = [
  { key: 'A', finger: 'pinky', ...PINKY },
  { key: 'S', finger: 'ring', ...RING },
  { key: 'D', finger: 'middle', ...MIDDLE },
  { key: 'F', finger: 'index', ...INDEX },
];

const HOME_RIGHT = [
  { key: 'J', finger: 'index', ...INDEX },
  { key: 'K', finger: 'middle', ...MIDDLE },
  { key: 'L', finger: 'ring', ...RING },
  { key: ';', finger: 'pinky', ...PINKY },
];

export default function HandGuide({ show, onDismiss, autoHideMs = 10_000, remainingShows }) {
  const [remaining, setRemaining] = useState(Math.ceil(autoHideMs / 1000));

  useEffect(() => {
    if (!show) return;
    setRemaining(Math.ceil(autoHideMs / 1000));

    const hide = setTimeout(onDismiss, autoHideMs);
    const tick = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);

    // Any real keystroke means they're ready — stop explaining.
    const onKey = () => onDismiss();
    window.addEventListener('keydown', onKey, { once: true });

    return () => {
      clearTimeout(hide);
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
    };
  }, [show, autoHideMs, onDismiss]);

  return createPortal(
    <AnimatePresence>
      {show ? (
        <motion.button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the hand guide and start typing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[65] grid w-full cursor-pointer place-items-center overflow-hidden bg-bg/80 backdrop-blur-xl"
        >
          <motion.div
            initial={{ y: 14, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.05 }}
            className="flex flex-col items-center gap-2 px-2"
          >
            <Hands />

            <div className="max-w-[46ch] text-center">
              <p className="text-lg font-bold tracking-[-0.01em]">Rest your fingers on the home row</p>
              <p className="mt-px text-sm text-ink-2">
                Index fingers find the bumps on <Key>F</Key> and <Key>J</Key>. Every other key is reached from
                here without looking — that's the whole technique.
              </p>
            </div>

            {/* Why you're seeing this, and how to stop seeing it. */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9, duration: 0.4 }}
              className="max-w-[44ch] text-center text-xs leading-relaxed text-ink-3"
            >
              This appears before each run as a posture reminder. Turn it off any time in{' '}
              <span className="inline-flex items-center gap-px font-bold text-ink-2">
                <Settings2 size={11} aria-hidden /> Settings
              </span>{' '}
              → <span className="font-bold text-ink-2">Hand guide</span>.
            </motion.p>

            <span className="flex items-center gap-1 rounded-full border border-line bg-surface/80 px-1.5 py-0.5 text-2xs font-bold uppercase tracking-[0.1em] text-ink-3">
              <span className="relative flex h-1 w-1">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-solid opacity-60" />
                <span className="relative inline-flex h-1 w-1 rounded-full bg-brand-solid" />
              </span>
              click anywhere · hides in {remaining}s
            </span>

            {typeof remainingShows === 'number' ? (
              <p className="text-2xs text-ink-3">
                {remainingShows > 0
                  ? `You'll see this ${remainingShows} more time${remainingShows === 1 ? '' : 's'}.`
                  : "That's the last time you'll see this."}
              </p>
            ) : null}
          </motion.div>
        </motion.button>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Key({ children }) {
  return (
    <kbd className="rounded-[5px] border border-line bg-subtle px-0.5 font-mono text-2xs font-bold text-ink-2">
      {children}
    </kbd>
  );
}

/**
 * Two hands over a mini keyboard. Drawn rather than imported so it inherits the
 * theme tokens and needs no asset pipeline.
 */
function Hands() {
  return (
    <div className="relative flex items-start justify-center gap-1" aria-hidden>
      <Hand side="left" keys={HOME_LEFT} />
      {/* The two keys nobody rests on — drawn dim so the home row stands out. */}
      <div className="flex gap-[6px]">
        {['G', 'H'].map((k) => (
          <span
            key={k}
            className="grid h-[30px] w-[30px] place-items-center rounded-[8px] border border-line bg-subtle text-xs font-bold text-ink-3"
          >
            {k}
          </span>
        ))}
      </div>
      <Hand side="right" keys={HOME_RIGHT} />
    </div>
  );
}

/**
 * Top-down stylisation: the key sits at the top, a finger reaches up to it, and
 * the palm anchors the bottom. Deliberately not anatomical — four equal-length
 * fingers read more clearly at this size than a realistic hand silhouette, and
 * the staggered pulse is what sells it as a hand rather than four bars.
 */
function Hand({ side, keys }) {
  const flip = side === 'right';
  const tallest = Math.max(...keys.map((k) => k.len));

  return (
    <div className="flex flex-col items-center">
      {/* items-start keeps the key caps in a straight row; the fingers below
          them are what vary in length. */}
      <div className="flex items-start gap-[6px]">
        {keys.map((k, i) => {
          // Ripple outward from the index finger on both hands.
          const order = flip ? i : keys.length - 1 - i;
          return (
            <motion.div
              key={k.key}
              className="flex flex-col items-center"
              animate={{ y: [0, 5, 0] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: order * 0.15,
                repeatDelay: 1,
              }}
              title={`${k.finger} → ${k.key}`}
            >
              <span className="grid h-[30px] w-[30px] place-items-center rounded-[8px] border border-brand/45 bg-brand-wash text-xs font-bold text-brand">
                {k.key}
              </span>
              <span
                className="mt-0.5 block rounded-full bg-gradient-to-b from-brand-solid to-brand-solid/55"
                style={{ height: k.len, width: k.width }}
              />
              {/* Shim so every finger's palm-end lands on the same line. */}
              <span aria-hidden style={{ height: tallest - k.len }} />
            </motion.div>
          );
        })}
      </div>

      {/* Palm, overlapping the finger ends so they read as joined. */}
      <span className="-mt-1.5 h-[44px] w-[86px] rounded-[22px] bg-brand-solid/45" />
    </div>
  );
}
