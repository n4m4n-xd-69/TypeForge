import { xorshift32, toU32, draw, seedFrom } from './prng.js';
import { PASSAGES } from '../content.js';

/**
 * The Shadow Ninja avatar's prose-flow engine.
 *
 * Where the Stickman avatar gives you three short words and asks which lane to
 * commit to, the Ninja gives you a running paragraph and asks you to keep your
 * footing. The paragraph is cut into **beats** — clauses — and every completed
 * beat emits one ordinary CombatEvent, so the damage, Focus, chain and parry
 * maths are the *same tested reducer* (`combat.stepEvent`) the Stickman uses.
 * Nothing here re-implements balance; it only chooses moves and lengths a
 * different way.
 *
 * Two rules are specific to this mode:
 *
 *   1. **A wrong character costs HP immediately** (`NINJA_ERROR_HP_TENTHS`),
 *      on top of the accuracy penalty the beat carries into `precisionFactor`
 *      at resolution. A sloppy beat is therefore punished twice, which is what
 *      makes accuracy — not speed — the dominant stat in this mode.
 *   2. **Output scales against the opponent** (`pressureFor`), passed to
 *      `stepEvent` as its existing `damageMul` argument. No reducer change.
 *
 * See docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §5.
 */

/** 'NINJ' — keeps scroll selection off every other salted stream. */
const SCROLL_SALT = 0x4e494e4a;

/**
 * HP cost, in integer tenths, of one wrong character. 8 tenths = 0.8 HP.
 *
 * Calibrated against `MAX_HP_TENTHS = 1000`: a 95%-accurate typist on a
 * 300-character scroll makes ~15 mistakes and pays ~12 HP, which is
 * noticeable but survivable. A 70%-accurate typist pays ~72 HP and loses on
 * accuracy alone, which is the intent.
 */
export const NINJA_ERROR_HP_TENTHS = 8;

/** Pressure clamps. Neither a fast typist nor a slow one gets a degenerate match. */
export const PRESSURE_MIN = 0.60;
export const PRESSURE_MAX = 1.60;

/**
 * Beat length thresholds, in characters, mapped onto the strike family.
 *
 * A beat's *shape* picks its move, so the paragraph's own rhythm drives the
 * fight: clipped clauses jab, long ones land a crush. Beats ending in `!` or
 * `?` throw a shuriken — a sharp, thrown thing for a sharp, thrown sentence.
 */
const BEAT_MOVE_THRESHOLDS = [
  { maxChars: 18, moveId: 'jab' },
  { maxChars: 40, moveId: 'slash' },
  { maxChars: Infinity, moveId: 'crush' },
];

const SENTENCE_ENDERS = new Set(['.', '!', '?']);
const CLAUSE_BREAKS = new Set([',', ';', ':']);

function moveForBeat(text) {
  const trimmed = text.trim();
  const last = trimmed[trimmed.length - 1];
  if (last === '!' || last === '?') return 'shuriken';
  return BEAT_MOVE_THRESHOLDS.find((t) => trimmed.length <= t.maxChars).moveId;
}

/**
 * Cut a paragraph into beats at sentence and clause boundaries.
 *
 * Coverage is the contract: every character of `text` belongs to exactly one
 * beat, and concatenating `beats[].text` in order reproduces `text` byte for
 * byte. Trailing spaces stay with the beat that precedes them, because the
 * player types those spaces as part of that beat rather than as a prefix to the
 * next one.
 *
 * Very short trailing fragments are merged backwards rather than emitted alone
 * — a one-word beat resolving as a full move would let a two-character clause
 * hit as hard as a sentence.
 */
