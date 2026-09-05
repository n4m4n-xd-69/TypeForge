# TypeForge hardening — audit + stage map (2026-09-04)

Baseline before any change: `npm test` = 40 files / 572 tests passing.

## Confirmed root causes

| # | Symptom | Root cause | Location |
|---|---------|-----------|----------|
| 1 | Battlefield freezes after completion/timeout | `battle_maybe_settle` requires *every* non-left player to have a result row. A closed tab never writes one, so the room never settles. `battle_reap` finishes rooms without ranking them. | `0009_battlefield.sql` `battle_maybe_settle`, `battle_reap` |
| 2 | Admin panel shows one user | `UsersView` defaults `account: 'registered'` and the app signs everyone in anonymously, so guests (nearly all users) are filtered out client-side. | `UsersView.jsx:94,125` |
| 3 | Realtime unreliable everywhere | Publication membership + REPLICA IDENTITY live in a hand-run script, not a migration. | `scripts/configure-realtime.mjs` |
| 4 | Typing feels slow | 10 Hz `setElapsedMs` re-renders the entire passage (one span per character, each with a CSS transition); `live` recomputes `countCorrect` O(n) at the same rate. | `useTypingEngine.js:70-91,268`, `TypingStage.jsx:277` |
| 5 | Battle timer churn / drift | Deadline effect depends on `engine`, a new object every render; uses client clock against a server timestamp, ignoring the measured offset. | `RaceView.jsx:124-130` |
| 6 | Google users re-asked for name | `profile.onboarded` is deliberately local-only and nothing seeds `profile.name` from `user_metadata.full_name`. | `sync.js:324,343`, `Home.jsx:24` |
| 7 | Invite flow asks practice/goal questions | `/battle/:pin` guests route through the 3-step `Onboarding` wizard (name → daily goal → focus). | `Onboarding.jsx`, `BattleRoom.jsx` `Invite` |

## Stages

1. **DB hardening migration** — deadline-aware settle, member-callable sweep, ranked reap, 30-player capacity, realtime publication as migration.
2. **Typing engine** — decouple clock from render, memoise passage by word, fix WPM/accuracy definitions.
3. **Battle client** — stable engine identity, offset-correct deadline, settle watchdog, timeout race handling.
4. **Admin users** — default filter, realtime roster, detail tabs.
5. **Onboarding** — Google/anon/invite paths.
6. **Admin rooms** — live rooms, full-screen monitor, removal + reason + messages.
7. **Community** — posts, profile fields, photo upload.
8. **Shadow Fight** — under-development state.
9. **Perf + UI pass, full verification.**

Each stage's check: `npm test` stays green, plus a stage-specific test that fails without the fix.

---

## Progress (updated 2026-09-04)

Suite at last full run: **44 files / 628 tests passing** (baseline was 40 / 572).
`npm run verify` now also runs `scripts/check-migrations.mjs`.

### Done

| Stage | What shipped | The check that would fail without it |
|-------|--------------|--------------------------------------|
| 1 | `0023_battlefield_hardening.sql` — settle on deadline OR all-finished, member-callable `battle_sweep`, `battle_reap` now ranks, capacity 2–30, realtime publication moved into a migration | `check-migrations.mjs`; settle path exercised via `battle_sweep` watchdog |
| 2 | Typing engine: O(1) incremental correctness counter, word-chunked memoised `Passage`, honest WPM from the first millisecond, `grossWPM` for raw | `typing.test.js` (17), `useTypingEngine.test.js` (9) |
| 3 | Battle client: stable `finish` identity, offset-corrected deadline, settle watchdog, coalesced roster fetches, checkpoint interval scaled by room size | build + suite |
| 4 | Admin users: default filter `all` (was `registered`, which hid guests — i.e. nearly everyone), realtime roster, headline tile counts every account | — |
| 5 | Identity: `lib/identity.js` reads name/photo from `user_metadata`; store adopts it fill-in-the-blanks; Home opens onboarding only when `needsIdentity`; invite gate asks name + avatar and nothing else, and asks a returning visitor nothing | `identity.test.js` (12) |
| 6 | Admin rooms: `0024_room_moderation.sql`, full-screen `RoomMonitor`, removal with a mandatory reason, player-facing `RoomRemoved` screen, two-way appeal thread | `check-migrations.mjs` |
| 7 | Community: `0025_community.sql`, feed + composer, profile fields, photo upload with downscale, `community_profiles`/`community_feed` views as the privacy boundary | `community.test.js` (12) |
| 8 | Shadow Battle: `status` on each Arena lane, gated at the card, the hotkey, the ⌘K palette and the route | `arena.test.js` lane-readiness block (6) |
| 12 | Quote mode: length picker wired (the data had `length` and nothing exposed it), pool 12 → 24, repeat guard | `content.test.js` (9) |

