import { describe, expect, it } from 'vitest';
import {
  AVATARS, COUNTDOWN_MS, createSession, nextRound, press, restart, tick, view,
} from './arenaSession.js';
import * as trialEngine from './trialEngine.js';
import { ROUND_TIME_CAP_MS } from './combat.js';

/**
 * The integration test that was missing.
 *
 * Shadow Battle's Trial mode shipped non-functional — typing threw `TypeError`
 * on every keystroke, the bot never moved, HP never changed — while all 298
 * tests passed, because every one of them tested the pure combat maths and
 * `ui.test.js` only asserted `toBeDefined()` on the components. **Nothing ever
 * called the engine the way the UI called it.**
 *
 * So this file does exactly that, through the real facade: build a session,
 * feed real keystrokes, run the clock, and assert a match actually progresses
 * from countdown to a settled result. See
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §2.
 */

/**
 * Walk the countdown to its end and enter combat.
 *
 * Reads the session's own `tCombatStart` rather than assuming `COUNTDOWN_MS`,
 * because rounds after the first start from a later baseline.
 */
function enterCombat(session) {
  const { session: s, result } = tick(session, session.tCombatStart);
  expect(result.kind).toBe('combat-start');
  expect(s.phase).toBe('combat');
  return s;
}

/** Type a stickman lane's word to completion, returning the last result. */
function typeLane(session, laneId, startMs = COUNTDOWN_MS + 10, msPerChar = 50) {
  const v = view(session, startMs);
  const lane = v.deck.lanes.find((l) => l.id === laneId);
  if (!lane) throw new Error(`no lane ${laneId} in deck: ${v.deck.lanes.map((l) => l.id)}`);

  let s = session;
  let result = { kind: 'noop' };
  let t = startMs;
  for (const ch of lane.word) {
    t += msPerChar;
    ({ session: s, result } = press(s, ch, t));
  }
  return { session: s, result, lane, endedAtMs: t };
}

describe('regression — trialEngine has no undefined-reference exports', () => {
  it('every exported function is callable without a ReferenceError', () => {
    // `tickBot` used to call an undefined `stepTrialRound`. It is gone; this
    // asserts nothing like it came back.
    expect(trialEngine.tickBot).toBeUndefined();
    for (const [name, value] of Object.entries(trialEngine)) {
      if (typeof value !== 'function') continue;
      try {
        value(undefined, undefined, undefined);
      } catch (err) {
        expect(err, `${name} threw ReferenceError: ${err.message}`).not.toBeInstanceOf(ReferenceError);
      }
    }
  });
});

describe('createSession', () => {
  it('opens on a countdown with full health and no focus', () => {
    const v = view(createSession(), 0);
    expect(v.phase).toBe('countdown');
    expect(v.hp).toEqual([1000, 1000]);
    expect(v.focus).toEqual([0, 0]);
    expect(v.chain).toEqual([0, 0]);
    expect(v.scores).toEqual([0, 0]);
    expect(v.round).toBe(1);
  });

  it('names the opponent from the bot profile when not given one', () => {
    expect(view(createSession({ botProfile: 'ronin' }), 0).opponentName).toBe('Ronin');
  });

  it('falls back to Adept for an unknown bot profile', () => {
    expect(view(createSession({ botProfile: 'nope' }), 0).opponentName).toBe('Adept');
  });

  it('ignores input during the countdown', () => {
    const s = createSession();
    expect(press(s, 'a', 10).result.kind).toBe('noop');
  });

  it('is deterministic for a given seed and avatar', () => {
    const a = view(enterCombat(createSession({ seed: 42 })), COUNTDOWN_MS);
    const b = view(enterCombat(createSession({ seed: 42 })), COUNTDOWN_MS);
    expect(b.deck).toEqual(a.deck);
  });
});

