/**
 * The typing engine's maths, kept separate from React so it can be reasoned
 * about (and unit-tested) on its own.
 *
 * Definitions, chosen to match what typing sites conventionally report:
 *   gross WPM = (all characters typed / 5) / minutes
 *   net WPM   = (correct characters / 5) / minutes   ← what we display
 *   accuracy  = correct keystrokes / total keystrokes, counting every keypress
 *               ever made, so a corrected mistake still costs you
 *   consistency = 100 − coefficient of variation of the per-second WPM samples
 */

export const CHARS_PER_WORD = 5;

export function netWPM(correctChars, elapsedMs) {
  if (elapsedMs < 500) return 0;
  return (correctChars / CHARS_PER_WORD) / (elapsedMs / 60_000);
}

export function accuracyPct(correctKeystrokes, totalKeystrokes) {
  if (!totalKeystrokes) return 100;
  return (correctKeystrokes / totalKeystrokes) * 100;
}

/** Coefficient of variation, inverted, so higher is steadier. */
export function consistencyPct(samples) {
  const values = samples.filter((v) => v > 0);
  if (values.length < 3) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(100, (1 - cv) * 100));
}

export const CHAR_STATE = {
  PENDING: 'pending',
  CORRECT: 'correct',
  WRONG: 'wrong',
  EXTRA: 'extra',
  CORRECTED: 'corrected',
};

/**
 * Turn the target text plus what the user has typed into per-character render
 * state. `everWrong` marks characters that were fixed after a mistake — they
 * render differently so you can see where you stumbled even after correcting.
 */
export function diffChars(target, typed, everWrong) {
  const out = new Array(target.length);
  for (let i = 0; i < target.length; i++) {
    if (i >= typed.length) {
      out[i] = everWrong?.has(i) ? CHAR_STATE.CORRECTED : CHAR_STATE.PENDING;
    } else if (typed[i] === target[i]) {
      out[i] = everWrong?.has(i) ? CHAR_STATE.CORRECTED : CHAR_STATE.CORRECT;
    } else {
      out[i] = CHAR_STATE.WRONG;
    }
  }
  return out;
}

export function countCorrect(target, typed) {
  let n = 0;
  const len = Math.min(target.length, typed.length);
  for (let i = 0; i < len; i++) if (target[i] === typed[i]) n++;
  return n;
}

/**
 * Which physical keys are giving you trouble. Returns the worst offenders with
 * at least `minAttempts` samples, so a single fat-fingered `z` doesn't top the
 * list forever.
 */
export function weakestKeys(keyStats, limit = 5, minAttempts = 6) {
  return Object.entries(keyStats || {})
    .map(([key, s]) => ({ key, ...s, rate: s.wrong / Math.max(1, s.total) }))
    .filter((k) => k.total >= minAttempts && k.wrong > 0)
    .sort((a, b) => b.rate - a.rate || b.wrong - a.wrong)
    .slice(0, limit);
}

/** Human-readable name for a character, for the "weak keys" chips. */
export function keyLabel(ch) {
  if (ch === ' ') return 'space';
  if (ch === '\n') return 'enter';
  return ch;
}

/** Physical rows, used by the keyboard visualiser and the finger map. */
export const KEY_ROWS = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

export const HOME_KEYS = new Set(['a', 's', 'd', 'f', 'j', 'k', 'l', ';']);

const SHIFTED = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7',
  '*': '8', '(': '9', ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\',
  ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
};

/** Maps a character to the base key you press, plus whether Shift is needed. */
export function keyFor(ch) {
  if (ch === ' ') return { key: 'space', shift: false };
  if (ch === '\n') return { key: 'enter', shift: false };
  if (ch in SHIFTED) return { key: SHIFTED[ch], shift: true };
  const lower = ch.toLowerCase();
  return { key: lower, shift: lower !== ch };
}

/** Grades a finished run into a letter, used on the summary screen. */
export function gradeRun({ wpm, accuracy, consistency }) {
  const score = wpm * 0.4 + accuracy * 0.45 + consistency * 0.15;
  if (accuracy < 85) return { grade: 'C', note: 'Accuracy is holding you back' };
  if (score >= 95) return { grade: 'S', note: 'Exceptional run' };
  if (score >= 85) return { grade: 'A', note: 'Strong across the board' };
  if (score >= 72) return { grade: 'B', note: 'Solid, with room to push' };
  return { grade: 'C', note: 'Keep the reps going' };
}
