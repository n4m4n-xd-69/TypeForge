import { describe, it, expect } from 'vitest';
import { toU32, seedFrom } from './prng.js';
import { card } from './wordQueue.js';
import { resolveForPlayer } from './cardResolution.js';

function stateWith(overrides) {
  return { hp: [1000, 1000], focus: [0, 0], ...overrides };
}

describe('resolveForPlayer — Overdrive (§10.2)', () => {
  it('overrides the strike slot when this player\'s Focus is exactly 100', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [100, 0] });
    const resolved = resolveForPlayer(1, 1, 5, base, state, 0);
    expect(resolved.strikeMove).toBe('overdrive');
    expect(resolved.strikeWord.length).toBeGreaterThanOrEqual(14);
    expect(resolved.strikeWord.length).toBeLessThanOrEqual(24);
  });

  it('does not override at Focus 99', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [99, 0] });
    const resolved = resolveForPlayer(1, 1, 5, base, state, 0);
    expect(resolved.strikeMove).toBe(base.strikeMove);
  });

  it('never touches the guard slot', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [100, 0], hp: [600, 1000] });
    const resolved = resolveForPlayer(1, 1, 5, base, state, 0);
    expect(resolved.guardMove).toBe(base.guardMove);
    expect(resolved.guardWord).toBe(base.guardWord);
  });

  it('only affects the player whose Focus is 100', () => {
    const base = card(1, 1, 5, 'steel');
    const state = stateWith({ focus: [100, 0] });
    const resolvedForPlayer1 = resolveForPlayer(1, 1, 5, base, state, 1);
    expect(resolvedForPlayer1.strikeMove).toBe(base.strikeMove);
  });
});

describe('resolveForPlayer — Mend (§10.3-10.4, SB-MOV-3)', () => {
  it('keeps a Mend candidate when this player is eligible (HP<70 tenths=700 and Focus>=25)', () => {
    // Search for a seed/index whose base guard candidate is Mend, so the
    // test genuinely exercises the "kept" branch rather than vacuously
    // passing because the candidate was never Mend to begin with.
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull(); // sanity: found a Mend candidate to test against
    const state = stateWith({ hp: [600, 1000], focus: [30, 0] }); // HP 60.0, Focus 30 -- eligible
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.guardMove).toBe('mend');
    expect(resolved.guardWord).toBe(base.guardWord);
  });

  it('rerolls to Guard or Parry when this player is not eligible', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull(); // sanity: found a Mend candidate to test against
    const state = stateWith({ hp: [1000, 1000], focus: [30, 0] }); // HP 100.0 -- not <70, ineligible
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(['guard', 'parry']).toContain(resolved.guardMove);
    const [min, max] = { guard: [2, 4], parry: [3, 5] }[resolved.guardMove];
    expect(resolved.guardWord.length).toBeGreaterThanOrEqual(min);
    expect(resolved.guardWord.length).toBeLessThanOrEqual(max);
  });

  it('never touches the strike slot', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull(); // sanity: found a Mend candidate to test against
    const state = stateWith({ hp: [1000, 1000], focus: [30, 0] });
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.strikeMove).toBe(base.strikeMove);
    expect(resolved.strikeWord).toBe(base.strikeWord);
  });

  it('a Mend candidate still rerolls to Guard/Parry when ineligible, even with Focus at 100 (Overdrive active)', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull();
    const state = stateWith({ hp: [1000, 1000], focus: [100, 0] }); // Focus 100 (Overdrive fires) AND HP 100.0 -- Mend-ineligible
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(['guard', 'parry']).toContain(resolved.guardMove);
  });

  it('leaves a non-Mend candidate (Guard/Parry) completely alone', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove !== 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull(); // sanity: found a non-Mend candidate to test against
    const state = stateWith({ hp: [50, 1000], focus: [90, 0] }); // eligible-looking, irrelevant since candidate isn't Mend
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.guardMove).toBe(base.guardMove);
    expect(resolved.guardWord).toBe(base.guardWord);
  });
});

describe('resolveForPlayer — salted draws never desync the shared base sequence', () => {
  it('resolving for player 0 does not change what card() itself returns for the next index', () => {
    const base5 = card(9, 1, 5, 'ember');
    resolveForPlayer(9, 1, 5, base5, stateWith({ focus: [100, 0] }), 0);
    const base6Before = card(9, 1, 6, 'ember');
    resolveForPlayer(9, 1, 5, base5, stateWith({ focus: [100, 0] }), 0); // resolve again
    const base6After = card(9, 1, 6, 'ember');
    expect(base6After).toEqual(base6Before);
  });

  it('two players resolving the same base pair with different states never contaminate each other', () => {
    const base = card(9, 1, 5, 'ember');
    const p0Resolved = resolveForPlayer(9, 1, 5, base, stateWith({ focus: [100, 40] }), 0);
    const p1Resolved = resolveForPlayer(9, 1, 5, base, stateWith({ focus: [100, 40] }), 1);
    // player 1 has the same Focus (40, not 100) regardless of resolving
    // player 0 first -- re-resolve player 1 alone and confirm it matches.
    const p1Alone = resolveForPlayer(9, 1, 5, base, stateWith({ focus: [100, 40] }), 1);
    expect(p1Resolved).toEqual(p1Alone);
  });
});

describe('seedFrom — guards against xorshift32(0) fixed point', () => {
  it('never produces a 0 seed across many (seed, round, index, player, salt) combinations shaped like overrideSeed\'s', () => {
    const salts = [0x4F564552, 0x4D454E44]; // OVERDRIVE_SALT, MEND_REROLL_SALT
    let zeros = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      for (let round = 1; round <= 5; round += 1) {
        for (let index = 0; index < 20; index += 1) {
          for (const player of [1, 2]) { // player + 1, as overrideSeed passes it
            for (const salt of salts) {
              total += 1;
              const combined = seedFrom(toU32(seed), round, index, player, salt);
              if (combined === 0) zeros += 1;
            }
          }
        }
      }
    }
    expect(zeros).toBe(0);
    expect(total).toBeGreaterThan(1000);
  });
});

