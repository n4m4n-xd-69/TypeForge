import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODE_REGISTRY, REQUIRED_MODE_FIELDS, kindFactorFor } from './registry.js';
import { deriveModePaletteEntries, deriveNavGroups } from './derive.js';
import { buildSessionPayload } from './sessionContract.js';
import { xpForSession } from '../gamification.js';

/**
 * Registry extensibility proof for the mode registry (Tasks 1-8). Read
 * alongside docs/01-PRD.md §17.3, which defines SC-A5 as "prove SC-A1-A4":
 *
 *   - SC-A1 (the schema can describe a 2-player, real-time, non-passage
 *     mode) — proven below.
 *   - SC-A2 (the session contract accommodates a mode-specific result
 *     payload without a schema change) — proven below.
 *   - SC-A3 (room/contest concepts must not be hardcoded to "one shared
 *     passage, everyone finishes") — OUT OF SCOPE for this file and this
 *     plan. The mode registry models no room/contest concept at all, so no
 *     registry-entry exercise can prove or disprove it. SC-A3/EX-6 is
 *     discharged by Shadow Battle's own backend design instead — separate
 *     `shadow_rooms`/`shadow_players`/etc. tables rather than widening
 *     `battle_rooms` (docs/08-PRD-shadow-battle.md §26.2) — by a future
 *     plan, not this one.
 *   - SC-A4 (XP awarding must not assume wpm × duration is the only input)
 *     — proven below.
 *
 * Consequence, stated plainly: SC-A5 is NOT fully discharged by this file
 * or this plan. A1, A2 and A4 are proven here; A3 remains open until the
 * Shadow Battle backend plan ships and can be pointed at for its proof.
 *
 * MR-5 (adding a mode requires no edit to nav/palette/scoring code) is also
 * proven below, reusing the same STICKMAN_ENTRY fixture — it lives in this
 * file because it shares the fixture, not because it is SC-A3. An earlier
 * draft of this file mislabeled the nav test "SC-A3 / MR-5"; it was always
 * only MR-5, and is labeled that way now.
 *
 * A note on what this file can and cannot prove for A1/A2/A4: `getMode`
 * (registry.js:82-84) and `kindFactorFor` (registry.js:86-89) read the
 * module-scope `MODE_REGISTRY` directly — neither takes an injected
 * registry. STICKMAN_ENTRY is not pushed into that array, because doing so
 * would either widen those functions' signatures (scope creep outside this
 * task) or mutate shared module state that every other test file importing
 * registry.js also reads (state leakage across files is worse than
 * either). So wherever a real function's *lookup by id/kind* would need
 * STICKMAN_ENTRY to already be registered, this file calls the real
 * function against the registry as it stands today and proves the lookup
 * mechanism is generic (id/kind-keyed, not a hardcoded enum) rather than
 * proving the post-registration return value. Each test below says
 * explicitly which of the two it is.
 */
const STICKMAN_ENTRY = {
  id: 'shadow', name: 'Shadow Battle', description: 'Two-player real-time typing combat.',
  icon: 'ShadowMark', route: '/shadow', category: 'competitive', kind: 'shadow',
  scored: 'combat', // SC-A1: not "time-trial" — a genuinely different scoring rule
  multiplayer: true, requiresCloud: true, difficulties: null,
  xpRule: { kindFactor: 1.20 }, // docs/08-PRD-shadow-battle.md §19.1
  quickLaunch: false,
  // navLabel is the short form ('Shadow') that this fixture's nav test
  // actually exercises. docs/08-PRD-shadow-battle.md §23.2 (SB-NAV-1) says
  // the real entry needs label: 'Shadow Battle' PLUS a dedicated
  // `short: 'Shadow'` field for the 360px mobile tab bar — `derive.js` has
  // no `short` concept today, and this fixture sidesteps that gap rather
  // than proving derive.js already handles it. So "zero changes to
  // derive.js" below holds only for the narrow claim actually tested (the
  // item appears in nav with the right route), not for full label fidelity
  // against SB-NAV-1 — that is a real, open schema gap for whoever
  // registers Shadow Battle for real.
  navSurface: true, navGroup: 'Compete', navLabel: 'Shadow', navRoute: '/shadow',
};

