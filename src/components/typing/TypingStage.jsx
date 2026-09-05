import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cx } from '../../lib/format.js';
import { CHAR_STATE } from '../../lib/typing.js';

/**
 * Whether the stage has ever held focus this page load.
 *
 * Module scope on purpose: the hint is about the person, not the component, so
 * it must not come back when the stage remounts on a new exercise or a mode
 * switch. A reload is a new visitor as far as this is concerned.
 */
let hasFocusedOnceThisLoad = false;

/* Pending text sits at full --ink-3 rather than a faded tint: at 55% it dropped
   below 3:1 on both surfaces and was genuinely hard to read ahead of the caret. */
const STATE_CLASS = {
  [CHAR_STATE.PENDING]: 'text-ink-3',
  [CHAR_STATE.CORRECT]: 'text-ink',
  [CHAR_STATE.CORRECTED]: 'text-ink-2 underline decoration-warn/70 decoration-2 underline-offset-[5px]',
  [CHAR_STATE.WRONG]: 'text-bad bg-bad/10 rounded-[3px]',
};

/**
 * Renders the passage and owns the caret.
 *
 * `tokens` is optional: pass the Prism-flattened character list to get syntax
 * colours underneath the typing state, or leave it out for plain prose.
 */
export default function TypingStage({
  target,
  tokens,
  engine,
  caretStyle = 'block',
  smoothCaret = true,
  blindMode = false,
  fontSize = 21,
  lineHeight = 2,
  showLineNumbers = false,
  className,
  visibleLines = 6,
  loading = false,
}) {
  const wrapRef = useRef(null);
  const contentRef = useRef(null);
  const [caret, setCaret] = useState({ x: 0, y: 0, h: 0, w: 0 });
  const [shift, setShift] = useState(0);
  const [focused, setFocused] = useState(false);
  const [hasFocusedOnce, setHasFocusedOnce] = useState(hasFocusedOnceThisLoad);
  const [contentH, setContentH] = useState(0);

  const markFocused = useCallback(() => {
    hasFocusedOnceThisLoad = true;
    setHasFocusedOnce(true);
    setFocused(true);
  }, []);

  /* The arrival beat: a brief settle on the passage the moment loading ends, so
     a swap that would otherwise happen between two frames is legible as "this
     is new" rather than looking like the text glitched. */
  const [popping, setPopping] = useState(false);
  const wasLoading = useRef(loading);
  useEffect(() => {
    if (wasLoading.current && !loading) {
      setPopping(true);
      const t = setTimeout(() => setPopping(false), 480);
      wasLoading.current = loading;
      return () => clearTimeout(t);
    }
    wasLoading.current = loading;
    return undefined;
  }, [loading]);

  const { states, index, status, onKeyDown } = engine;

  /* Measure the caret from the DOM — text metrics are not worth predicting. */
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const atEnd = index >= target.length;
    const el = content.querySelector(`[data-idx="${atEnd ? Math.max(0, target.length - 1) : index}"]`);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const base = content.getBoundingClientRect();
    const x = rect.left - base.left + (atEnd ? rect.width : 0);
    const y = rect.top - base.top;

    setCaret({ x, y, h: rect.height, w: Math.max(2, rect.width) });

    // Keep the active line parked a third of the way down the viewport.
    const lineBox = rect.height;
    const anchor = lineBox * Math.min(2, Math.floor(visibleLines / 2));
    setShift(Math.max(0, y - anchor));
  }, [index, target, fontSize, visibleLines]);

  const focus = useCallback(() => wrapRef.current?.focus(), []);

  /**
   * Grab focus on mousedown, not click.
   *
   * The overlay is a <button>; pressing it focused the button, and by the time
   * our click handler moved focus to the stage React had already unmounted the
   * overlay — Chromium's focus fixup then dropped everything back to <body>.
   * The visible symptom was that the first click did nothing and you had to
   * click twice before typing registered. Preventing the default mousedown
   * stops the browser assigning focus at all, so ours is the only one.
   */
  const grabFocus = useCallback((event) => {
    event.preventDefault();
    wrapRef.current?.focus();
  }, []);

  useEffect(() => {
    if (status === 'idle') focus();
  }, [status, focus]);

  /**
   * Makes "press any key to focus" true. Without this the overlay promised
   * something nothing implemented: keystrokes landed on <body> and vanished.
   * The waking keystroke is forwarded to the engine so it isn't swallowed.
   */
  useEffect(() => {
    const onWindowKey = (event) => {
      if (focused || status === 'done') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const el = event.target;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      // A dialog owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"]')) return;

      wrapRef.current?.focus();
      onKeyDown(event);
    };

    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [focused, status, onKeyDown]);

  /**
   * Measure what the passage actually occupies.
   *
   * The box used to be a fixed `visibleLines` tall regardless of content, so a
   * two-line drill reserved room for six and the keyboard below it sat marooned
   * at the bottom of a mostly empty panel. `visibleLines` is now a ceiling, not
   * a fixed size: short passages shrink to fit and everything below them moves
   * up, while long ones cap and scroll by shifting as before.
   *
   * ResizeObserver rather than a one-shot measure, because the height changes
   * on reflow — a window resize, a font landing, or the rail expanding and
   * narrowing the column all rewrap the text.
   */
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [target, tokens, fontSize, lineHeight, showLineNumbers]);

  const maxHeight = fontSize * lineHeight * visibleLines;
  // One line of slack so a descender or the newline glyph never clips.
  const height = contentH ? Math.min(maxHeight, contentH + fontSize * 0.35) : maxHeight;

  return (
    <div className={cx('relative', className)}>
      <div
        ref={wrapRef}
        tabIndex={0}
        role="textbox"
        aria-label="Typing area"
        aria-describedby="typing-hint"
        onKeyDown={onKeyDown}
        onFocus={markFocused}
        onBlur={() => setFocused(false)}
        onMouseDown={grabFocus}
        className="relative cursor-text overflow-hidden outline-none"
        style={{ height }}
      >
        {/* `whitespace-pre-wrap` is what makes the passage fill the box: it keeps
            the spaces and indentation the exercise depends on while still allowing
            the line to break. Per-character `whitespace-pre` (the old approach)
            suppressed every break opportunity, so everything ran off one line. */}
        <motion.div
          ref={contentRef}
          className={cx(
            'relative font-mono whitespace-pre-wrap break-words',
            showLineNumbers && 'pl-4',
            popping && 'pop-in',
            blindMode && 'opacity-0 transition-opacity duration-300 hover:opacity-100',
          )}
          style={{ fontSize, lineHeight }}
          animate={{ y: -shift }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Caret */}
          <motion.span
            aria-hidden
            className={cx(
              'pointer-events-none absolute left-0 top-0 z-10 rounded-[2px]',
              caretStyle === 'block' && 'bg-brand-solid/45 mix-blend-multiply dark:mix-blend-screen dark:bg-brand-solid/35',
              caretStyle === 'line' && 'bg-brand',
              caretStyle === 'underline' && 'bg-brand',
              status === 'idle' && 'animate-blink',
            )}
            animate={{
              x: caret.x,
              y: caretStyle === 'underline' ? caret.y + caret.h - 3 : caret.y,
              width: caretStyle === 'block' ? caret.w : caretStyle === 'underline' ? caret.w : 2,
              height: caretStyle === 'underline' ? 3 : caret.h * 0.86,
            }}
            transition={
              smoothCaret
                ? { type: 'spring', stiffness: 900, damping: 55, mass: 0.35 }
                : { duration: 0 }
            }
            style={{ marginTop: caretStyle === 'block' ? caret.h * 0.07 : caret.h * 0.07 }}
          />

          {showLineNumbers ? <Gutter target={target} fontScale={0.6} lineHeight={lineHeight} /> : null}
          <Passage target={target} tokens={tokens} states={states} />
        </motion.div>

        {/* While fresh text is being written, the old passage stays readable
            underneath a shimmer rather than being replaced by a skeleton: you
            can keep typing the current one right up until the new one lands. */}
        <AnimatePresence>
          {loading ? (
            <motion.div
              key="shimmer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-none absolute inset-0 z-[15] overflow-hidden"
              aria-hidden
            >
              <div className="absolute inset-0 bg-bg/45 backdrop-blur-[1px]" />
              <div className="shimmer-sweep absolute inset-y-0 w-[45%]" />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Shown once per page load, not on every blur. It is an instruction —
            "press any key" — and once you have done that you know. Repeating it
            every time focus drifted meant a dimmed, blurred passage covered by a
            prompt telling you something you had already learned, several times a
            session. Window keydown still wakes the stage regardless. */}
        {!focused && !hasFocusedOnce && status !== 'done' ? (
          <button
            onMouseDown={grabFocus}
            className="absolute inset-0 z-20 grid place-items-center bg-surface/50 backdrop-blur-[2px] transition-opacity"
          >
            <span className="rounded-full border border-line bg-surface px-2 py-1 text-sm font-bold shadow-sm">
              Click here or press any key to focus
            </span>
          </button>
        ) : null}
      </div>

      <p id="typing-hint" className="sr-only">
        Type the displayed text. Backspace corrects. Control plus Backspace removes the previous word. Escape restarts.
      </p>
    </div>
  );
}