describe('stickman avatar', () => {
  it('presents three named lanes with words', () => {
    const v = view(enterCombat(createSession({ avatar: AVATARS.STICKMAN })), COUNTDOWN_MS);
    expect(v.deck.lanes.map((l) => l.id)).toEqual(['fight', 'shield', 'jump']);
    for (const lane of v.deck.lanes) {
      expect(lane.word.length).toBeGreaterThan(0);
      expect(lane.typed).toBe(0);
      expect(lane.committed).toBe(false);
    }
  });

  it('commits a lane on its first character and reports progress', () => {
    const s = enterCombat(createSession());
    const v = view(s, COUNTDOWN_MS);
    const fight = v.deck.lanes.find((l) => l.id === 'fight');

    const { session: s2, result } = press(s, fight.word[0], COUNTDOWN_MS + 10);
    expect(result.kind).toBe('lane-commit');
    expect(result.lane).toBe('fight');

    const v2 = view(s2, COUNTDOWN_MS + 10);
    expect(v2.deck.lanes.find((l) => l.id === 'fight')).toMatchObject({ committed: true, typed: 1 });
    expect(v2.deck.lanes.find((l) => l.id === 'shield')).toMatchObject({ dimmed: true });
    expect(v2.deck.lanes.find((l) => l.id === 'jump')).toMatchObject({ dimmed: true });
  });

  it('whiffs and loses Focus on a character matching no lane', () => {
    const s = enterCombat(createSession());
    const v = view(s, COUNTDOWN_MS);
    const taken = new Set(v.deck.lanes.map((l) => l.word[0].toLowerCase()));
    const unused = 'abcdefghijklmnopqrstuvwxyz'.split('').find((c) => !taken.has(c));

    const { session: s2, result } = press(s, unused, COUNTDOWN_MS + 10);
    expect(result).toMatchObject({ kind: 'whiff', seat: 0, focusLost: 3 });
    // Focus was already 0 and clamps there rather than going negative.
    expect(view(s2, COUNTDOWN_MS + 10).focus[0]).toBe(0);
  });

  /** The assertion that was impossible before: typing must damage the opponent. */
  it('completing the Fight lane damages the opponent and grants Focus', () => {
    const s = enterCombat(createSession());
    const { session: s2, result } = typeLane(s, 'fight');

    expect(result.kind).toBe('resolve');
    expect(result.seat).toBe(0);
    expect(result.damage).toBeGreaterThan(0);

    const v = view(s2, COUNTDOWN_MS + 500);
    expect(v.hp[1]).toBeLessThan(1000);
    expect(v.hp[0]).toBe(1000);
    expect(v.focus[0]).toBeGreaterThan(0);
    expect(v.chain[0]).toBe(1);
  });

  it('Shield deals no damage but banks Focus', () => {
    const s = enterCombat(createSession());
    const { session: s2, result } = typeLane(s, 'shield');
    expect(result.kind).toBe('resolve');
    expect(result.damage).toBe(0);
    expect(view(s2, COUNTDOWN_MS + 500).focus[0]).toBeGreaterThan(0);
  });

  it('Jump resolves as Evade — no damage, no heal, Focus only', () => {
    const s = enterCombat(createSession());
    const { session: s2, result } = typeLane(s, 'jump');
    expect(result).toMatchObject({ kind: 'resolve', lane: 'jump', moveId: 'evade', damage: 0, healed: 0 });
    const v = view(s2, COUNTDOWN_MS + 500);
    expect(v.hp[0]).toBe(1000); // did NOT heal — the old fall-through would have
    expect(v.focus[0]).toBe(5);
  });

  it('deals a new deck after each resolution, so the keys move', () => {
    const s = enterCombat(createSession());
    const before = view(s, COUNTDOWN_MS).deck.lanes.map((l) => l.word);
    const { session: s2 } = typeLane(s, 'fight');
    const after = view(s2, COUNTDOWN_MS + 500).deck.lanes.map((l) => l.word);
    expect(after).not.toEqual(before);
  });

  it('a wrong character mid-word costs accuracy but does not advance', () => {
    const s = enterCombat(createSession());
    const v = view(s, COUNTDOWN_MS);
    const fight = v.deck.lanes.find((l) => l.id === 'fight');
    let cur = press(s, fight.word[0], COUNTDOWN_MS + 10).session;

    const wrong = fight.word[1] === 'z' ? 'q' : 'z';
    const { session: s3, result } = press(cur, wrong, COUNTDOWN_MS + 20);
    expect(result).toMatchObject({ kind: 'progress', miss: true, typed: 1 });
    expect(view(s3, COUNTDOWN_MS + 20).deck.lanes.find((l) => l.id === 'fight').typed).toBe(1);
  });
});

