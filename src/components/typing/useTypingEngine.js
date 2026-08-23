import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  accuracyPct, consistencyPct, countCorrect, diffChars, netWPM,
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

  /* Reset whenever the exercise changes. */
  useEffect(() => {
    setTyped('');
    setStatus('idle');
    setElapsedMs(0);
    typedRef.current = '';
    startedAt.current = null;
    everWrong.current = new Set();
    keystrokes.current = { total: 0, correct: 0 };
    keyStats.current = {};
    samples.current = [];
    finishedRef.current = false;
    armed.current = !gated;
  }, [target, gated]);

  /* Clock + per-second WPM sampling (the input to consistency). */
  useEffect(() => {
    if (status !== 'running') return;
    let lastSampleAt = 0;
    let lastCorrect = 0;

    const id = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsedMs(ms);

      if (ms - lastSampleAt >= 1000) {
        const correct = countCorrect(target, typedRef.current);
        samples.current.push(netWPM(correct - lastCorrect, ms - lastSampleAt));
        lastCorrect = correct;
        lastSampleAt = ms;
      }

      if (limitSeconds && ms >= limitSeconds * 1000) finish('time');
    }, 100);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, limitSeconds, target]);

  const finish = useCallback(
    (reason) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const ms = startedAt.current ? Date.now() - startedAt.current : 0;
      const value = typedRef.current;
      const correct = countCorrect(target, value);
      const result = {
        reason,
        durationSec: ms / 1000,
        chars: value.length,
        correctChars: correct,
        wpm: netWPM(correct, ms),
        rawWpm: netWPM(value.length, ms),
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
    [target, sound],
  );

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

      let next = value + ch;

      // After a newline, walk past the next line's indentation for free — you
      // shouldn't have to hand-type eight spaces to prove you can indent.
      if (autoIndent && ch === '\n' && correct) {
        while (next.length < target.length && (target[next.length] === ' ' || target[next.length] === '\t')) {
          next += target[next.length];
        }
      }

      typedRef.current = next;
      setTyped(next);

      if (next.length >= target.length) finish('complete');
    },
    [target, autoIndent, stopOnError, sound, finish],
  );

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
      typedRef.current = next;
      setTyped(next);
    },
    [],
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
    typedRef.current = '';
    startedAt.current = null;
    everWrong.current = new Set();
    keystrokes.current = { total: 0, correct: 0 };
    keyStats.current = {};
    samples.current = [];
    finishedRef.current = false;
    armed.current = !gated;
  }, [gated]);

  const states = useMemo(() => diffChars(target, typed, everWrong.current), [target, typed]);

  const live = useMemo(() => {
    const correct = countCorrect(target, typed);
    return {
      wpm: netWPM(correct, elapsedMs),
      rawWpm: netWPM(typed.length, elapsedMs),
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
