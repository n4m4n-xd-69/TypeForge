import { describe, expect, it } from 'vitest';
import {
  NINJA_ERROR_HP_TENTHS, PRESSURE_MAX, PRESSURE_MIN,
  advanceNinja, buildScroll, createNinjaState, ninjaStats, pressureFor, segmentBeats,
} from './ninjaFlow.js';
import { PASSAGES } from '../content.js';
import { getMove } from './moveTable.js';
import { initialRoundState } from './roundState.js';
import { stepEvent } from './combat.js';

/**
 * Coverage for the Shadow Ninja prose-flow engine
 * (docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §5).
 *
 * The load-bearing assertion is segmentation coverage: if the beats do not tile
 * the scroll exactly, the player hits a character that belongs to no beat and
 * the round wedges with no way forward.
 */

/** Type the whole scroll perfectly, collecting every emitted event. */
function typePerfectly(state, msPerChar = 60) {
  let s = state;
  const events = [];
  let t = 0;
  let guard = 0;
  while (!s.complete && guard < 10000) {
    const expected = s.scroll.text[s.cursor];
    t += msPerChar;
    const { next, result } = advanceNinja(s, expected, t);
    s = next;
    if (result.event) events.push(result.event);
    guard += 1;
  }
  return { state: s, events };
}

