import { describe, expect, it } from 'vitest';
import { accuracyPct, countCorrect, netWPM } from '../../lib/typing.js';

/**
 * The engine's counter arithmetic, extracted.
 *
 * `useTypingEngine` maintains `correctCount` incrementally so that `live` is
 * O(1) instead of rescanning the passage ten times a second. That optimisation
 * is only safe if the incremental total always equals what a full rescan would
 * produce — including across backspaces, word-deletes and auto-indent, which
 * are exactly the paths where an off-by-one hides.
 *
 * This models the same push/back/auto-indent logic against `countCorrect`, the
 * scan it replaces, so the two can be held to agreeing on every sequence.
 * There is no DOM here and no React: the invariant is arithmetic.
 */
function makeCounter(target, { autoIndent = false } = {}) {
  let typed = '';
  const correctAt = [];
  let correctCount = 0;
  const keystrokes = { total: 0, correct: 0 };

  return {
    push(ch) {
      if (typed.length >= target.length) return;
      const expected = target[typed.length];
      const ok = ch === expected;

      keystrokes.total += 1;
      if (ok) keystrokes.correct += 1;

      correctAt[typed.length] = ok;
      if (ok) correctCount += 1;

      let next = typed + ch;
      if (autoIndent && ch === '\n' && ok) {
        while (next.length < target.length && (target[next.length] === ' ' || target[next.length] === '\t')) {
          correctAt[next.length] = true;
          correctCount += 1;
          next += target[next.length];
        }
      }
      typed = next;
    },
    back(wholeWord = false) {
      if (!typed.length) return;
      let next;
      if (wholeWord) {
        const trimmed = typed.replace(/\s+$/, '');
        const cut = trimmed.lastIndexOf(' ');
        next = cut === -1 ? '' : trimmed.slice(0, cut + 1);
      } else {
        next = typed.slice(0, -1);
      }
      for (let i = typed.length - 1; i >= next.length; i--) {
        if (correctAt[i]) correctCount -= 1;
        correctAt[i] = false;
      }
      typed = next;
    },
    type(text) { for (const ch of text) this.push(ch); return this; },
    get typed() { return typed; },
    get correctCount() { return correctCount; },
    get scan() { return countCorrect(target, typed); },
    get accuracy() { return accuracyPct(keystrokes.correct, keystrokes.total); },
  };
}

describe('incremental correct-character count', () => {
  it('matches a full rescan for a clean run', () => {
    const c = makeCounter('the quick brown fox').type('the quick brown fox');
    expect(c.correctCount).toBe(c.scan);
    expect(c.correctCount).toBe(19);
  });

  it('matches a full rescan when mistakes are left standing', () => {
    const c = makeCounter('hello world').type('hallo warld');
    expect(c.correctCount).toBe(c.scan);
    expect(c.correctCount).toBe(9);
  });

  it('gives the character back on a single backspace', () => {
    const c = makeCounter('hello').type('hell');
    expect(c.correctCount).toBe(4);
    c.back();
    expect(c.correctCount).toBe(3);
    expect(c.correctCount).toBe(c.scan);
  });

  it('does not double-count a fixed mistake', () => {
    // Type the wrong letter, delete it, type the right one. One correct
    // character, three keystrokes.
    const c = makeCounter('hello').type('h').type('a');
    expect(c.correctCount).toBe(1);
    c.back();
    c.push('e');
    expect(c.correctCount).toBe(2);
    expect(c.correctCount).toBe(c.scan);
    expect(c.accuracy).toBeCloseTo((2 / 3) * 100, 5);
  });

  it('un-counts a whole word delete', () => {
    const c = makeCounter('the quick brown').type('the quick bro');
    expect(c.correctCount).toBe(13);
    c.back(true); // ctrl+backspace removes "bro"
    expect(c.typed).toBe('the quick ');
    expect(c.correctCount).toBe(10);
    expect(c.correctCount).toBe(c.scan);
  });

  it('counts auto-consumed indentation, and gives it back on delete', () => {
    // Auto-indent copies characters straight out of the target, so they are
    // correct by construction. Not counting them under-reported the WPM of
    // every indented snippet.
    const target = 'if (x) {\n    return 1;\n}';
    const c = makeCounter(target, { autoIndent: true }).type('if (x) {\n');
    expect(c.typed).toBe('if (x) {\n    ');
    expect(c.correctCount).toBe(13);
    expect(c.correctCount).toBe(c.scan);

    c.back();
    expect(c.correctCount).toBe(12);
    expect(c.correctCount).toBe(c.scan);
  });

  it('stays exact across a long mixed sequence', () => {
    const target = 'pack my box with five dozen liquor jugs';
    const c = makeCounter(target);
    c.type('pack my bix');
    c.back();
    c.push('o');
    c.push('x');
    c.type(' with fivv');
    c.back(true);
    c.type('five dozen');
    expect(c.correctCount).toBe(c.scan);
  });
});

describe('rate reporting', () => {
  it('reports raw >= net whenever anything was mistyped', () => {
    const c = makeCounter('hello world').type('hallo world');
    const ms = 10_000;
    const net = netWPM(c.correctCount, ms);
    const raw = netWPM(c.typed.length, ms);
    expect(raw).toBeGreaterThan(net);
  });

  it('is identical to the formula Postgres recomputes in battle_finish', () => {
    // battle_finish: srv_wpm := (correct / 5.0) / (elapsed / 60.0)
    const correct = 250;
    const elapsedSec = 50;
    const server = (correct / 5.0) / (elapsedSec / 60.0);
    expect(netWPM(correct, elapsedSec * 1000)).toBeCloseTo(server, 10);
  });
});