### Applied to the database (2026-09-05)

`0023`, `0024`, `0025` and `0026` are applied to project `kavfjyvsvgvcjiuwwfbw`
and each was verified with a SQL query rather than by trusting the apply call:

| Migration | Verified by |
|-----------|-------------|
| 0023 | `max_players` check is `2..30`; `battle_sweep` exists; `battle_maybe_settle` settles on `deadline_at`; `battle_reap` routes through it; 4 tables in `supabase_realtime` |
| 0024 | `removed` in the room status check; appeals table + 3 policies; 5 new functions; 3 removal columns |
| 0025 | 9 public vs 21 private profile columns; **0** invoker views; the only broad `profiles` SELECT policy is the pre-existing `admins read all :: is_admin()`; 4 storage policies |
| 0026 | roster function gained `avatar`/`photo_url`/`provider` with EXECUTE to `authenticated` only; `admin_user_detail` returns `{}` to a non-admin caller; every new subquery run against live rows |

Advisor triage after applying: 132 lints, none of them new defects. The two
`security_definer_view` ERRORs on `community_profiles`/`community_feed` are the
deliberate privacy boundary — the alternative (invoker views plus a broad
`profiles` read policy) was drafted, caught as an actual leak of every profile
column to every authenticated user, and removed. The 77
`authenticated_security_definer_function_executable` warnings are the project's
pre-existing RPC pattern, authorised inside each function. The one
`function_search_path_mutable` (`admin_tier_scopes`) and the three
`anon_security_definer_function_executable` (`admin_can`, `arena_code_lookup`,
`arena_server_time`) are pre-existing and not from this work.

### Correction to an earlier entry

This document previously listed "admin user drilldown tabs" as not done. That
was wrong: `UserSheet` already had six tabs. What was actually missing was the
*data* — `admin_user_detail` predates Battlefield and Community, so the sheet
could not show a face, a sign-in provider, guest status, any Battlefield
participation, or any community activity. `0026_admin_user_360.sql` adds those
and the sheet renders them (identity first, a Battles tab led by Battlefield, a
Community tab, and appeals in Audit).

### Live verification against the real project (2026-09-05)

Two scripts drive the real RPCs over the real anon key, as the browser does:
`scripts/verify-flows.mjs` (25 checks) and `scripts/verify-removal.mjs`
(8 checks, in three phases because marking a room removed needs privileges a
player does not have). All 33 pass. Highlights:

- **The freeze, reproduced and fixed.** Two guests, one finishes, one closes the
  tab and never reports. Before the deadline the room stays `active` and the
  sweep refuses to end it. After the deadline the sweep settles it: the
  finisher is rank 1, the absent player is rank 2 with `finished=false` and
  `flags=["timeout"]`. A non-member is refused the sweep entirely.
- Capacity: 31 refused by the server, 30 accepted.
- Authorisation: a player cannot remove a room (`content.moderate required`),
  cannot read `admin_user_overview` (0 rows), cannot select another member's
  `profiles` row (0 rows), cannot delete another member's post, and cannot write
  their own `admin_reply` (RLS violation).
- Removal: a former member is told the room is gone and why; a stranger learns
  nothing; a second question edits the one thread rather than opening another;
  the player sees the operator's answer.
- Community: a live room code is attached and the feed reports it joinable;
  once the room ends the same row stops offering a join button.

**One real bug found by this and fixed:** `community_post` named its local
variable `pin`, colliding with `battle_rooms.pin`, so *every* post carrying a
Battlefield code failed with `column reference "pin" is ambiguous` — the
Community's headline feature, broken 100% of the time, invisible to both the
unit suite and the structural checker. `0027_community_post_pin.sql`.

Test data was cleaned up: 3 rooms, 1 appeal and 2 posts deleted. The anonymous
accounts the scripts signed in as remain in `auth.users`, as guest rows.

Not exercised: the operator-side RPCs `admin_remove_battle_room`,
`admin_list_appeals` and `admin_reply_to_appeal` on their *success* path, which
needs a signed-in admin session. Their refusal path is verified above, and the
removal state they write was reproduced directly.

### Remaining

- **In-browser interaction**: keystroke latency, the caret, layout stability,
  photo upload through the file picker, and console cleanliness. Both
  browser-automation MCP servers (`chrome-devtools`, `playwright`) failed to
  connect, and neither driver is installed locally, so nothing has been clicked
  by a machine. The dev server boots and serves (`/`, `/battle/:pin` and the
  module graph all 200) and every server-side flow behind those screens is
  verified above.
- **Operator-side success paths** for room removal and appeal replies, which
  need a signed-in admin session.
