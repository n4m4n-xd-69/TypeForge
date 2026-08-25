# Shadow Battle build — resume-here status

(Tool-agnostic handoff note — written so any AI agent, not just Claude, can
pick this up. Claude also has this tracked in its own project memory.)

Repo: `C:\Users\V3X0R\ZPROJECTs\X1\Key Stroke`, branch `typeforge`.
Everything below is **committed and merged** — `git log --oneline -10` on
`typeforge` shows it. Nothing from this work is pending/uncommitted.

## Done: Plan 0 (mode registry) + Plan 1 (combat reducer) + Plan 2 (word queue)

- `src/lib/modes/` — mode registry infra.
- `src/lib/shadow/{moveTable,damage,roundState,combat,match}.js` — Plan 1,
  pure combat-math reducer (PRD §8-§12). 153 tests before Plan 2 added more.
- `src/lib/shadow/{prng,phraseTable,wordQueue,cardResolution}.js` — Plan 2,
  seeded deterministic word/move queue (PRD §9-§10.4). `content.js` gained
  `COMMON`/`HARDER`/`PUNCTUATED` exports.
- Full suite: **212 tests, 17 files, all passing** (`npm test`).
- **No consumer wired up yet for either Plan 1 or Plan 2** — this is
  deliberate infrastructure-first sequencing. Plan 3 is the first thing
  that actually plays a game.

Design specs (read before touching this code):
`docs/superpowers/specs/2026-08-25-shadow-battle-combat-reducer-design.md`
`docs/superpowers/specs/2026-08-25-shadow-battle-word-queue-design.md`
Plans (full implementation detail + task-by-task history):
`docs/superpowers/plans/2026-08-25-shadow-battle-combat-reducer.md`
`docs/superpowers/plans/2026-08-25-shadow-battle-word-queue.md`
Source PRD (design authority for everything): `docs/08-PRD-shadow-battle.md`

## Things a future session MUST know before building on this

1. **`seedFrom(...)` in `prng.js`** is the only correct way to combine
   multiple parts into a PRNG seed anywhere in `src/lib/shadow/` — never
   raw XOR (`a ^ b ^ c`). It folds through a MurmurHash3 `fmix32`
   finalizer for real avalanche/order-sensitivity. A naive XOR seed was
   tried first and measured at 96% adjacent-index correlation — do not
   reintroduce that pattern.
2. **Overdrive stickiness (PRD §10.2) is NOT implemented.** Once
   `resolveForPlayer` (`cardResolution.js`) grants Overdrive, PRD says it
   "stays until played or the round ends" — but `resolveForPlayer` is a
   pure function of current state, so it reverts the instant Focus drops
   below 100. **Whoever builds the live game loop (Plan 3) must cache the
   resolved card pair per index once Overdrive fires**, not re-resolve on
   every access.
3. **Known content gap, not fixed:** Mend (~30% of guard slots) and
   Slash's COMMON-bank draws share only 2-3 words in `content.js`'s
   current word bank — visible repetition within a round (violates
   SB-WRD-5). Fixing it means adding more 6-8 char words to `COMMON` —
   out of Plan 1/2's scope, needed before Plan 3's first real demo looks
   good.
4. **`combat.js`'s docblock has an "Event resolution seam" note** — a wire
   `CombatEvent` only carries `cardIndex`; resolving it to `moveId`/`chars`
   (via `wordQueue.js`'s `card()`) is a step Plan 1's reducer assumes
   happens before events reach it. Read that docblock before wiring Plan 2
   into Plan 1.
5. **§36-Q6 resolved:** server-side replay will run this exact JS in a
   Supabase Edge Function, not plpgsql. Keep everything in
   `src/lib/shadow/` Deno-safe (no Node-only or browser-only APIs) — this
   still hasn't been deployed anywhere, just kept clean for when it is.

## Process this project has been using (if the next agent wants to keep it)

Each plan: brainstorm scope/design → write a design spec to
`docs/superpowers/specs/` → write a task-by-task implementation plan to
`docs/superpowers/plans/` → execute via a fresh implementer+reviewer
subagent per task, in an isolated git worktree → final whole-branch review
→ merge to `typeforge`. Every plan so far (0, 1, 2) has needed real fix
rounds from its review loop — don't skip it as a formality; it has caught
genuine bugs (including a Critical one in Plan 1 and an algorithmic
weakness in Plan 2) every single time.

## What's next

**Plan 3: Trial mode** — bot opponent + local play, fully offline, the
first actually-playable slice end-to-end. Wires Plan 1 (`combat.js`) and
Plan 2 (`wordQueue.js`/`cardResolution.js`) together for the first time.
After that: Plan 4 (backend schema, `supabase/migrations/0010_...sql`,
where the SC-A3 extensibility criterion finally gets proven), Plan 5
(multiplayer/rooms), Plan 6 (battle screen UI — spike the 60fps-canvas
question from PRD §36-Q1 first), Plan 7 (progression/XP/anti-cheat),
Plan 8 (a11y/perf/analytics polish).

## Unrelated, pre-existing uncommitted work in this repo — not part of Shadow Battle

`git status` on `typeforge` shows modified `package.json`/`vite.config.js`/
`scripts/build-icons.mjs`/one migration file, plus several untracked files
(`LiquidGlassRef/`, `assets/vid/`, `docs/hero_vid.txt`,
`docs/prompt_game.txt`, several `scripts/*.mjs`). These predate this
session's work and are not part of the Shadow Battle build — leave them
alone unless the user asks about them specifically.