describe('segmentBeats', () => {
  it('tiles the text exactly — no gaps, no overlaps, exact reproduction', () => {
    for (const text of [...PASSAGES, PASSAGES.join(' '), 'One. Two, three; four: five! six?']) {
      const beats = segmentBeats(text);
      expect(beats.map((b) => b.text).join('')).toBe(text);
      expect(beats[0].start).toBe(0);
      expect(beats[beats.length - 1].end).toBe(text.length);
      for (let i = 1; i < beats.length; i += 1) {
        expect(beats[i].start, 'beats must be contiguous').toBe(beats[i - 1].end);
      }
    }
  });

  it('gives every beat a real move from the table', () => {
    for (const beat of segmentBeats(PASSAGES.join(' '))) {
      const move = getMove(beat.moveId); // throws on unknown
      expect(move.lane).toBe('strike');
    }
  });

  it('never emits a beat shorter than 6 characters', () => {
    for (const text of PASSAGES) {
      for (const beat of segmentBeats(text)) {
        expect(beat.chars, `short beat: ${JSON.stringify(beat.text)}`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('throws a shuriken for beats that end in ! or ?', () => {
    expect(segmentBeats('Who dares to stand there?')[0].moveId).toBe('shuriken');
    expect(segmentBeats('Strike them down now!')[0].moveId).toBe('shuriken');
  });

  it('scales the move with the clause length', () => {
    expect(segmentBeats('A short one.')[0].moveId).toBe('jab');
    expect(segmentBeats('A somewhat longer clause than that.')[0].moveId).toBe('slash');
    expect(
      segmentBeats('An extremely long clause that simply keeps going well past any reasonable stopping point.')[0].moveId,
    ).toBe('crush');
  });

  it('handles text with no terminal punctuation at all', () => {
    const beats = segmentBeats('no punctuation here at all');
    expect(beats.map((b) => b.text).join('')).toBe('no punctuation here at all');
    expect(beats).toHaveLength(1);
  });
});

describe('buildScroll', () => {
  it('is deterministic in (seed, round)', () => {
    expect(buildScroll(1, 1)).toEqual(buildScroll(1, 1));
    expect(buildScroll(1, 2)).not.toEqual(buildScroll(1, 1));
  });

  it('joins two different passages, never the same one twice', () => {
    for (let round = 1; round <= 40; round += 1) {
      const { text } = buildScroll(7, round);
      const used = PASSAGES.filter((p) => text.includes(p));
      expect(used.length, `round ${round} did not use two distinct passages`).toBe(2);
    }
  });

  it('produces beats that tile its own text', () => {
    const scroll = buildScroll(3, 1);
    expect(scroll.beats.map((b) => b.text).join('')).toBe(scroll.text);
  });
});

describe('advanceNinja', () => {
  it('advances on a correct character', () => {
    const s = createNinjaState(1, 1, 0);
    const { next, result } = advanceNinja(s, s.scroll.text[0], 10);
    expect(result.kind).toBe('progress');
    expect(next.cursor).toBe(1);
    expect(next.totalCorrect).toBe(1);
    expect(next.totalErrors).toBe(0);
  });

  /** Rule 1: a wrong character costs HP and does NOT advance the cursor. */
  it('charges HP for a wrong character and holds the cursor', () => {
    const s = createNinjaState(1, 1, 0);
    const wrong = s.scroll.text[0] === 'z' ? 'q' : 'z';
    const { next, result } = advanceNinja(s, wrong, 10);
    expect(result.kind).toBe('penalty');
    expect(result.hpLost).toBe(NINJA_ERROR_HP_TENTHS);
    expect(result.expected).toBe(s.scroll.text[0]);
    expect(next.cursor).toBe(0);
    expect(next.totalErrors).toBe(1);
    expect(next.totalKeystrokes).toBe(1);
    expect(next.totalCorrect).toBe(0);
  });

  it('counts a keystroke whether it lands or not', () => {
    const s = createNinjaState(1, 1, 0);
    const wrong = s.scroll.text[0] === 'z' ? 'q' : 'z';
    const a = advanceNinja(s, wrong, 5).next;
    const b = advanceNinja(a, a.scroll.text[0], 10).next;
    expect(b.totalKeystrokes).toBe(2);
    expect(b.totalCorrect).toBe(1);
    expect(b.totalErrors).toBe(1);
  });

  it('ignores non-character keys', () => {
    const s = createNinjaState(1, 1, 0);
    for (const key of ['Enter', 'Shift', 'ArrowLeft', '', null, undefined]) {
      const { next, result } = advanceNinja(s, key, 10);
      expect(result.kind).toBe('noop');
      expect(next).toBe(s);
    }
  });

  it('emits a wire CombatEvent when a beat completes', () => {
    const s = createNinjaState(1, 1, 0);
    const { events } = typePerfectly(s);
    expect(events.length).toBe(s.scroll.beats.length);
    for (const [i, event] of events.entries()) {
      expect(event).toMatchObject({
        player: 0, round: 1, outcome: 'complete', lane: 'strike', errors: 0,
      });
      expect(event.seq).toBe(i);
      expect(event.cardIndex).toBe(i);
      expect(event.chars).toBe(s.scroll.beats[i].chars);
      expect(event.moveId).toBe(s.scroll.beats[i].moveId);
      expect(event.tEnd).toBeGreaterThan(event.tStart);
      expect(Array.isArray(event.ikiStats)).toBe(true);
    }
  });

  it('marks the scroll complete on the final beat and then no-ops', () => {
    const { state } = typePerfectly(createNinjaState(1, 1, 0));
    expect(state.complete).toBe(true);
    expect(state.cursor).toBe(state.scroll.text.length);
    const after = advanceNinja(state, 'a', 99999);
    expect(after.result.kind).toBe('noop');
  });

  /**
   * The whole point of routing beats through the shared reducer: ninja damage
   * is the tested damage. A perfect scroll must actually hurt the opponent.
   */
  it('its events fold through the real combat reducer and deal damage', () => {
    const { events } = typePerfectly(createNinjaState(1, 1, 0));
    const folded = events.reduce((st, ev) => stepEvent(st, ev, events), initialRoundState());
    expect(folded.hp[1]).toBeLessThan(1000);
    expect(folded.hp[0]).toBe(1000); // untouched — the bot never acted here
    expect(folded.focus[0]).toBeGreaterThan(0);
    expect(folded.chain[0]).toBe(events.length); // clean run, chain never broke
  });

  /**
   * Errors must reduce a beat's output, via `precisionFactor`.
   *
   * Folded over the first three beats only, deliberately. A full clean scroll
   * deals more than a full 100.0 HP bar, so both runs bottom out at the
   * `clampHp` floor of 0 and the comparison becomes vacuous — which is exactly
   * what an earlier version of this test did. (That is also a useful balance
   * fact: a round ends by KO long before the scroll is exhausted, so the scroll
   * is a reservoir, not a target.)
   */
  it('errors reduce the damage a beat deals', () => {
    const PREFIX = 3;
    const foldPrefix = (events) => {
      const head = events.slice(0, PREFIX);
      return head.reduce((st, ev) => stepEvent(st, ev, head), initialRoundState()).hp[1];
    };

    const clean = typePerfectly(createNinjaState(5, 1, 0));
    const cleanHp = foldPrefix(clean.events);

    // Same scroll, but miss one character at the start of every beat.
    let s = createNinjaState(5, 1, 0);
    const events = [];
    let t = 0;
    let lastBeat = -1;
    let guard = 0;
    while (!s.complete && guard < 20000) {
      t += 60;
      if (s.beatIndex !== lastBeat) {
        lastBeat = s.beatIndex;
        const wrong = s.scroll.text[s.cursor] === 'z' ? 'q' : 'z';
        s = advanceNinja(s, wrong, t).next;
        t += 60;
      }
      const { next, result } = advanceNinja(s, s.scroll.text[s.cursor], t);
      s = next;
      if (result.event) events.push(result.event);
      guard += 1;
    }
    const sloppyHp = foldPrefix(events);

    expect(s.totalErrors).toBeGreaterThan(0);
    expect(events[0].errors).toBe(1);
    // Neither run may have hit the floor, or the comparison proves nothing.
    expect(cleanHp).toBeGreaterThan(0);
    expect(sloppyHp).toBeGreaterThan(cleanHp); // less damage dealt => more HP left
  });

  it('a clean full scroll deals more than a full health bar', () => {
    // Documents the reservoir property the test above depends on.
    const { events } = typePerfectly(createNinjaState(5, 1, 0));
    const total = events.reduce((st, ev) => stepEvent(st, ev, events), initialRoundState());
    expect(total.hp[1]).toBe(0);
  });
});

describe('ninjaStats', () => {
  it('reports zero-ish stats on a fresh state without dividing by zero', () => {
    const stats = ninjaStats(createNinjaState(1, 1, 0), 0);
    expect(Number.isFinite(stats.wpm)).toBe(true);
    expect(stats.accuracy).toBe(1);
  });

  it('computes WPM from correct characters only', () => {
    // 50 correct chars in 60s = 10 words / 1 min = 10 wpm.
    const state = { ...createNinjaState(1, 1, 0), totalCorrect: 50, totalKeystrokes: 50, startedAtMs: 0 };
    expect(ninjaStats(state, 60000).wpm).toBeCloseTo(10, 5);
  });

  it('accuracy is correct over total keystrokes', () => {
    const state = { ...createNinjaState(1, 1, 0), totalCorrect: 90, totalKeystrokes: 100 };
    expect(ninjaStats(state, 60000).accuracy).toBeCloseTo(0.9, 5);
  });
});

describe('pressureFor', () => {
  it('is 1.00 when both sides are identical', () => {
    expect(pressureFor({
      playerWpm: 50, playerAccuracy: 0.95, opponentWpm: 50, opponentAccuracy: 0.95,
    })).toBe(1);
  });

  it('rises when the player is faster and cleaner', () => {
    const p = pressureFor({
      playerWpm: 70, playerAccuracy: 0.99, opponentWpm: 50, opponentAccuracy: 0.90,
    });
    expect(p).toBeGreaterThan(1);
    expect(p).toBeLessThanOrEqual(PRESSURE_MAX);
  });

  it('falls when the player is slower and sloppier', () => {
    const p = pressureFor({
      playerWpm: 30, playerAccuracy: 0.85, opponentWpm: 60, opponentAccuracy: 0.98,
    });
    expect(p).toBeLessThan(1);
    expect(p).toBeGreaterThanOrEqual(PRESSURE_MIN);
  });

  it('clamps both ends', () => {
    expect(pressureFor({ playerWpm: 500, playerAccuracy: 1, opponentWpm: 10, opponentAccuracy: 0.5 })).toBe(PRESSURE_MAX);
    expect(pressureFor({ playerWpm: 1, playerAccuracy: 0.1, opponentWpm: 200, opponentAccuracy: 1 })).toBe(PRESSURE_MIN);
  });

  it('never returns NaN or Infinity for degenerate opponents', () => {
    for (const bad of [
      { opponentWpm: 0, opponentAccuracy: 0 },
      { opponentWpm: -5, opponentAccuracy: -1 },
      { playerWpm: 0, playerAccuracy: 0, opponentWpm: 0, opponentAccuracy: 0 },
    ]) {
      const p = pressureFor(bad);
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(PRESSURE_MIN);
      expect(p).toBeLessThanOrEqual(PRESSURE_MAX);
    }
  });

  it('works with no arguments at all', () => {
    expect(Number.isFinite(pressureFor())).toBe(true);
  });

  it('is legible to two decimals for the HUD readout', () => {
    const p = pressureFor({ playerWpm: 63, playerAccuracy: 0.97, opponentWpm: 45, opponentAccuracy: 0.94 });
    expect(p).toBe(Math.round(p * 100) / 100);
  });
});