/**
 * The passage, rendered one word at a time.
 *
 * This used to be a flat loop that rebuilt every character span on every
 * render, and it was the single biggest source of the input lag. Two things
 * drove it, and neither was the keystroke itself:
 *
 *   1. The engine ticks a clock into state ten times a second, so the whole
 *      passage re-rendered 10×/s *while the user was doing nothing*. An
 *      800-character exercise is 800 element creations and 800 `cx()` string
 *      concatenations per tick.
 *   2. A keystroke changes exactly one character's state, and rebuilt all 800
 *      to express it.
 *
 * Chunking by word fixes both. `Word` is memoised on a signature of just its
 * own characters' states, so a clock tick re-renders nothing at all, and a
 * keystroke re-renders the one word under the caret. The signature costs a
 * single pass over an array of short strings — far less than the work it
 * avoids.
 *
 * Words, not fixed-size blocks, because a word is also the unit the browser
 * wraps on: chunk boundaries never fall mid-word, so `whitespace-pre-wrap`
 * still breaks lines exactly where it did before.
 */
function Passage({ target, tokens, states }) {
  const chars = useMemo(
    () => tokens ?? [...target].map((ch) => ({ ch, className: '' })),
    [tokens, target],
  );

  /* Boundaries change only when the exercise does. A chunk runs up to and
     including its trailing space or newline, so whitespace never starts a
     chunk and the caret's word is always one unit. */
  const chunks = useMemo(() => {
    const out = [];
    let start = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i].ch;
      if (ch === ' ' || ch === '\n' || ch === '\t') {
        out.push([start, i + 1]);
        start = i + 1;
      }
    }
    if (start < chars.length) out.push([start, chars.length]);
    return out;
  }, [chars]);

  return (
    <>
      {chunks.map(([start, end]) => {
        // One character per state, so a word's signature is a short string and
        // comparing it is a single string compare inside React.memo.
        let sig = '';
        for (let i = start; i < end; i++) sig += STATE_SIG[states[i]] ?? '.';
        return <Word key={start} chars={chars} start={start} end={end} states={states} sig={sig} />;
      })}
    </>
  );
}