export function segmentBeats(text) {
  const raw = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!SENTENCE_ENDERS.has(ch) && !CLAUSE_BREAKS.has(ch)) continue;

    // Absorb the delimiter and any run of spaces after it.
    let end = i + 1;
    while (end < text.length && text[end] === ' ') end += 1;
    raw.push({ start, end });
    start = end;
    i = end - 1;
  }
  if (start < text.length) raw.push({ start, end: text.length });

  // Merge fragments shorter than 6 characters into the previous beat.
  const merged = [];
  for (const seg of raw) {
    const len = seg.end - seg.start;
    if (len < 6 && merged.length > 0) {
      merged[merged.length - 1].end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.map((seg, index) => {
    const slice = text.slice(seg.start, seg.end);
    return {
      index,
      start: seg.start,
      end: seg.end,
      text: slice,
      chars: slice.length,
      moveId: moveForBeat(slice),
    };
  });
}

/**
 * Build the scroll for a round.
 *
 * `PASSAGES` (src/lib/content.js) is four multi-sentence prose paragraphs and
 * had no consumer anywhere in the repo — docs/07-migration-audit.md:196 records
 * it as unused. Two are joined so a round has enough text to fight over, chosen
 * deterministically from `(seed, round)` so a replay reproduces the same scroll.
 */
export function buildScroll(seed, round) {
  const state = xorshift32(seedFrom(toU32(seed), round, SCROLL_SALT));
  const first = draw(state);
  const second = draw(first.next);

  const a = Math.floor(first.u * PASSAGES.length);
  // Offset by 1..len-1 so the second passage is never the first one repeated.
  const b = (a + 1 + Math.floor(second.u * (PASSAGES.length - 1))) % PASSAGES.length;

  const text = `${PASSAGES[a]} ${PASSAGES[b]}`;
  return { text, beats: segmentBeats(text) };
}

/** Fresh per-round ninja state. Seat is always 0 — the human. */
export function createNinjaState(seed, round, startedAtMs = 0) {
  const scroll = buildScroll(seed, round);
  return {
    scroll,
    cursor: 0,
    beatIndex: 0,
    beatErrors: 0,
    beatKeystrokes: 0,
    beatStartMs: startedAtMs,
    totalErrors: 0,
    totalKeystrokes: 0,
    totalCorrect: 0,
    startedAtMs,
    seq: 0,
    round,
    complete: false,
  };
}

/**
 * Rolling WPM and accuracy for the current scroll.
 *
 * WPM uses the standard 5-characters-per-word convention already used by
 * `damage.parMs`, computed on *correct* characters so padding the count with
 * mistakes cannot inflate it. Accuracy is correct / total keystrokes.
 */
export function ninjaStats(state, nowMs) {
  const elapsedMs = Math.max(1, nowMs - state.startedAtMs);
  const minutes = elapsedMs / 60000;
  const wpm = minutes > 0 ? state.totalCorrect / 5 / minutes : 0;
  const accuracy = state.totalKeystrokes > 0
    ? state.totalCorrect / state.totalKeystrokes
    : 1;
  return { wpm, accuracy, elapsedMs };
}

/**
 * The opponent-relative damage multiplier.
 *
 * `combat.stepEvent(state, event, allEvents, damageMul)` already takes this as
 * its fourth argument, so scaling output against the opponent needs no reducer
 * change at all. Applied to the player's outgoing beats only — applying it to
 * both sides would compound it twice.
 *
 * Accuracies are fractions in [0,1]. Both denominators are floored away from
 * zero so a stationary or perfect opponent cannot produce Infinity or NaN.
 */
export function pressureFor({
  playerWpm = 0,
  playerAccuracy = 1,
  opponentWpm = 45,
  opponentAccuracy = 0.94,
} = {}) {
  const oppWpm = Math.max(1, opponentWpm);
  const oppAcc = Math.max(0.01, opponentAccuracy);
  const raw = (Math.max(0, playerWpm) / oppWpm) * (Math.max(0, playerAccuracy) / oppAcc);
  const clamped = Math.min(PRESSURE_MAX, Math.max(PRESSURE_MIN, raw));
  // Two decimals: it is shown in the HUD, and a multiplier that decides the
  // match should be legible rather than a 14-digit float.
  return Math.round(clamped * 100) / 100;
}

/**
 * Consume one keystroke.
 *
 * @returns {{ next: object, result: object }} `result.kind` is one of
 *   `'progress' | 'penalty' | 'beat-complete' | 'scroll-complete' | 'noop'`.
 *   `beat-complete` and `scroll-complete` carry a full wire CombatEvent in
 *   `result.event`, ready to hand to `combat.stepEvent`.
 */
export function advanceNinja(state, key, nowMs) {
  if (state.complete) return { next: state, result: { kind: 'noop' } };
  if (typeof key !== 'string' || key.length !== 1) {
    return { next: state, result: { kind: 'noop' } };
  }

  const expected = state.scroll.text[state.cursor];
  const next = { ...state, totalKeystrokes: state.totalKeystrokes + 1, beatKeystrokes: state.beatKeystrokes + 1 };

  if (key !== expected) {
    // Rule 1: a wrong character costs HP immediately, and does NOT advance the
    // cursor — you have to actually type the right one.
    next.beatErrors = state.beatErrors + 1;
    next.totalErrors = state.totalErrors + 1;
    return {
      next,
      result: {
        kind: 'penalty',
        hpLost: NINJA_ERROR_HP_TENTHS,
        char: key,
        expected,
        cursor: state.cursor,
      },
    };
  }

  next.cursor = state.cursor + 1;
  next.totalCorrect = state.totalCorrect + 1;

  const beat = state.scroll.beats[state.beatIndex];
  if (!beat || next.cursor < beat.end) {
    return { next, result: { kind: 'progress', cursor: next.cursor, beatIndex: state.beatIndex } };
  }

  // Beat finished — emit a CombatEvent in the §8.2 wire shape.
  const tStart = state.beatStartMs;
  const tEnd = nowMs;
  const event = {
    seq: state.seq,
    player: 0,
    round: state.round,
    cardIndex: beat.index,
    moveId: beat.moveId,
    chars: beat.chars,
    lane: 'strike',
    outcome: 'complete',
    tStart,
    tEnd,
    keystrokes: next.beatKeystrokes,
    errors: next.beatErrors,
    ikiStats: [
      Math.round(Math.max(1, tEnd - tStart) / Math.max(1, beat.chars)),
      15,
    ],
  };

  next.seq = state.seq + 1;
  next.beatIndex = state.beatIndex + 1;
  next.beatErrors = 0;
  next.beatKeystrokes = 0;
  next.beatStartMs = nowMs;

  const isLast = next.beatIndex >= state.scroll.beats.length;
  if (isLast) next.complete = true;

  return {
    next,
    result: { kind: isLast ? 'scroll-complete' : 'beat-complete', event, beat },
  };
}