describe('SC-A1, SC-A2, SC-A4 — the stickman entry is expressible (SC-A3 out of scope; see file header)', () => {
  it('SC-A1: satisfies the same required-field shape as every real entry, describing a 2-player real-time non-passage mode', () => {
    // A shape/schema check on the fixture literal, not a function call —
    // that is the correct proof for SC-A1, which is a claim about what the
    // registry's *schema* can describe, mirrored against the same
    // REQUIRED_MODE_FIELDS list registry.test.js enforces for the 8 real
    // entries. Imported from registry.js (not re-declared here) so both
    // files check the same single list — if the registry's real contract
    // ever gains a field, both test files see it automatically.
    for (const field of REQUIRED_MODE_FIELDS) expect(STICKMAN_ENTRY).toHaveProperty(field);
    expect(STICKMAN_ENTRY.multiplayer).toBe(true);
    expect(STICKMAN_ENTRY.scored).not.toBe('time-trial');
  });

  it('MR-5: appears in nav with zero changes to deriveNavGroups or AppShell', () => {
    // Real call: deriveNavGroups is exercised with an extended registry
    // array. Would fail if deriveNavGroups only recognised a fixed set of
    // ids/groups instead of reading navSurface/navGroup generically.
    // This proves MR-5 (adding a mode needs no nav-code edit) only — NOT
    // SC-A3, which is about room/contest schema and is out of scope here
    // (see file header).
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

  it('SC-A4: kindFactorFor and xpForSession resolve any registry kind generically, with zero changes to gamification.js', () => {
    // Real calls to the real functions, using STICKMAN_ENTRY.kind
    // ('shadow') as the argument. MODE_REGISTRY does not contain a
    // 'shadow' entry today, so the assertion below checks the fallback
    // branch now — and is written to also be correct the moment Shadow
    // Battle actually registers a 'shadow' kind, so this test never needs
    // editing and never goes red for the wrong reason when that happens:
    const registered = MODE_REGISTRY.some((m) => m.kind === STICKMAN_ENTRY.kind);
    expect(kindFactorFor(STICKMAN_ENTRY.kind)).toBe(registered ? STICKMAN_ENTRY.xpRule.kindFactor : 1);

    // What this proves today (registered === false): kindFactorFor is a
    // pure id-agnostic lookup
    // (`MODE_REGISTRY.find(m => m.kind === kind)?.xpRule?.kindFactor ?? 1`),
    // not a hardcoded switch over known kinds — it accepts and safely
    // resolves an arbitrary, never-seen-before kind string instead of
    // throwing or silently misbehaving. registry.test.js already proves the
    // same mechanism correctly resolves registered kinds ('code' -> 1.25,
    // 'battle' -> 1.15). Together, that is the proof that the mechanism
    // generalises: the day STICKMAN_ENTRY (or the real Shadow Battle entry,
    // whose xpRule.kindFactor is 1.20 per docs/08-PRD-shadow-battle.md
    // §19.1) is pushed into MODE_REGISTRY, `registered` flips to true and
    // this exact call starts returning 1.20 — with zero changes to
    // gamification.js or registry.js, and with this test staying green
    // either way.

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

  it("SC-A2 / EX-7: a Shadow-Battle-shaped meta payload rides through the real buildSessionPayload untouched, and a colliding meta key's real precedence is proven", () => {
    // buildSessionPayload's mode lookup (getMode) also reads MODE_REGISTRY
    // at module scope, so a modeId of 'shadow' throws "unknown mode id"
    // today — sessionContract.test.js's own "throws for an unregistered
    // mode id" case already proves that is correct behaviour for an
    // unregistered mode, not a bug to route around.
    //
    // To exercise the real `...meta` passthrough without widening
    // buildSessionPayload's signature or mutating MODE_REGISTRY, this test
    // calls the REAL function against an already-registered mode ('battle'
    // — also multiplayer + requiresCloud, so its shape is close to Shadow
    // Battle's) and supplies `meta` shaped exactly like a Shadow Battle
    // `shadow_results` row (docs/08-PRD-shadow-battle.md §26.3) — not
    // Battlefield's own roomId/rank shape that Task 8's
    // sessionContract.test.js already covers.
    //
    // Honest framing: a bare object spread is field-set-agnostic by
    // construction, so passing a 5-key Shadow-shaped meta here doesn't
    // exercise a different code path than Task 8's 2-key Battlefield case
    // — its value is documenting that Shadow Battle's actual field names
    // (roomId/roundsWon/roundsLost/frDelta/opponentKind) ride through the
    // existing, already-proven mechanism, not proving a new one.
    const run = { wpm: 74, accuracy: 97, consistency: 88, durationSec: 180, chars: 900, errors: 12, keyStats: {} };
    const shadowMeta = { roomId: 'abc123', roundsWon: 2, roundsLost: 1, frDelta: 17, opponentKind: 'human' };

    const payload = buildSessionPayload({ modeId: 'battle', difficulty: 'hard', run, meta: shadowMeta });

    // Every Shadow Battle meta key rode through the real spread untouched.
    expect(payload).toMatchObject(shadowMeta);

    // EX-7's real requirement is "without schema change" — not "meta can
    // never collide with a contract field name". Prove the actual, current
    // precedence when a meta key DOES collide, with a real call and an
    // assertion against the real returned payload (not two literals
    // declared in this file): `...meta` spreads FIRST in sessionContract.js,
    // so the fixed contract field always wins over a colliding meta key.
    const collisionPayload = buildSessionPayload({ modeId: 'battle', difficulty: 'hard', run, meta: { wpm: 999 } });
    expect(collisionPayload.wpm).toBe(74);

    // Shadow Battle's actual meta keys never hit this case: none of
    // roomId/roundsWon/roundsLost/frDelta/opponentKind collide with the
    // 12-key session contract (ts/kind/mode/difficulty/lang/wpm/accuracy/
    // consistency/durationSec/chars/errors/keyStats). The collision case
    // above is a hypothetical stress test of the real mechanism's
    // precedence, not a claim about Shadow Battle's own payload.
  });

  it('SC-A3 / SC-A5: 0010_shadow_battle.sql provides dedicated duel tables rather than widening battle_rooms, leaving 0009 untouched', () => {
    const migrationPath = resolve(process.cwd(), 'supabase/migrations/0010_shadow_battle.sql');
    expect(existsSync(migrationPath)).toBe(true);

    const migrationSql = readFileSync(migrationPath, 'utf8');
    expect(migrationSql).toContain('create table if not exists public.shadow_rooms');
    expect(migrationSql).toContain('create table if not exists public.shadow_players');
    expect(migrationSql).toContain('create table if not exists public.shadow_events');

    const bfMigrationPath = resolve(process.cwd(), 'supabase/migrations/0009_battlefield.sql');
    const bfSql = readFileSync(bfMigrationPath, 'utf8');
    expect(bfSql).not.toContain('shadow_rooms');
  });
});