/** Distinct one-character codes, so two different states never share a signature. */
const STATE_SIG = {
  [CHAR_STATE.PENDING]: 'p',
  [CHAR_STATE.CORRECT]: 'c',
  [CHAR_STATE.WRONG]: 'w',
  [CHAR_STATE.CORRECTED]: 'x',
  [CHAR_STATE.EXTRA]: 'e',
};

const Word = memo(
  function Word({ chars, start, end, states }) {
    const out = [];
    for (let i = start; i < end; i++) {
      const { ch, className } = chars[i];
      const state = states[i];

      if (ch === '\n') {
        // The newline still has to be typed, so it gets a visible glyph and the
        // same state colours as any other character.
        out.push(
          <span
            key={i}
            data-idx={i}
            className={cx(
              'inline-block w-[0.9em] text-[0.7em] align-middle',
              state === CHAR_STATE.WRONG
                ? 'text-bad bg-bad/15 rounded-[3px]'
                : state === CHAR_STATE.CORRECT || state === CHAR_STATE.CORRECTED
                  ? 'text-ink-3'
                  : 'text-ink-3/30',
            )}
          >
            ↵
          </span>,
        );
        out.push(<br key={`br-${i}`} />);
        continue;
      }

      out.push(
        <span
          key={i}
          data-idx={i}
          className={cx(
            'relative transition-colors duration-75',
            state === CHAR_STATE.PENDING && className ? `${className} opacity-70` : null,
            state === CHAR_STATE.CORRECT && className ? className : null,
            !className || state === CHAR_STATE.WRONG || state === CHAR_STATE.CORRECTED
              ? STATE_CLASS[state]
              : null,
          )}
        >
          {ch}
        </span>,
      );
    }
    return <>{out}</>;
  },
  // `states` is a fresh array on every keystroke and `chars` is stable, so the
  // signature is the only thing worth comparing — it is precisely "did any of
  // MY characters change".
  (a, b) => a.sig === b.sig && a.chars === b.chars && a.start === b.start && a.end === b.end,
);

/**
 * Line numbers live in their own absolutely-positioned column so they never
 * enter the character flow the caret measures against. Each row is sized to the
 * parent's line box: a smaller font needs a proportionally larger line-height.
 */
function Gutter({ target, fontScale, lineHeight }) {
  const count = target.split('\n').length;
  return (
    <div
      aria-hidden
      className="absolute left-0 top-0 select-none text-right font-mono text-ink-3/55 tnum"
      style={{ fontSize: `${fontScale}em`, width: '2.2em' }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ lineHeight: lineHeight / fontScale }}>
          {i + 1}
        </div>
      ))}
    </div>
  );
}
