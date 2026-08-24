import { describe, expect, it } from 'vitest';
import { MODE_REGISTRY, kindFactorFor } from './registry.js';
import { deriveModePaletteEntries, deriveNavGroups } from './derive.js';
import { buildSessionPayload } from './sessionContract.js';
import { xpForSession } from '../gamification.js';

/**
 * SC-A1..A5 (docs/01-PRD.md §17): the registry must be able to describe a
 * mode that is 2-player, real-time, and not scored on passage completion —
 * without core-code changes. Shadow Battle (docs/08-PRD-shadow-battle.md) is
 * that mode; this fixture is its shape, not its live registration.
 *
 * A note on what this file can and cannot prove: `getMode` and
 * `kindFactorFor` (registry.js:82-89) read the module-scope `MODE_REGISTRY`
 * directly — neither takes an injected registry. STICKMAN_ENTRY is not
 * pushed into that array, because doing so would either widen those
 * functions' signatures (scope creep outside this task) or mutate shared
 * module state that every other test file importing registry.js also reads
 * (state leakage across files is worse than either). So wherever a real
 * function's *lookup by id/kind* would need STICKMAN_ENTRY to already be
 * registered, this file calls the real function against the registry as it
 * stands today and proves the lookup mechanism is generic (id/kind-keyed,
 * not a hardcoded enum) rather than proving the post-registration return
 * value. Each test below says explicitly which of the two it is.
 */
const STICKMAN_ENTRY = {
  id: 'shadow', name: 'Shadow Battle', description: 'Two-player real-time typing combat.',
  icon: 'ShadowMark', route: '/shadow', category: 'competitive', kind: 'shadow',
  scored: 'combat', // SC-A1: not "time-trial" — a genuinely different scoring rule
  multiplayer: true, requiresCloud: true, difficulties: null,
  xpRule: { kindFactor: 1.20 }, // docs/08-PRD-shadow-battle.md §19.1
  quickLaunch: false,
  navSurface: true, navGroup: 'Compete', navLabel: 'Shadow', navRoute: '/shadow',
};

// The exact 12-field session contract sessionContract.test.js pins for
// `buildSessionPayload`'s output. Used below to check Shadow Battle's
// mode-specific meta keys don't collide with it.
const SESSION_CONTRACT_KEYS = [
  'ts', 'kind', 'mode', 'difficulty', 'lang',
  'wpm', 'accuracy', 'consistency', 'durationSec', 'chars', 'errors', 'keyStats',
];