describe('ninja avatar', () => {
  it('presents a scroll of prose with a cursor', () => {
    const v = view(enterCombat(createSession({ avatar: AVATARS.NINJA })), COUNTDOWN_MS);
    expect(v.avatar).toBe('ninja');
    expect(v.scroll.text.length).toBeGreaterThan(100);
    expect(v.scroll.cursor).toBe(0);
    expect(v.scroll.beats.length).toBeGreaterThan(1);
    expect(v.deck).toBeUndefined();
  });

  it('advances the cursor on a correct character', () => {
    const s = enterCombat(createSession({ avatar: AVATARS.NINJA }));
    const v = view(s, COUNTDOWN_MS);
    const { session: s2, result } = press(s, v.scroll.text[0], COUNTDOWN_MS + 10);
    expect(result.kind).toBe('progress');
    expect(view(s2, COUNTDOWN_MS + 10).scroll.cursor).toBe(1);
  });

  /** Rule 1: a wrong character costs the typist HP immediately. */
  it('charges the typist HP for a wrong character', () => {
    const s = enterCombat(createSession({ avatar: AVATARS.NINJA }));
    const v = view(s, COUNTDOWN_MS);
    const wrong = v.scroll.text[0] === 'z' ? 'q' : 'z';

    const { session: s2, result } = press(s, wrong, COUNTDOWN_MS + 10);
    expect(result).toMatchObject({ kind: 'penalty', seat: 0, hpLost: v.errorHpCost });

    const v2 = view(s2, COUNTDOWN_MS + 10);
    expect(v2.hp[0]).toBe(1000 - v.errorHpCost);
    expect(v2.scroll.cursor).toBe(0); // cursor held
  });

  it('completing a beat damages the opponent and reports pressure', () => {
    let s = enterCombat(createSession({ avatar: AVATARS.NINJA }));
    let result = { kind: 'noop' };
    let t = COUNTDOWN_MS;
    let guard = 0;

    while (result.kind !== 'resolve' && guard < 400) {
      const v = view(s, t);
      t += 50;
      ({ session: s, result } = press(s, v.scroll.text[v.scroll.cursor], t));
      guard += 1;
    }

    expect(result.kind).toBe('resolve');
    expect(result.damage).toBeGreaterThan(0);
    expect(result.pressure).toBeGreaterThanOrEqual(0.60);
    expect(result.pressure).toBeLessThanOrEqual(1.60);
    expect(view(s, t).hp[1]).toBeLessThan(1000);
  });

  it('exposes WPM, accuracy and pressure for the HUD', () => {
    const v = view(enterCombat(createSession({ avatar: AVATARS.NINJA })), COUNTDOWN_MS + 1000);
    expect(Number.isFinite(v.wpm)).toBe(true);
    expect(Number.isFinite(v.accuracy)).toBe(true);
    expect(Number.isFinite(v.pressure)).toBe(true);
  });
});

describe('the bot actually acts', () => {
  /**
   * The other thing that silently never happened. Runs the clock across the
   * bot's reaction window and asserts it emits, damages, and is observable.
   */
  it('emits events and damages the player over time', () => {
    let s = enterCombat(createSession({ botProfile: 'shade' })); // fastest profile
    let sawResolve = false;
    let t = COUNTDOWN_MS;

    for (let i = 0; i < 600 && !sawResolve; i += 1) {
      t += 100;
      const { session: next, result } = tick(s, t);
      s = next;
      if (result.kind === 'resolve' && result.seat === 1) sawResolve = true;
      if (result.kind === 'round-end' || result.kind === 'match-end') break;
    }

    expect(sawResolve, 'the bot never emitted a resolve in 60s of ticks').toBe(true);
    expect(view(s, t).hp[0]).toBeLessThan(1000);
  });
});

