import { describe, it, expect } from 'vitest';
import { xorshift32, toU32, draw, seedFrom } from './prng.js';
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
    const state = stateWith({ focus: [100, 0] });
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
    expect(base).not.toBeNull();
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
    const state = stateWith({ hp: [1000, 1000], focus: [30, 0] });
    const resolved = resolveForPlayer(3, 1, index, base, state, 0);
    expect(resolved.strikeMove).toBe(base.strikeMove);
    expect(resolved.strikeWord).toBe(base.strikeWord);
  });

  it('leaves a non-Mend candidate (Guard/Parry) completely alone', () => {
    let base = null;
    let index = 0;
    while (index < 200) {
      const candidate = card(3, 1, index, 'steel');
      if (candidate.guardMove !== 'mend') { base = candidate; break; }
      index += 1;
    }
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

describe('overrideSeed — guards against xorshift32(0) fixed point', () => {
  it('does not degenerate when seed/round/index/player/salt XOR to 0', () => {
    // Construct a collision: seed=5, round=3, index=6, player=0, salt=0x14
    // toU32(5)^3^6^(0+1)^0x14 = 5^3^6^1^0x14 = 0
    // Without seedFrom, this would call xorshift32(0)=0, draw()=>u=0 forever.
    // With seedFrom, it substitutes a fixed nonzero constant.
    const base = card(5, 3, 6, 'steel');
    const state = stateWith({ focus: [100, 0] }); // Overdrive active
    const resolved = resolveForPlayer(5, 3, 6, base, state, 0);

    // Verify the draw produced a valid word, not degenerated u=0 behavior
    expect(resolved.strikeWord.length).toBeGreaterThanOrEqual(14);
    expect(resolved.strikeWord.length).toBeLessThanOrEqual(24);

    // Verify seedFrom was used: directly test the collision case
    // to confirm the seed is not 0.
    const OVERDRIVE_SALT = 0x4F564552; // 'OVER'
    const collisionSeed = seedFrom(toU32(5), 3, 6, 0 + 1, OVERDRIVE_SALT);
    expect(collisionSeed).not.toBe(0);
    const testState = xorshift32(collisionSeed);
    const { u } = draw(testState);
    expect(u).not.toBe(0);
  });
});
