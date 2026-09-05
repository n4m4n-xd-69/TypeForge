import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  accuracyPct, consistencyPct, diffChars, grossWPM, netWPM,
} from '../../lib/typing.js';
import { sfx } from '../../lib/sound.js';

/**
 * The typing engine.
 *
 * Keystrokes are handled on keydown rather than through an <input> so that
 * Enter, Backspace and Tab behave predictably, and so code snippets can
 * auto-consume leading indentation the way real editors do.
 *
 * Mutable counters live in refs; only what the UI renders lives in state.
 */
export default function useTypingEngine({
  target,
  limitSeconds = null,
  autoIndent = false,
  stopOnError = false,
  sound = false,
  onFinish,
  /**
   * Battlefield only. Solo practice starts the clock on your first keystroke,
   * which is right when the run is yours alone and wrong when eight people have
   * to start together.
   *
   * `gated` refuses every keystroke until `begin()` is called, so nobody can
   * type during the countdown. `startAtMs` is the instant the run is considered
   * to have started, in *server* time — elapsed is measured from there rather
   * than from the frame that happened to notice GO, which is what makes eight
   * machines agree on a duration.
   *
   * Practice.jsx and CodeTyping.jsx pass neither and are unaffected.
   */
  gated = false,
  startAtMs = null,
}) {
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done
  const [elapsedMs, setElapsedMs] = useState(0);

  const startedAt = useRef(null);
  const everWrong = useRef(new Set());
  const keystrokes = useRef({ total: 0, correct: 0 });
  const keyStats = useRef({});
  const samples = useRef([]);
  const finishedRef = useRef(false);
  const typedRef = useRef('');
  const armed = useRef(!gated);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  /**
   * Running count of characters correct *at their own index*.
   *
   * Maintained incrementally rather than recomputed. `countCorrect` walks the
   * whole passage, and `live` was calling it on every render — which, with the
   * clock ticking ten times a second, meant an O(n) scan 10×/s for a number
   * that changes only when a key is pressed. `correctAt` remembers each
   * position's verdict so push and back can adjust the total in O(1), and
   * `countCorrect` is left for the one place that genuinely needs a fresh
   * scan (a `seed`ed value that never went through push).
   */
  const correctAt = useRef([]);
  const correctCount = useRef(0);

  const clearCounters = useCallback(() => {
    typedRef.current = '';
    startedAt.current = null;
    everWrong.current = new Set();
    keystrokes.current = { total: 0, correct: 0 };
    keyStats.current = {};
    samples.current = [];
    correctAt.current = [];
    correctCount.current = 0;
    finishedRef.current = false;
    armed.current = !gated;
  }, [gated]);

  /* Reset whenever the exercise changes. */
  useEffect(() => {
    setTyped('');
    setStatus('idle');
    setElapsedMs(0);
    clearCounters();
  }, [target, gated, clearCounters]);

  /**
   * `finish` reached through a ref.
   *
   * The clock effect below cannot list `finish` as a dependency without
   * restarting the interval every time its identity changes, and it cannot
   * close over it without eventually holding a stale one. A ref is the only
   * arrangement where exactly one interval exists and it always calls the
   * current function.
   */
  const finishRef = useRef(null);

  /* Clock + per-second WPM sampling (the input to consistency). */
  useEffect(() => {
    if (status !== 'running') return undefined;
    let lastSampleAt = 0;
    let lastCorrect = 0;

    /* Elapsed is always computed from the start instant, never accumulated, so
       a throttled or skipped tick costs an update but never drifts the value. */
    const tick = () => {
      const ms = Date.now() - startedAt.current;
      setElapsedMs(ms);

      if (ms - lastSampleAt >= 1000) {
        const correct = correctCount.current;
        samples.current.push(netWPM(correct - lastCorrect, ms - lastSampleAt));
        lastCorrect = correct;
        lastSampleAt = ms;
      }

      if (limitSeconds && ms >= limitSeconds * 1000) finishRef.current?.('time');
    };

    const id = setInterval(tick, 100);

    /* A backgrounded tab throttles intervals to about 1Hz, so a test whose
       limit expires while hidden would otherwise finish up to a second late and
       show a clock that had visibly jumped. Re-checking on the way back makes
       the deadline exact at the moment it becomes observable. */
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, limitSeconds]);

  const finish = useCallback(
    (reason) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const ms = startedAt.current ? Date.now() - startedAt.current : 0;
      const value = typedRef.current;
      const correct = correctCount.current;
      const result = {
        reason,
        durationSec: ms / 1000,
        chars: value.length,
        correctChars: correct,
        wpm: netWPM(correct, ms),
        rawWpm: grossWPM(value.length, ms),
        accuracy: accuracyPct(keystrokes.current.correct, keystrokes.current.total),
        consistency: consistencyPct(samples.current),
        errors: keystrokes.current.total - keystrokes.current.correct,
        keyStats: keyStats.current,
        completed: reason === 'complete',
      };

      setStatus('done');
      if (sound) sfx.complete();
      onFinishRef.current?.(result);
    },
    [sound],
  );
  finishRef.current = finish;

  const push = useCallback(
    (ch) => {
      const value = typedRef.current;
      if (value.length >= target.length) return;

      const expected = target[value.length];
      const correct = ch === expected;

      keystrokes.current.total += 1;
      if (correct) keystrokes.current.correct += 1;
      else everWrong.current.add(value.length);

      const bucket = (keyStats.current[expected] ??= { total: 0, wrong: 0 });
      bucket.total += 1;
      if (!correct) bucket.wrong += 1;

      if (sound) (correct ? (expected === ' ' ? sfx.space : sfx.key) : sfx.error)();
      if (stopOnError && !correct) return;

      correctAt.current[value.length] = correct;
      if (correct) correctCount.current += 1;

      let next = value + ch;

      // After a newline, walk past the next line's indentation for free — you
      // shouldn't have to hand-type eight spaces to prove you can indent.
      if (autoIndent && ch === '\n' && correct) {
        while (next.length < target.length && (target[next.length] === ' ' || target[next.length] === '\t')) {
          // Auto-consumed indentation is correct by construction — it is copied
          // straight out of the target — and has to be counted, or the WPM of
          // every indented snippet silently under-reports.
          correctAt.current[next.length] = true;
          correctCount.current += 1;
          next += target[next.length];
        }
      }

      typedRef.current = next;
      setTyped(next);

      if (next.length >= target.length) finish('complete');
    },
    [target, autoIndent, stopOnError, sound, finish],
  );

  /** Un-counts every position being removed, so the running total stays exact. */
  const rewindTo = useCallback((length) => {
    for (let i = typedRef.current.length - 1; i >= length; i--) {
      if (correctAt.current[i]) correctCount.current -= 1;
      correctAt.current[i] = false;
    }
  }, []);

  const back = useCallback(
    (wholeWord) => {
      const value = typedRef.current;
      if (!value.length) return;

      let next;
      if (wholeWord) {
        const trimmed = value.replace(/\s+$/, '');
        const cut = trimmed.lastIndexOf(' ');
        next = cut === -1 ? '' : trimmed.slice(0, cut + 1);
      } else {
        next = value.slice(0, -1);
      }
      rewindTo(next.length);
      typedRef.current = next;
      setTyped(next);
    },
    [rewindTo],
  );

  const start = useCallback(() => {
    if (status !== 'idle') return;
    if (gated && !armed.current) return; // the countdown is still running
    startedAt.current = startAtMs ?? Date.now();
    setStatus('running');
  }, [status, gated, startAtMs]);

  /**
   * Arms and starts the run from the outside. Called at GO by the countdown.
   *
   * The clock is set to `startAtMs`, not to now: two players who paint GO 80ms
   * apart still record identical elapsed times, because elapsed is measured
   * against the instant the server chose.
   */
  const begin = useCallback(() => {
    if (finishedRef.current) return;
    armed.current = true;
    startedAt.current = startAtMs ?? Date.now();
    setStatus((s) => (s === 'idle' ? 'running' : s));
  }, [startAtMs]);

  const onKeyDown = useCallback(
    (event) => {
      if (status === 'done') return;
      // Nothing gets through before GO — not Backspace, not Tab, not a
      // character. This is what makes "you cannot type during the countdown"
      // structural rather than a promise the UI makes.
      if (gated && !armed.current) return;

      const { key, ctrlKey, metaKey, altKey } = event;

      if (key === 'Backspace') {
        event.preventDefault();
        if (status === 'idle') return;
        back(ctrlKey || altKey);
        return;
      }

      /**
       * Tab is indentation, not focus navigation — code snippets need it, and
       * a stage that let it move focus would be unusable for the language
       * half of the product.
       *
       * Shift+Tab is deliberately NOT consumed. Without it this is a keyboard
       * trap: a keyboard-only user can reach the stage and then has no way
       * out of it, which fails WCAG 2.1.2. Indentation never needs the
       * backwards direction, so surrendering it costs nothing and restores
       * the exit.
       */
      if (key === 'Tab') {
        if (event.shiftKey) return;
        event.preventDefault();
        if (status === 'idle') start();
        push('\t' === target[typedRef.current.length] ? '\t' : ' ');
        return;
      }

      if (key === 'Enter') {
        event.preventDefault();
        if (status === 'idle') start();
        push('\n');
        return;
      }

      // Ignore modifiers and every non-printing key.
      if (ctrlKey || metaKey || altKey || key.length !== 1) return;

      event.preventDefault();
      if (status === 'idle') start();
      push(key);
    },
    [status, start, push, back, target, gated],
  );

  const reset = useCallback(() => {
    setTyped('');
    setStatus('idle');
    setElapsedMs(0);
    clearCounters();
  }, [clearCounters]);

  const states = useMemo(() => diffChars(target, typed, everWrong.current), [target, typed]);

  const live = useMemo(() => {
    const correct = correctCount.current;
    return {
      wpm: netWPM(correct, elapsedMs),
      rawWpm: grossWPM(typed.length, elapsedMs),
      accuracy: accuracyPct(keystrokes.current.correct, keystrokes.current.total),
      errors: keystrokes.current.total - keystrokes.current.correct,
      progress: target.length ? typed.length / target.length : 0,
      remaining: limitSeconds ? Math.max(0, limitSeconds - elapsedMs / 1000) : null,
      elapsedSec: elapsedMs / 1000,
      // Battlefield ranks and broadcasts on characters actually correct, not on
      // caret position — a rival's puck should not slide forward on a typo.
      correctChars: correct,
      progressChars: correct,
      mistakes: keystrokes.current.total - keystrokes.current.correct,
    };
  }, [target, typed, elapsedMs, limitSeconds]);

  return {
    typed,
    index: typed.length,
    states,
    status,
    live,
    onKeyDown,
    reset,
    finish,
    begin,
    nextChar: target[typed.length] ?? null,
  };
}