describe('round and match lifecycle', () => {
  it('ends the round on the time cap and awards it on HP', () => {
    const s = enterCombat(createSession());
    const { session: s2 } = typeLane(s, 'fight'); // put the player ahead
    const { session: s3, result } = tick(s2, COUNTDOWN_MS + ROUND_TIME_CAP_MS + 1);

    expect(result.kind).toBe('round-end');
    expect(result.reason).toBe('timeout');
    expect(result.winner).toBe(0);
    expect(s3.phase).toBe('round-over');
    expect(view(s3, 0).scores).toEqual([1, 0]);
  });

  it('nextRound resets HP and Focus but keeps the score', () => {
    const s = enterCombat(createSession());
    const { session: s2 } = typeLane(s, 'fight');
    const { session: s3 } = tick(s2, COUNTDOWN_MS + ROUND_TIME_CAP_MS + 1);

    const s4 = nextRound(s3, 0);
    const v = view(s4, 0);
    expect(v.round).toBe(2);
    expect(v.phase).toBe('countdown');
    expect(v.hp).toEqual([1000, 1000]);
    expect(v.focus).toEqual([0, 0]);
    expect(v.scores).toEqual([1, 0]);
  });

  it('nextRound is a no-op unless the round is over', () => {
    const s = enterCombat(createSession());
    expect(nextRound(s, 0)).toBe(s);
  });

  it('reaches a match end after enough round wins', () => {
    let s = createSession();
    let base = 0;
    let guard = 0;

    while (s.phase !== 'match-over' && guard < 8) {
      s = enterCombat(s);
      // Land one Fight to go ahead on HP, then run the clock to the cap so the
      // round settles on HP rather than waiting for a KO.
      s = typeLane(s, 'fight', s.tCombatStart + 10).session;
      if (s.phase === 'combat') {
        s = tick(s, s.tCombatStart + ROUND_TIME_CAP_MS + 1).session;
      }
      if (s.phase === 'round-over') {
        base = s.tCombatStart + ROUND_TIME_CAP_MS + 10;
        s = nextRound(s, base);
      }
      guard += 1;
    }

    expect(s.phase).toBe('match-over');
    const v = view(s, 0);
    expect(v.matchOutcome).toBeTruthy();
    expect(['win', 'loss', 'draw']).toContain(v.matchOutcome.outcome);
    expect(Math.max(...v.scores)).toBeGreaterThanOrEqual(2);
  });

  it('ignores input once the match is over', () => {
    let s = createSession();
    s = { ...s, phase: 'match-over' };
    expect(press(s, 'a', 999).result.kind).toBe('noop');
    expect(tick(s, 999).result.kind).toBe('noop');
  });

  it('restart returns a fresh countdown with the same configuration', () => {
    const s = enterCombat(createSession({ avatar: AVATARS.NINJA, botProfile: 'ronin' }));
    const fresh = restart(s, 0);
    const v = view(fresh, 0);
    expect(v.phase).toBe('countdown');
    expect(v.avatar).toBe('ninja');
    expect(v.opponentName).toBe('Ronin');
    expect(v.scores).toEqual([0, 0]);
    expect(v.hp).toEqual([1000, 1000]);
  });
});

describe('view is a flat projection', () => {
  it('never exposes engine internals the old UI reached for', () => {
    const v = view(enterCombat(createSession()), COUNTDOWN_MS);
    // The old component read `match.currentRoundState.hp` — a field that never
    // existed anywhere in the engine.
    expect(v.currentRoundState).toBeUndefined();
    expect(v.roundState).toBeUndefined();
    expect(v.events).toBeUndefined();
    expect(v.bot).toBeUndefined();
    // and does expose flat, render-ready values instead
    expect(Array.isArray(v.hp)).toBe(true);
    expect(typeof v.secondsLeft).toBe('number');
  });

  it('reports a sane countdown and clock', () => {
    const s = createSession();
    expect(view(s, 0).countdownLeft).toBe(4);
    expect(view(s, COUNTDOWN_MS - 500).countdownLeft).toBe(1);
    const combat = enterCombat(s);
    expect(view(combat, COUNTDOWN_MS).secondsLeft).toBe(90);
    expect(view(combat, COUNTDOWN_MS + 30000).secondsLeft).toBe(60);
  });
});
