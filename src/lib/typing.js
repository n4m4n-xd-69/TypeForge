/**
 * The typing engine's maths, kept separate from React so it can be reasoned
 * about (and unit-tested) on its own. See typing.test.js — every definition
 * below is pinned by a test that states it in words.
 *
 * Definitions, chosen to match what typing sites conventionally report:
 *   gross WPM = (all characters typed / 5) / minutes
 *   net WPM   = (correct characters / 5) / minutes   ← what we display
 *   accuracy  = correct keystrokes / total keystrokes, counting every keypress
 *               ever made, so a corrected mistake still costs you
 *   consistency = 100 − coefficient of variation of the per-second WPM samples
 *
 * "Correct characters" means characters that match the target *at their own
 * index*. A correct letter in the wrong place is not a correct character —
 * `countCorrect` is what enforces that, and it is the single input every WPM
 * figure in the product derives from, including the one Postgres recomputes in
 * battle_finish(). One definition, four surfaces.
 */

export const CHARS_PER_WORD = 5;

function wpm(chars, elapsedMs) {
  // A non-positive span is the only case that genuinely has no answer.
  //
  // The previous guard was `elapsedMs < 500 -> 0`, which is worse than it
  // looks: the readout sat at a flat zero for the first half second and then
  // jumped to whatever three-figure rate the opening burst implied. That jump
  // is the "WPM leaps incorrectly" complaint. Reporting the honest rate from
  // the first millisecond removes the discontinuity entirely, and DecayCounter
  // already eases the displayed value so the early noise never reads as jitter.
  if (!(elapsedMs > 0)) return 0;
  return Math.max(0, (chars / CHARS_PER_WORD) / (elapsedMs / 60_000));
}

/** Correct characters only — the headline figure. */
export function netWPM(correctChars, elapsedMs) {
  return wpm(Math.max(0, correctChars), elapsedMs);
}

/** Every character typed, right or wrong. Always >= netWPM. */
export function grossWPM(typedChars, elapsedMs) {
  return wpm(Math.max(0, typedChars), elapsedMs);
}

export function accuracyPct(correctKeystrokes, totalKeystrokes) {
  if (!totalKeystrokes) return 100;
  // Clamped rather than trusted: the engine's counters are the normal caller,
  // but a restored session or a Battlefield row can carry anything, and an
  // accuracy of 104% on a results screen destroys confidence in every other
  // number beside it.
  return Math.max(0, Math.min(100, (correctKeystrokes / totalKeystrokes) * 100));
}

/**
 * Coefficient of variation, inverted, so higher is steadier.
 *
 * Returns null — not 0 — when there are too few samples to say anything. Zero
 * is a measurement, and it is the worst one available; a three-second quote
 * run produced two samples and was scored as maximally erratic for it.
 * `gradeRun` renormalises around null instead of docking the grade.
 */
export function consistencyPct(samples) {
  const values = (samples ?? []).filter((v) => v > 0);
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return null;
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

/** The eight keys your resting fingers claim. Used by the keyboard visualiser
 *  and the finger map. */
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

/**
 * Grades a finished run into a letter, used on the summary screen.
 *
 * An unmeasured consistency (a run too short to produce three samples) drops
 * out of the weighting and the remaining two are renormalised, rather than
 * being scored as a zero the run never earned.
 */
export function gradeRun({ wpm, accuracy, consistency }) {
  const measured = typeof consistency === 'number' && Number.isFinite(consistency);
  const score = measured
    ? wpm * 0.4 + accuracy * 0.45 + consistency * 0.15
    : (wpm * 0.4 + accuracy * 0.45) / 0.85;
  if (accuracy < 85) return { grade: 'C', note: 'Accuracy is holding you back' };
  if (score >= 95) return { grade: 'S', note: 'Exceptional run' };
  if (score >= 85) return { grade: 'A', note: 'Strong across the board' };
  if (score >= 72) return { grade: 'B', note: 'Solid, with room to push' };
  return { grade: 'C', note: 'Keep the reps going' };
}