describe('SC-A1..A5 — the stickman entry is expressible', () => {
  it('SC-A1: satisfies the same required-field shape as every real entry, describing a 2-player real-time non-passage mode', () => {
    // A shape/schema check on the fixture literal, not a function call —
    // that is the correct proof for SC-A1, which is a claim about what the
    // registry's *schema* can describe, mirrored against the same
    // REQUIRED_FIELDS list registry.test.js enforces for the 8 real entries.
    const REQUIRED_FIELDS = [
      'id', 'name', 'description', 'icon', 'route', 'category',
      'kind', 'scored', 'multiplayer', 'requiresCloud', 'difficulties', 'xpRule',
    ];
    for (const field of REQUIRED_FIELDS) expect(STICKMAN_ENTRY).toHaveProperty(field);
    expect(STICKMAN_ENTRY.multiplayer).toBe(true);
    expect(STICKMAN_ENTRY.scored).not.toBe('time-trial');
  });

  it('SC-A3 / MR-5: appears in nav with zero changes to deriveNavGroups or AppShell', () => {
    // Real call: deriveNavGroups is exercised with an extended registry
    // array. Would fail if deriveNavGroups only recognised a fixed set of
    // ids/groups instead of reading navSurface/navGroup generically.
    const registry = [...MODE_REGISTRY, STICKMAN_ENTRY];
    const groups = deriveNavGroups(registry, { Train: [], Compete: [] });
    const compete = groups.find((g) => g.label === 'Compete');
    expect(compete.items.map((i) => i.to)).toContain('/shadow');
  });

  it('MR-5: appears in the command palette with zero changes to deriveModePaletteEntries or CommandPalette', () => {
    // Real call, same shape of proof as the nav test above.
    const registry = [...MODE_REGISTRY, STICKMAN_ENTRY];
    const entries = deriveModePaletteEntries(registry);
    expect(entries.find((e) => e.id === 'shadow')).toMatchObject({ route: '/shadow', group: 'Navigate' });
  });

  it('SC-A4: kindFactorFor and xpForSession resolve an unregistered kind generically, with zero changes to gamification.js', () => {
    // Real calls to the real functions, using STICKMAN_ENTRY.kind
    // ('shadow') as the argument. Because MODE_REGISTRY does not yet
    // contain a 'shadow' entry (see file-level note above), kindFactorFor
    // returns its documented fallback (1) rather than 1.20 — that is
    // correct, current behaviour, not a bug.
    //
    // What this proves: kindFactorFor is a pure id-agnostic lookup
    // (`MODE_REGISTRY.find(m => m.kind === kind)?.xpRule?.kindFactor ?? 1`),
    // not a hardcoded switch over known kinds — it accepts and safely
    // resolves an arbitrary, never-seen-before kind string instead of
    // throwing or silently misbehaving. registry.test.js already proves
    // the same mechanism correctly resolves registered kinds ('code' ->
    // 1.25, 'battle' -> 1.15). Together, that is the proof that the
    // mechanism generalises: the day STICKMAN_ENTRY (or the real Shadow
    // Battle entry) is pushed into MODE_REGISTRY, this exact call starts
    // returning 1.20, with zero changes to gamification.js or registry.js.
    // The post-registration return value itself is NOT proven here — it
    // cannot be, without registering the entry, which is out of this
    // fixture-only task's scope.
    expect(kindFactorFor(STICKMAN_ENTRY.kind)).toBe(1);
    expect(STICKMAN_ENTRY.xpRule.kindFactor).toBe(1.20); // fixture shape check only

    // The downstream consumer also accepts an arbitrary registry `kind`
    // string without special-casing it: xpForSession takes `kind` as a
    // plain parameter (not derived from a hardcoded enum) and produces a
    // finite, positive award for Shadow Battle's kind exactly as it would
    // for any other. This is SC-A4's actual claim — XP awarding is not
    // wired to assume wpm × duration are the only inputs; kind is a real,
    // generic input all the way through.
    const xp = xpForSession({ wpm: 74, accuracy: 97, durationSec: 180, kind: STICKMAN_ENTRY.kind, difficulty: 'normal' });
    expect(Number.isFinite(xp)).toBe(true);
    expect(xp).toBeGreaterThan(0);
  });

  it('SC-A2 / EX-7: a Shadow-Battle-shaped meta payload rides through the real buildSessionPayload untouched, with no collision against the 12-key session contract', () => {
    // buildSessionPayload's mode lookup (getMode) also reads MODE_REGISTRY
    // at module scope, so a modeId of 'shadow' throws "unknown mode id"
    // today — sessionContract.test.js's own "throws for an unregistered
    // mode id" case already proves that is correct behaviour for an
    // unregistered mode, not a bug to route around.
    //
    // To exercise the real `...meta` passthrough mechanism without
    // widening buildSessionPayload's signature or mutating MODE_REGISTRY,
    // this test calls the REAL function against an already-registered mode
    // ('battle' — also multiplayer + requiresCloud, so its shape is close
    // to Shadow Battle's) and supplies `meta` shaped exactly like a Shadow
    // Battle `shadow_results` row (docs/08-PRD-shadow-battle.md §26.3) —
    // not Battlefield's own roomId/rank shape that Task 8's
    // sessionContract.test.js already covers. What's being proven here is
    // the passthrough mechanism itself (the `...meta` spread applies to
    // any field set, not just Battlefield's), which is exactly EX-7's
    // claim: a mode-specific result payload rides along without a schema
    // change. The modeId used to invoke it is a stand-in, not a claim that
    // shadow_results data belongs to a Battlefield session.
    const run = { wpm: 74, accuracy: 97, consistency: 88, durationSec: 180, chars: 900, errors: 12, keyStats: {} };
    const shadowMeta = { roomId: 'abc123', roundsWon: 2, roundsLost: 1, frDelta: 17, opponentKind: 'human' };

    const payload = buildSessionPayload({ modeId: 'battle', difficulty: 'hard', run, meta: shadowMeta });

    // Every Shadow Battle meta key rode through the real spread untouched.
    expect(payload).toMatchObject(shadowMeta);

    // EX-7's actual requirement is "without schema change" — prove that
    // concretely by checking none of Shadow Battle's meta keys silently
    // collide with (and overwrite) one of the fixed 12-key contract fields.
    const collisions = Object.keys(shadowMeta).filter((k) => SESSION_CONTRACT_KEYS.includes(k));
    expect(collisions).toEqual([]);
  });
});