describe('resolveForPlayer — Overdrive and Mend fire independently and simultaneously', () => {
  it('both overrides apply when player is eligible for both (Focus=100 and HP<700/Focus>=25)', () => {
    // Search for a seed/index whose base pair has guardMove='mend'
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(7, 1, index, 'steel');
      if (candidate.guardMove === 'mend') { base = candidate; break; }
      index += 1;
    }
    expect(base).not.toBeNull(); // sanity: found a Mend candidate

    // Set state: Focus=100 (Overdrive eligible) and HP=600, Focus=100 (Mend eligible: hp<700 && focus>=25)
    const state = stateWith({ focus: [100, 0], hp: [600, 1000] });
    const resolved = resolveForPlayer(7, 1, index, base, state, 0);

    // Overdrive should override strike
    expect(resolved.strikeMove).toBe('overdrive');
    expect(resolved.strikeWord.length).toBeGreaterThanOrEqual(14);
    expect(resolved.strikeWord.length).toBeLessThanOrEqual(24);

    // Mend should NOT be rerolled (player is eligible: hp < 700 && focus >= 25)
    expect(resolved.guardMove).toBe('mend');
    expect(resolved.guardWord).toBe(base.guardWord);
  });
});

/**
 * SB-WRD-1 regression — the Mend re-roll used to void the distinct-first-
 * character guarantee.
 *
 * `wordQueue.card()` guarantees the strike and guard words start with
 * different characters, because that first character is how a lane is
 * committed to: if two lanes share it, one of them is unreachable for that
 * card and the player cannot choose to defend. The Mend gate above re-draws
 * `guardWord` from a different bank and length range, and originally did not
 * re-check that guarantee.
 *
 * Measured before the fix, over 2250 cards (3 bands x 5 rounds x 150 indices,
 * seed 1): `card()` produced 0 collisions, the Mend re-roll fired 630 times
 * and produced 23 collisions — roughly 1 card in 100 across all play, each one
 * a card with an unreachable Guard lane. Example: base `planet`/`morning`
 * (mend) re-rolled to `planet`/`part`, so typing `p` always took Strike.
 */
describe('resolveForPlayer — SB-WRD-1 survives the Mend re-roll', () => {
  const BANDS = ['ember', 'steel', 'damascus'];

  it('never returns two words sharing a first character, across a wide sweep', () => {
    let checked = 0;
    let rerolls = 0;
    // Spread across rounds rather than deep into indices: resolveStrikeMove
    // recurses on index-1 for SB-MOV-4, so a sweep is O(n^2) in the index
    // bound. 12 x 40 covers as many cards as 5 x 150 for a tenth of the work.
    // (The 150-index version intermittently exceeded vitest's 5s default under
    // parallel load, making this test flaky.)
    for (const seed of [1, 0xbeef, 7]) {
      for (const band of BANDS) {
        for (let round = 1; round <= 12; round += 1) {
          for (let index = 0; index < 40; index += 1) {
            const base = card(seed, round, index, band);
            // Fresh state: HP 1000 / Focus 0 fails the Mend gate, which is
            // exactly the branch that used to break the guarantee.
            const resolved = resolveForPlayer(seed, round, index, base, stateWith({}), 0);
            if (resolved.guardMove !== base.guardMove) rerolls += 1;
            expect(
              resolved.guardWord[0].toLowerCase(),
              `collision at seed=${seed} band=${band} round=${round} index=${index}: ` +
                `${resolved.strikeWord}/${resolved.guardWord} (base ${base.strikeWord}/${base.guardWord} ${base.guardMove})`,
            ).not.toBe(resolved.strikeWord[0].toLowerCase());
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4000);
    // Proves the sweep actually exercised the re-roll branch rather than
    // passing because the gate never fired.
    expect(rerolls).toBeGreaterThan(500);
  }, 20000);

  /**
   * Scope note, and why this is not widened.
   *
   * When Overdrive replaces `strikeWord` with a phrase, the *unrerolled* base
   * `guardWord` can share its first character — the base pair was checked
   * against the original strike word, not the phrase that replaced it.
   *
   * That is deliberately NOT fixed here, because the Overdrive branch is
   * explicitly forbidden from touching the guard slot ("never touches the
   * guard slot", above, pins `resolved.guardWord === base.guardWord`), and
   * because the collision is unreachable in play: Overdrive is a commitment,
   * so every consumer collapses to a single lane. `laneDeck.deckFor` returns
   * exactly one lane when `overdrive` is true, and `CardLane` renders one
   * bubble. With one lane presented there is no first-character contest.
   *
   * So the real invariant is "whenever two lanes are *presented*, their first
   * characters differ" — which is what this asserts.
   */
  it('leaves the Overdrive pair alone, because Overdrive presents a single lane', () => {
    const base = card(1, 1, 5, 'steel');
    const resolved = resolveForPlayer(1, 1, 5, base, stateWith({ focus: [100, 0] }), 0);
    expect(resolved.strikeMove).toBe('overdrive');
    expect(resolved.guardWord).toBe(base.guardWord);
  });

  it('is still deterministic after the re-roll walk', () => {
    for (let index = 0; index < 40; index += 1) {
      const base = card(9, 2, index, 'steel');
      const a = resolveForPlayer(9, 2, index, base, stateWith({}), 0);
      const b = resolveForPlayer(9, 2, index, base, stateWith({}), 0);
      expect(b).toEqual(a);
    }
  });
});
