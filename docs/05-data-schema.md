# TypeForge — Backend & Data Model

**Version:** 1.0
**Date:** 2026-08-23
**Depends on:** `00-codebase-audit.md`, `01-PRD.md`, `02-TRD.md`, `03-app-flow.md`, `04-design-brief.md`
**Baseline:** `supabase/migrations/0001…0009` at `main` @ `d1d2ed9`

---

## How to read this

Every entity carries a status tag:

| Tag | Meaning |
|---|---|
| `[KEEP]` | Exists, unchanged. Do not touch. |
| `[ALTER]` | Exists, additive change only. |
| `[NEW]` | New object. |
| `[DROP]` | Exists, being removed. |
| `[NOT A TABLE]` | Requested in the brief, but deliberately **not** modelled as one. Reason given. |

**The `[NOT A TABLE]` entries matter as much as the tables.** The brief asks to avoid unnecessary tables and abstractions; those sections are where that instruction is actually applied, with reasoning.

---

# PART A — Existing backend inventory

## A.1 What the backend actually is

**Postgres is the backend.** There is no application server. `battle/api.js:5-10` states it plainly: *"the app is a static bundle with no backend, so 'the server' is Postgres and every call here is an RPC."*

Three access surfaces:

| Surface | Used by | Gate |
|---|---|---|
| PostgREST (direct table access) | `sync.js`, `Profile.jsx`, `Achievements.jsx`, `adminApi.js`, `chatStore.js` | RLS |
| Postgres RPC | `battle/api.js` (12 fns), `adminApi.js` (1 fn) | `SECURITY DEFINER` + explicit `GRANT` |
| GoTrue | `supabase.js` | Supabase-managed |

## A.2 Current tables — audited

| Table | Migration | Rows written by | Verdict |
|---|---|---|---|
| `profiles` | 0001 + 0007 | `sync.js:151`, `Profile.jsx:56` | `[ALTER]` |
| `sessions` | 0001 | `sync.js:140` | `[KEEP]` |
| `daily_stats` | 0001 | `sync.js:208` | `[KEEP]` |
| `key_stats` | 0001 | `sync.js:172` | `[KEEP]` |
| `achievements` | 0001 | `sync.js:198` | `[KEEP]` |
| `learn_progress` | 0001 | **nothing** — writer deleted `d1d2ed9` | `[DROP]` |
| `problem_progress` | 0001 | `sync.js:181` — but nothing ever populates the source (`store.jsx:19-22`) | `[DROP]` |
| `user_roles` | 0002 | manual SQL only | `[KEEP]` |
| `auth_events` | 0002 | `supabase.js:56`, `adminApi.js:70` | `[ALTER]` |
| `ai_usage` | 0002 | `ai-runner.js:246` (client) | `[ALTER]` |
| `chat_messages` | 0003 | `chatStore.js:85` | `[KEEP]` |
| `beta_votes` | 0003 | **nothing** — client deleted | `[DROP]` |
| `battle_rooms` | 0009 | RPC only | `[ALTER]` |
| `battle_passages` | 0009 | RPC only | `[KEEP]` |
| `battle_players` | 0009 | RPC + one narrow update policy | `[ALTER]` |
| `battle_results` | 0009 | RPC only | `[KEEP]` |

Views: `admin_daily` (invoker), `leaderboard` (definer), `beta_vote_tally` (definer, `[DROP]`).

## A.3 What is well-built and must not be disturbed

| Property | Where | Why it matters |
|---|---|---|
| Session identity `(user_id, ts)` | `0008` | Two migrations exist because the original hash drifted through Postgres round-trips. **Do not reopen.** |
| `is_admin()` as `SECURITY DEFINER` | `0002` | Breaks RLS recursion. The pattern every new helper must follow. |
| Additive admin read policies | `0002:40-43` | Postgres ORs same-command policies, so neither weakens the other. |
| No client write path for battles | `0009:16-21` | Leaves no client-side write path *by construction rather than by convention*. |
| `REVOKE` before `GRANT` | `0009:775-783` | Postgres grants EXECUTE to PUBLIC by default. Verified: before the revoke, `set role anon` could read rooms. |
| Internal fns revoked from `authenticated` | `0009:800-807` | Otherwise any signed-in user could force-settle a match they are not in. |
| Passage in a separate table | `0009:34-38` | Lobby-sitters cannot pre-read the text. |
| Server-recomputed WPM | `0009:629-632` | The one number a cheating client cannot move. |
| `leaderboard` exposes 4 columns | `0005`, `0007` | Ranking never requires exposing a profile. |
| `battle_rooms` not selectable by PIN | `0009:180-183` | Blocks PIN-space enumeration. |

## A.4 Client-side data structures reused

`sync.js` already defines the row↔local mapping. **It stays as-is** apart from removing the dead `problem_progress` path:

| Local | Column | Note |
|---|---|---|
| `s.lang` | `sessions.language` | The one non-identity rename |
| `s.rawWpm` | `sessions.raw_wpm` | |
| `s.durationSec` | `sessions.duration_sec` | |
| `profile.name` | `profiles.display_name` | |
| `profile.hideFromLeaderboard` | `profiles.hide_from_leaderboard` | |
| `keyStats[ch]` | `key_stats(key, total, wrong)` | Summed on adoption, LWW after |

---

# PART B — Design decisions

## B.1 Governing rules

**R-1 — Reuse before addition.** 12 of 16 existing tables are kept unchanged. 4 are dropped. 4 are altered additively. **Three new tables total.**

**R-2 — Derived data is not stored.** Levels, personal bests, WPM records and accuracy records are pure functions of data already stored. Storing them creates drift with no query benefit at this scale.

**R-3 — Behaviour lives in code, not rows.** Practice modes, difficulty tiers and level titles are behaviour. Putting them in tables would still require a deploy to change what they *do*, so the table buys nothing and adds a join.

**R-4 — Offline-first constrains content storage.** Bundled content is what makes the app work with no network (PRD NFR-OFF-1). Content does not move to the database.

**R-5 — Every new write path is an RPC.** New capability that needs a trust boundary is a `SECURITY DEFINER` function following the `0009` template, never a loosened policy.

**R-6 — Season-readiness without a seasons table.** Rating lives on `profiles` now. §C.21 documents the exact additive migration when seasons arrive.

## B.2 Summary of change

| Action | Count | Objects |
|---|---|---|
| `[KEEP]` unchanged | 10 | `sessions`, `daily_stats`, `key_stats`, `achievements`, `user_roles`, `chat_messages`, `battle_passages`, `battle_results`, `admin_daily`, `leaderboard` |
| `[ALTER]` additive | 5 | `profiles`, `auth_events`, `ai_usage`, `battle_rooms`, `battle_players` |
| `[DROP]` | 4 | `learn_progress`, `problem_progress`, `beta_votes`, `beta_vote_tally` |
| `[NEW]` tables | **3** | `rating_history`, `moderation_reports`, `content_reports` → **merged to 2**, see §C.32 |
| `[NEW]` views | 2 | `skill_leaderboard`, `flagged_results` |
| `[NEW]` functions | 7 | listed §D |
| `[NOT A TABLE]` | 11 | §C entries marked as such |

**Net: 2 new tables.**

---

# PART C — Schema by domain

## C.1 Users `[KEEP]` — `auth.users`

Supabase-managed. **Never written directly** except the `full_name` metadata patch in `0004`.

| Field used | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK. The FK target for every user-owned table |
| `email` | `text` | Nullable — guests have none |
| `is_anonymous` | `boolean` | Guest discriminator (`supabase.js:113`) |
| `raw_user_meta_data` | `jsonb` | `full_name` read before the profile row loads |
| `created_at`, `last_sign_in_at` | `timestamptz` | Read by `admin_user_overview()` |

**Relationships:** 1:1 `profiles` · 1:N everything else.
**Trigger:** `on_auth_user_created` → `handle_new_user()` creates the `profiles` row.

## C.2 Authentication `[KEEP]` — GoTrue

Four paths, all existing. See §F for the flow and §G for authorization.

## C.3 Profiles `[ALTER]` — `public.profiles`

```sql
-- 0011_typeforge_profiles.sql  (additive)
alter table public.profiles
  add column if not exists rating        int not null default 1200,
  add column if not exists rating_games  int not null default 0,
  add column if not exists name_status   text not null default 'ok'
    check (name_status in ('ok', 'flagged', 'blocked')),
  add column if not exists deleted_at    timestamptz;
```

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | ✗ | — | **PK**, FK → `auth.users(id)` `on delete cascade` |
| `display_name` | `text` | ✓ | — | ≤40 chars (client-enforced, §H) |
| `avatar` | `text` | ✓ | — | `preset:<id>` or a ≤160px data URI |
| `goal_minutes` | `int` | ✗ | `15` | |
| `xp` | `int` | ✗ | `0` | Effort. **Never** the competitive rank |
| `streak_count` / `streak_best` | `int` | ✗ | `0` | |
| `streak_last` | `date` | ✓ | — | Local-date semantics (`gamification.js:62`) |
| `hide_from_leaderboard` | `boolean` | ✗ | `false` | |
| `settings` | `jsonb` | ✗ | `'{}'` | §C.30 |
| **`rating`** | `int` | ✗ | `1200` | `[NEW]` Elo. Skill, not effort |
| **`rating_games`** | `int` | ✗ | `0` | `[NEW]` Drives K-factor decay |
| **`name_status`** | `text` | ✗ | `'ok'` | `[NEW]` Moderation, §C.32 |
| **`deleted_at`** | `timestamptz` | ✓ | — | `[NEW]` Soft-delete tombstone, §C.1 deletion |
| `created_at` / `updated_at` | `timestamptz` | ✗ | `now()` | |

**Indexes:** PK on `id`. `[NEW]` `profiles_rating_idx on (rating desc) where hide_from_leaderboard = false and name_status = 'ok' and deleted_at is null` — partial, so the skill board is an index-only scan.

**Constraints:** `name_status` check above · `rating between 0 and 4000` (added with the column).

**RLS:** unchanged — `own rows` (0001) + `admins read all` (0002).

**Validation:** `display_name` trimmed, ≤40 chars, non-blank to appear on any board · `avatar` must match `^preset:[a-z-]+$` or `^data:image/(png|jpe?g|webp);base64,` and ≤64 KB · `goal_minutes ∈ {5,15,30}`.

## C.4 Typing sessions `[KEEP]` — `public.sessions`

**No schema change.** The `[NEW]` session contract (TRD §B.19.2) maps onto existing columns; renaming would reopen the identity problem `0006`/`0008` exist to fix.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | ✗ | **PK**, identity |
| `user_id` | `uuid` | ✗ | FK → `auth.users` cascade |
| `client_id` | `text` | ✗ | Legacy idempotency key. Retained for old rows |
| `ts` | `timestamptz` | ✗ | **Identity, with `user_id`** |
| `kind` | `text` | ✗ | `text` \| `code` \| `battle` — derived from the registry |
| `mode` | `text` | ✓ | Registry `modeId` |
| `language` | `text` | ✓ | Code only |
| `difficulty` | `text` | ✓ | |
| `wpm` | `real` | ✗ | Net |
| `raw_wpm` | `real` | ✓ | |
| `accuracy` | `real` | ✗ | 0–100 |
| `consistency` | `real` | ✓ | 0–100 |
| `duration_sec` | `real` | ✗ | |
| `chars` / `errors` | `int` | ✓ | |
| `xp` | `int` | ✗ | Award at time of writing |
| `created_at` | `timestamptz` | ✗ | Server receipt |

**Indexes:** `sessions_user_ts_idx (user_id, ts desc)` · `sessions_user_ts_uniq (user_id, ts)` **unique** — the identity.
**Constraints:** `unique (user_id, client_id)` legacy.
**Validation (§H):** `wpm ∈ [0, 400]` · `accuracy ∈ [0, 100]` · `duration_sec > 0` · `ts` not in the future beyond clock skew.

> **`[NOT ADDED]` a `mode_id` FK.** Modes are client-registry entries (R-3). A FK would require a `modes` table whose rows change only when code changes.

## C.5 Typing tests `[NOT A TABLE]`

A "test" is a transient pairing of a mode configuration with a passage. It exists for 15–120 seconds and produces exactly one artifact — a `sessions` row — which already records mode, difficulty, language and duration.

Storing tests would mean a row per started-and-abandoned attempt, with no consumer.

**Exception, already handled:** a Battlefield passage *is* persisted, because 2–8 clients must agree on it — `battle_passages` (§C.22).

## C.6 Practice modes `[NOT A TABLE]`

Modes are behaviour: which content source, which limit, how scored, how XP is weighted. A `modes` table would store labels while the behaviour stayed in code, so changing a mode would still require a deploy — and now a data migration too.

**Where they live:** `src/app/modes.js` (TRD §B.19.1). `sessions.mode` stores the registry id as free text, which is exactly enough to query history.

## C.7 Text / templates `[NOT A TABLE]` · C.8 Code templates `[NOT A TABLE]`

**Content stays bundled** (`lib/content.js`, `lib/snippets/`). 116 snippets ≈ 50 KB.

| Consideration | Verdict |
|---|---|
| Offline-first (PRD NFR-OFF-1) | **Decisive.** DB-hosted content breaks the core promise |
| Update without deploy | No content team exists; content changes with code |
| Bundle cost | ~50 KB, code-split per language already |
| User-submitted content | Would be **additive** — a future table layering over bundled content, not replacing it |

> **Future seam, not built:** community packs would be `content_packs(id, author_id, language, difficulty, items jsonb, status)` and the client would merge bundled ∪ fetched. Adding it now would be an unused table (R-1).

## C.9 Categories `[NOT A TABLE]` · C.10 Difficulty `[NOT A TABLE]`

Categories = `(kind, mode, language)`, all already columns. Difficulty is a 4-value closed set enforced by a `check` constraint, not a lookup table — it has no attributes beyond its name, and the multipliers live in `xpForSession()`.

## C.11–C.14 WPM / accuracy / mistakes / personal records

| Requested | Modelled as | Why |
|---|---|---|
| WPM records | `max(sessions.wpm)` | Derived (R-2). Client computes over ≤400 local rows instantly |
| Accuracy records | `max(sessions.accuracy)` | Derived |
| **Mistakes** | **`key_stats` `[KEEP]`** + `sessions.errors` | The one genuinely stored mistake data |
| Personal records | Derived | A `personal_records` table is denormalised state that drifts. No query needs it |

### `public.key_stats` `[KEEP]`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | `uuid` | ✗ | **PK part**, FK cascade |
| `key` | `text` | ✗ | **PK part**. Single character |
| `total` | `int` | ✗ | Attempts |
| `wrong` | `int` | ✗ | Misses |

**PK** `(user_id, key)` · **Merge rule:** summed on adoption (`sync.js:297`), LWW after · **Validation:** `char_length(key) = 1`, `wrong <= total`.

> **`[NOT ADDED]` a bigram table.** PRD AN-F6 wants bigram analysis. Single keys are bounded at ~100 rows/user; bigrams are ~10,000. When built, cap to the top-N observed and reuse this exact shape — `key` simply holds two characters. **No new table required**, only relaxing the length check.

## C.15 Session history `[KEEP]`

`sessions` is the history. Client caps at 400 (`store.jsx:46`); **the server does not cap** — see §K retention.

## C.16 XP `[KEEP]` · C.17 Levels `[NOT A TABLE]`

XP: `profiles.xp` (total) + `sessions.xp` (per run) + `daily_stats.xp` (rollup). All exist.

Levels are `levelFromXP(xp)` — a pure quadratic. Level titles are 9 client constants. **Storing a derived level would let it disagree with the XP beside it.**

## C.18 Ranks `[ALTER via profiles]` — the skill system

XP measures effort. Rank must measure skill (PRD XP-3).

**Source of truth:** `battle_results.wpm`, which is **server-recomputed** (`0009:649`) — the only trustworthy speed figure in the system.

### `public.rating_history` `[NEW]` — table 1 of 2

```sql
create table if not exists public.rating_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users on delete cascade,
  room_id     uuid references public.battle_rooms on delete set null,
  rating_before int not null,
  rating_after  int not null,
  delta         int not null,
  opponents     int not null,
  placed        int not null,
  created_at    timestamptz not null default now()
);
create index rating_history_user_idx on public.rating_history (user_id, created_at desc);
alter table public.rating_history enable row level security;
create policy "own rows"      on public.rating_history for select using (auth.uid() = user_id);
create policy "admins read all" on public.rating_history for select using (public.is_admin());
```

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | ✗ | **PK** |
| `user_id` | `uuid` | ✗ | FK → `auth.users` cascade |
| `room_id` | `uuid` | ✓ | FK → `battle_rooms` `set null` — rooms are reaped after 7 days |
| `rating_before` / `rating_after` | `int` | ✗ | |
| `delta` | `int` | ✗ | Denormalised for display; the UI must show *why* (design brief D.12) |
| `opponents` | `int` | ✗ | Field size |
| `placed` | `int` | ✗ | Finishing position |

**Why a table and not derived:** a rating is path-dependent — it cannot be recomputed from the current state alone. Without history, a rating change is unexplainable, and an unexplainable number is worse than none (design brief D.12).

**No insert policy.** Written only inside `battle_settle()`.

## C.19 Achievements `[KEEP]` — `public.achievements`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | `uuid` | ✗ | **PK part**, FK cascade |
| `achievement` | `text` | ✗ | **PK part**. Client-side id |
| `unlocked_at` | `timestamptz` | ✗ | |

**Merge rule:** union, earliest wins (`sync.js:288`) · **Never re-locks** · **Write:** `upsert … ignoreDuplicates` so a date never moves.

> Definitions stay in `gamification.js` (R-3). A `predicate` cannot live in a row.

## C.20 Leaderboards `[KEEP]` + `[NEW]` view

### `public.leaderboard` `[KEEP]` — XP board
Four columns only: `display_name`, `avatar`, `xp`, `rank()`. Definer view so it can aggregate rows the caller cannot select. Honours the opt-out.

**One additive change** — exclude moderated and deleted profiles:
```sql
-- inside the rebuilt view
where p.xp > 0
  and p.hide_from_leaderboard = false
  and p.name_status = 'ok'          -- NEW
  and p.deleted_at is null          -- NEW
  and nullif(trim(p.display_name), '') is not null
```

### `public.skill_leaderboard` `[NEW]` — rating board
```sql
create view public.skill_leaderboard as
  select p.display_name, p.avatar, p.rating, p.rating_games,
         rank() over (order by p.rating desc) as rank
    from public.profiles p
   where p.rating_games >= 5           -- placement threshold
     and p.hide_from_leaderboard = false
     and p.name_status = 'ok'
     and p.deleted_at is null
     and nullif(trim(p.display_name), '') is not null
   order by p.rating desc
   limit 100;
grant select on public.skill_leaderboard to anon, authenticated;
```

**A separate view, not a modified one** — it keeps the XP board's proven privacy shape untouched and makes the two independently revertible. `rating_games >= 5` prevents a single lucky match topping the board.

## C.21 Seasons `[NOT A TABLE — yet]`

Ranked seasons are Phase 3 (PRD §40). Adding the table now would leave it empty and joined to nothing.

**Season-readiness is achieved by design, not by a table.** `profiles.rating` is the *current* rating; `rating_history` is already the per-match record. When seasons arrive, the additive migration is:

```sql
create table public.seasons (
  id serial primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null
);
alter table public.rating_history add column season_id int references public.seasons(id);
create table public.season_ratings (
  season_id int  not null references public.seasons(id),
  user_id   uuid not null references auth.users on delete cascade,
  rating int not null, rating_games int not null, peak_rating int not null,
  primary key (season_id, user_id)
);
```
`profiles.rating` becomes the current-season cache. **No existing column changes meaning.** That is what makes it safe to defer.

## C.22 Battles `[ALTER]` — `public.battle_rooms`

```sql
-- 0013_quick_match.sql  (additive)
alter table public.battle_rooms
  add column if not exists is_public   boolean not null default false,
  add column if not exists rated       boolean not null default false,
  add column if not exists rematch_of  uuid references public.battle_rooms(id) on delete set null;

create index if not exists battle_rooms_public_idx
  on public.battle_rooms (created_at desc)
  where is_public and status = 'lobby';
```

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | ✗ | `gen_random_uuid()` | **PK** |
| `pin` | `text` | ✗ | — | 6 chars, confusable-free alphabet |
| `admin_id` | `uuid` | ✗ | — | FK → `auth.users` cascade. Host; reassigned on succession |
| `status` | `text` | ✗ | `lobby` | check: `lobby\|countdown\|active\|finished\|aborted\|expired` |
| `max_players` | `int` | ✗ | `8` | check `between 2 and 8` |
| `passage_chars` | `int` | ✗ | — | Length only — **the text is elsewhere on purpose** |
| `passage_meta` | `text` | ✓ | — | |
| `difficulty` | `text` | ✗ | `normal` | |
| `time_limit_sec` | `int` | ✗ | `180` | check `between 30 and 900` |
| `starts_at` / `deadline_at` | `timestamptz` | ✓ | — | **Written inside Postgres only** |
| `expires_at` | `timestamptz` | ✗ | `now() + 30min` | |
| **`is_public`** | `boolean` | ✗ | `false` | `[NEW]` Quick Match opt-in |
| **`rated`** | `boolean` | ✗ | `false` | `[NEW]` Whether this match moves rating |
| **`rematch_of`** | `uuid` | ✓ | — | `[NEW]` FK self, `set null` |

**Indexes:** `battle_rooms_pin_live_uniq (pin) where status in (lobby,countdown,active)` — **partial**, so finished codes are reusable · `battle_rooms_admin_idx` · `battle_rooms_reap_idx` · `[NEW]` `battle_rooms_public_idx` partial.

**RLS unchanged.** `is_public` does **not** relax `members read` — discovery goes through a definer RPC (§D.4). This is the load-bearing decision of the whole matchmaking design.

## C.23 Battle participants `[ALTER]` — `public.battle_players`

```sql
alter table public.battle_players
  add column if not exists ready boolean not null default false;
```

| Column | Type | Null | Notes |
|---|---|---|---|
| `room_id` | `uuid` | ✗ | **PK part**, FK cascade |
| `user_id` | `uuid` | ✗ | **PK part**, FK cascade |
| `display_name` / `avatar` | `text` | ✓ | **Snapshotted at join** — a room-mate cannot read `profiles` |
| `is_admin` | `boolean` | ✗ | |
| `joined_at` / `left_at` | `timestamptz` | ✗/✓ | `left_at is null` = present |
| `progress_chars`, `wpm`, `accuracy`, `mistakes` | mixed | ✗ | Durable checkpoint, written ≤ every 5 s |
| `status` | `text` | ✗ | check: `waiting\|racing\|finished\|forfeit\|disconnected` |
| **`ready`** | `boolean` | ✗ | `[NEW]` Lobby readiness |

**The name/avatar snapshot is a security decision, not denormalisation for speed** (`0009:78-84`): `profiles` is readable only by its owner and admins, and loosening that to render a roster would expose goal settings and streak history to strangers.

**The one client write policy in the entire battle system:** own row, `update` only, only while `status in (countdown, active)`. `ready` requires widening it to the `lobby` phase — **narrowly**, and it must not widen which *columns* are writable. Postgres RLS cannot restrict columns, so `ready` is set by an RPC (§D.5) and the existing policy is left alone.

## C.24 Matchmaking `[NOT A TABLE]`

No queue table. Quick Match resolves against **live lobby rows that already exist**:

1. `battle_find_public()` → joinable public lobbies
2. None → open a public room and wait (the room *is* the queue entry)
3. 60 s → offer a solo time trial

A `matchmaking_queue` table would duplicate state that `battle_rooms` already holds, and would need its own reaper, its own consistency rules, and a way to reconcile with rooms. **The room is the queue.**

## C.25 Battle events `[NOT A TABLE]`

Live telemetry goes over Broadcast and **never touches Postgres** — the reasoning is recorded at `useBattleRoom.js:8-30`: 8 players × 1 Hz × 2 min ≈ 960 row updates on a table 8 people subscribe to, which is *"not a scaling worry, it is a design error."*

Durability is provided by the 5-second checkpoint on `battle_players` and the immutable `battle_results` row.

**This holds for combat too** — see §C.28.

## C.26 Battle results `[KEEP]` — `public.battle_results`

Append-only and immutable. Separate from `battle_players` because the roster row mutates all race long and a result must not.

| Column | Type | Null | Notes |
|---|---|---|---|
| `room_id` / `user_id` | `uuid` | ✗ | **PK**, both FK cascade |
| `display_name` / `avatar` | `text` | ✓ | Snapshotted |
| `correct_chars`, `typed_chars`, `mistakes` | `int` | ✗ | |
| `accuracy` | `real` | ✗ | Clamped 0–100 server-side |
| `consistency` | `real` | ✓ | |
| **`wpm`** | `real` | ✗ | **Server-recomputed.** Ranking uses this |
| `client_wpm` | `real` | ✓ | What the browser claimed — kept so divergence is visible |
| `finished` | `boolean` | ✗ | |
| `finished_at` | `timestamptz` | ✓ | |
| `duration_sec` | `real` | ✗ | Server-measured |
| `rank` | `int` | ✓ | Materialised by `battle_settle()` |
| `flags` | `text[]` | ✗ | §C.33 |

**Immutability is structural:** `on conflict do nothing` + **no update policy exists**. A retried call cannot rewrite a result, and nothing can rewrite it later.

## C.27 Multiplayer state `[KEEP]`

State is `battle_rooms.status` + the derived phase. **There is no separate state table and no client-held state machine** — phase is a pure function of `(status, starts_at, clock offset)` (`useBattleRoom.js:266-276`), which is why a refresh mid-match reconstructs the right screen.

**The countdown→active transition has no owner.** `starts_at` is the authority; the first client past it calls `battle_touch()`.

## C.28 Future combat state `[NOT A TABLE — design constraint]`

Not built. The seam:

| Requirement | Design |
|---|---|
| Combat resolution | **Server-arbitrated on a tick (~2 s), not per keystroke.** Per-hit RPC round-trips are too slow (TRD T-7) |
| Event stream | Broadcast, higher rate, different payload — **not** persisted (§C.25) |
| Result storage | **A sibling table `combat_results`, not a widened `battle_results`** — combat has HP, rounds and no completion state |
| Room model | `battle_rooms` with `max_players = 2` and a registry mode of `scoring: 'contest'` |
| New engine value | One consecutive-correct counter. Everything else exists in `live` |

**The constraint on this cycle:** nothing may assume "one shared passage, everyone finishes." `battle_results.finished` already tolerates `false` (forfeits), and `battle_settle()` orders finishers first rather than requiring completion — so the existing ranking model does not block combat.

## C.29 Notifications `[NOT A TABLE]`

**Rejected as a product decision** (`03-app-flow.md` §2.28): a local-first offline typing trainer has nothing legitimate to interrupt with. No push, no digests, no badge counts.

What serves the same needs today: toasts (confirm an action), inline status (connection/sync/AI), the result panel (achievement, level-up), the streak indicator (ambient return hook).

**When it would become necessary:** genuinely asynchronous events — a rematch invitation to an absent player, or tournament scheduling (Phase 5). At that point the minimal shape is one table:
```sql
-- NOT CREATED. Recorded so it is not designed twice.
notifications(id, user_id, kind, payload jsonb, read_at, created_at)
```
Rematch as specified (§D.6) is **synchronous** — everyone is on the results screen — so it needs none of this.

## C.30 Settings `[KEEP]` — `profiles.settings jsonb`

Deliberately schemaless. 14 keys today; `store.jsx:54-64` shallow-merges over `EMPTY`, so a key added in a later version gets its default automatically and **no migration is needed to add a setting**.

| Key | Type | Default |
|---|---|---|
| `theme` | `'system'\|'light'\|'dark'` | `system` |
| `sound`, `showKeyboard`, `smoothCaret`, `confetti`, `blindMode`, `stopOnError`, `aiText`, `handGuide`, `fullscreen`, `codeIntroOpen` | `boolean` | mixed |
| `caret` | `'block'\|'line'\|'underline'` | `block` |
| `handGuideSeen` | `int` | `0` |
| `lastLanguage` | `text` | `javascript` |

**Validation:** ≤4 KB serialised · unknown keys preserved (forward compatibility) · **never trusted for authorization**.

## C.31 Reports / analytics `[KEEP]` + `[ALTER]`

### `daily_stats` `[KEEP]`
PK `(user_id, day)`. Rollup that powers the heatmap without scanning `sessions`. Written by sync, read by `admin_daily`.

### `ai_usage` `[ALTER]`
```sql
-- 0014_ai_proxy.sql — once the proxy is the only writer
drop policy if exists "insert own" on public.ai_usage;
```
Currently client-reported and **advisory only** — `0002` says so explicitly. When the AI proxy lands (TRD §B.3) the function becomes the sole writer and the client insert policy is dropped, making the numbers trustworthy.

### `admin_daily` `[KEEP]` · `admin_user_overview()` `[KEEP]`
The latter is a `SECURITY DEFINER` **function, not a view**, because it joins `auth.users`, which `authenticated` has no grant on. The `where public.is_admin()` guard is what makes a non-admin get zero rows rather than an error.

## C.32 Admin / moderation `[KEEP]` + `[NEW]`

### `user_roles` `[KEEP]`
`(user_id pk, role app_role)`. **No insert/update/delete policy exists at all** — promoting an admin is a deliberate manual step. Keep it that way.

### `public.moderation_reports` `[NEW]` — table 2 of 2

```sql
create table if not exists public.moderation_reports (
  id           bigint generated always as identity primary key,
  reporter_id  uuid references auth.users on delete set null,
  target_type  text not null check (target_type in ('display_name', 'chat_message')),
  target_id    text not null,
  reason       text not null check (reason in ('offensive','impersonation','spam','other')),
  detail       text,
  status       text not null default 'open'
    check (status in ('open','actioned','dismissed')),
  resolved_by  uuid references auth.users on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index moderation_reports_open_idx on public.moderation_reports (created_at desc) where status = 'open';
create unique index moderation_reports_once_idx on public.moderation_reports (reporter_id, target_type, target_id) where status = 'open';

alter table public.moderation_reports enable row level security;
create policy "report as self" on public.moderation_reports
  for insert with check (auth.uid() = reporter_id);
create policy "admins read all" on public.moderation_reports
  for select using (public.is_admin());
create policy "admins resolve" on public.moderation_reports
  for update using (public.is_admin());
```

**One generic table, not one per target type** — the columns would be identical and the admin surface would need a union. `target_id` is `text` so it can hold a uuid or a bigint without a polymorphic FK (which Postgres cannot enforce anyway).

`moderation_reports_once_idx` stops one reporter filing the same open report repeatedly.

**Enforcement:** an actioned `display_name` report sets `profiles.name_status = 'blocked'`, which the leaderboard views already filter (§C.20).

## C.33 Anti-cheat data `[KEEP]` + `[NEW]` view

**Already stored, and well:**

| Signal | Where | Computed |
|---|---|---|
| `flags` | `battle_results.flags text[]` | `battle_finish()` |
| `over-length` | flag | `correct_chars > passage_chars` |
| `impossible-speed` | flag | `elapsed < correct / 20.0` (≈240 WPM sustained) |
| Client/server divergence | `client_wpm` vs `wpm` | Both stored |
| Server timing | `duration_sec` | From `starts_at`, written inside Postgres |

### `public.flagged_results` `[NEW]` — a view, not a table
```sql
create view public.flagged_results with (security_invoker = on) as
  select r.room_id, r.user_id, r.display_name, r.wpm, r.client_wpm,
         r.accuracy, r.mistakes, r.duration_sec, r.flags, r.created_at,
         abs(coalesce(r.client_wpm, r.wpm) - r.wpm) as wpm_divergence
    from public.battle_results r
   where public.is_admin()
     and (array_length(r.flags, 1) > 0
          or abs(coalesce(r.client_wpm, r.wpm) - r.wpm) > 15);
```
**A view because the data already exists.** A `cheat_reports` table would duplicate `battle_results` and immediately drift.

**`[NEW]` P1 signal — CH-2:** a coefficient of variation near zero over a long passage is machine-like. `consistency` is already computed and stored, so this is a threshold in `battle_finish()`, not new data.

**Rule:** flagged results are excluded from rating updates (§D.7).

## C.34 Audit logs `[ALTER]` — `public.auth_events`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `bigint` | ✗ | **PK** |
| `user_id` | `uuid` | ✓ | FK `set null` — a failed login has no session |
| `event` | `text` | ✗ | `signup\|login\|logout\|failed\|admin_view` + `[NEW]` `admin_action\|data_export\|data_delete` |
| `provider` | `text` | ✓ | `email\|google\|anonymous\|email-upgrade` |
| `created_at` | `timestamptz` | ✗ | |

**`[NEW]`** add a `detail jsonb` column so an `admin_action` can record *what* was done.

**Extend the vocabulary rather than adding a table.** A separate `admin_actions` table would have the same four columns and force the admin UI to read two logs.

**The anonymous-insert policy stays as-is** — `(auth.uid() = user_id) or (user_id is null and event = 'failed')`. It is scoped to exactly one event value, deliberately, because a failed login has no session by definition.

---

# PART D — API contracts

## D.0 Conventions

**Three surfaces:** PostgREST (RLS-gated table access), Postgres RPC (definer functions), and — new — one HTTPS function for AI.

**Every new RPC follows the `0009` template.** The checklist is in TRD §B.33 SEC-1.

**Error codes:** `TF###` for new functions, mirroring `BF###`. The client maps them to copy; **no caller string-matches a Postgres message**.

## D.1 Existing RPCs `[KEEP]`

All 12 battle functions unchanged. See `00-codebase-audit.md` §3.

## D.2 `battle_rematch(p_room uuid)` `[NEW]`

```
Request   { p_room: uuid }
Returns   public.battle_rooms
```

| Check | Error |
|---|---|
| Signed in | `TF000` |
| Caller was in `p_room` | `TF001` |
| `p_room.status = 'finished'` | `TF002` |
| No rematch already exists for `p_room` | returns the existing room (idempotent) |
| Caller has < 3 live rooms | `BF010` — **must re-run `battle_create`'s cap** |

**Behaviour:** mints a new room copying `difficulty`, `time_limit_sec`, `max_players`, sets `rematch_of = p_room`, picks a **fresh passage**, and inserts the caller as host. Other players join via the results screen, which polls `rematch_of`.

> **Risk this closes:** without re-running the host cap, rematch becomes an unlimited room-creation path.

## D.3 `battle_set_ready(p_room uuid, p_ready boolean)` `[NEW]`

```
Request   { p_room: uuid, p_ready: boolean }
Returns   void
```
Definer, because RLS cannot restrict *which column* an update touches. Rejects unless the caller is in the room and `status = 'lobby'` (`TF003`).

## D.4 `battle_find_public(p_limit int default 10)` `[NEW]` — **security-critical**

```
Returns   setof { pin text, players int, max_players int,
                  difficulty text, time_limit_sec int, rated boolean }
```

```sql
create or replace function public.battle_find_public(p_limit int default 10)
returns table (pin text, players int, max_players int,
               difficulty text, time_limit_sec int, rated boolean)
language sql security definer stable set search_path = '' as $$
  select r.pin,
         (select count(*)::int from public.battle_players p
           where p.room_id = r.id and p.left_at is null),
         r.max_players, r.difficulty, r.time_limit_sec, r.rated
    from public.battle_rooms r
   where r.is_public
     and r.status = 'lobby'
     and r.expires_at > now()
     and auth.uid() is not null
     and (select count(*) from public.battle_players p
           where p.room_id = r.id and p.left_at is null) < r.max_players
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;
revoke execute on function public.battle_find_public(int) from public, anon;
grant  execute on function public.battle_find_public(int) to authenticated;
```

**Why this does not reintroduce PIN enumeration:**

| Property | Effect |
|---|---|
| Takes **no PIN input** | Cannot be used to probe a specific code |
| Returns only `is_public` **and** `lobby` **and** not-full rooms | A private or live room is never disclosed |
| `auth.uid() is not null` | Signed-out callers get nothing |
| Table policy untouched | `select … where pin = 'ABC123'` still returns zero rows |
| `limit` clamped 1–20 | Cannot be used to enumerate the whole public set cheaply |

## D.5 `profile_delete_self()` `[NEW]`

```
Returns   void
```
Deletes every row owned by `auth.uid()` across `sessions`, `daily_stats`, `key_stats`, `achievements`, `chat_messages`, `rating_history`, `battle_players`, `battle_results`; sets `profiles.deleted_at`, blanks `display_name` and `avatar`; writes an `auth_events` row with `event = 'data_delete'`; then deletes the auth user.

**Soft-deletes the profile rather than removing it** so historical `battle_results` FKs stay valid; the leaderboard views already filter `deleted_at is null`.

## D.6 `report_content(...)` `[NEW]`
```
Request   { p_target_type: text, p_target_id: text,
            p_reason: text, p_detail: text }
Returns   void
```
Inserts into `moderation_reports` as `auth.uid()`. Rate-limited (§I).

## D.7 `battle_settle(p_room)` `[ALTER]` — rating pass

Existing ordering logic unchanged. **Appended:** for each ordered pair of results, apply a pairwise Elo update; write `rating_history`; update `profiles.rating` and `rating_games`.

```
K = 40 when rating_games <  10   (placement)
    24 when rating_games <  30
    16 otherwise
```

**Skipped entirely when:** `room.rated = false`, or the result carries any `flags`, or fewer than 2 finishers.

> **Risk:** `battle_settle()` runs inside the finish transaction, so a bug here fails a *match*, not just a number. Build and test it standalone against seeded data before wiring it in (TRD §B.15).

## D.8 `POST /api/ai` `[NEW]` — the one HTTP endpoint

```
Request   { surface, messages[], maxTokens?, temperature?, stream? }
Response  application/json  { text, reasoning?, provider, model, usage }
          text/event-stream (when stream: true) — OpenAI-shaped chunks
Auth      Supabase JWT in Authorization: Bearer
Errors    { error: { reason, message } }  reason ∈ AI_REASON_COPY keys
```

Moves `ai-runner.js`'s hedging and failover server-side, keeps keys out of the bundle, and becomes the sole writer of `ai_usage`. **Node runtime, not edge** — streaming works fine on Node and edge loses the APIs for nothing.

## D.9 Request/response shapes — table access

| Operation | Call | Conflict target |
|---|---|---|
| Push sessions | `upsert(rows)` | `user_id,ts` + `ignoreDuplicates` |
| Push profile | `upsert(row)` | `id` |
| Push key stats | `upsert(rows)` | `user_id,key` |
| Push achievements | `upsert(rows)` | `user_id,achievement` + `ignoreDuplicates` |
| Push daily | `upsert(rows)` | `user_id,day` |
| Pull everything | 5 parallel selects | — |

**Unchanged.** `sync.js` already implements this correctly, including the normalisation that migrations `0006`/`0008` exist to protect.

---

# PART E — Realtime events

**Channel:** `battle:{room_uuid}` — **the UUID, never the PIN.** A PIN is a six-character secret people read aloud.

## E.1 Durable — Postgres Changes (RLS-filtered)

| Table | Events | Client action |
|---|---|---|
| `battle_rooms` | `*` filtered `id=eq.{room}` | Replace room state → phase re-derives |
| `battle_players` | `*` filtered `room_id=eq.{room}` | Refetch roster |
| `battle_results` | `INSERT` filtered `room_id=eq.{room}` | Refetch results + room |

`replica identity full` on these three so RLS can evaluate against change events. **Do not copy this onto `sessions`** — `0009:836-838` warns explicitly.

## E.2 Ephemeral — Broadcast

| Event | Payload | Rate |
|---|---|---|
| `tick` | `{u, p, w, a, m}` | ≤1 Hz, delta-suppressed |
| `done` | `{u, p, w, a, m}` | Once |
| `[NEW]` `ready` | `{u, r}` | On change |

Single-letter keys and integers — ~60 bytes rather than ~180.

**Broadcast is advisory.** Everything it carries also arrives, slower, through the durable path. A dropped tick costs a moment of staleness, never an outcome.

## E.3 Combat (future)
`combat` event at ~10 Hz on the same channel, payload `{u, hp, combo, action}`. **Never persisted.** Quota must be modelled before this ships (TRD U-8).

---

# PART F — Authentication flow

```
                    ┌──────────────┐
                    │  Anonymous   │  no account, local-only
                    └──────┬───────┘
                           │ name entered, or Battlefield join
                           ▼
                    ┌──────────────┐
                    │    Guest     │  real auth.users row, is_anonymous
                    └──────┬───────┘
                           │ updateUser(email|oauth) — SAME id
                           ▼
                    ┌──────────────┐
                    │  Identified  │  email or Google
                    └──────────────┘
```

**The id never changes.** `upgradeGuestWithEmail()` uses `auth.updateUser()`, so sessions, key stats and achievements written under the guest id stay owned by the same row (`supabase.js:117-135`). This is what makes "sign up later" lossless.

**On first sign-in per device:** `adoptLocalState()` runs **once**, gated by `typeforge.adopted`. It sums key stats, unions achievements, and keeps the larger of xp/streak — so a local-only user never loses progress by signing up.

**Write-after-read is enforced.** `hydratedRef` blocks every push until the initial pull completes. This is not optional: a push after a failed pull *"zeroed a real account's XP from 790 to 0 during testing"* (`sync.js:422-435`).

---

# PART G — Authorization model

**Four levels. RLS is the boundary at every one.**

| Level | Mechanism | Reach |
|---|---|---|
| Anonymous | No JWT | `leaderboard`, `skill_leaderboard` only |
| Authenticated | `auth.uid() = user_id` | Own rows, everywhere |
| Room member | `in_battle(room_id)` | Room-scoped cross-user reads |
| Admin | `is_admin()` | Additive read on every table |

**Write authority:**

| Data | Who writes |
|---|---|
| Own profile, sessions, stats, achievements, chat | The user (RLS) |
| Own battle progress | The user — **only while `status in (countdown, active)`** |
| Everything else about a battle | **RPC only.** No policy exists |
| Ratings | `battle_settle()` only. No insert policy on `rating_history` |
| Roles | **Manual SQL only.** No self-service path, by design |
| `ai_usage` | Client today; the proxy once it lands |

**Three definer helpers break RLS recursion:** `is_admin()`, `in_battle()`, `is_battle_admin()`, `battle_started()`. A policy on `battle_players` that queried `battle_players` would re-enter its own RLS.

---

# PART H — Data validation

**Three layers, with clear ownership. UI validation is never a security control.**

| Layer | Owns | Enforced by |
|---|---|---|
| **Postgres** | Anything a client could lie about | `check`, unique indexes, RPC bodies |
| **Contract** | Shape crossing a module boundary | `createSessionResult()` |
| **UI** | Immediate feedback only | Component state |

## H.1 Server-enforced (authoritative)

| Rule | Where |
|---|---|
| Passage 40–4000 chars | `battle_create` `BF008` |
| 2–8 players | column check + `battle_join` `BF003` |
| Time limit 30–900 s | column check |
| Room status transitions | `check` + RPC guards |
| `correct_chars` clamped to `passage_chars` | `battle_finish` |
| `accuracy` clamped 0–100 | `battle_finish` |
| WPM recomputed, client value ignored for ranking | `battle_finish` |
| PIN unique among live rooms | partial unique index |
| One session per `(user_id, ts)` | unique index |
| Achievement unlock date never moves | `ignoreDuplicates` |
| Result immutable | `on conflict do nothing`, no update policy |

## H.2 Contract-enforced `[NEW]`

`createSessionResult()` must **reject**, not coerce:

| Field | Rule |
|---|---|
| `wpm`, `rawWpm` | finite, `0 ≤ x ≤ 400` |
| `accuracy`, `consistency` | finite, `0 ≤ x ≤ 100` |
| `durationSec` | finite, `> 0` |
| `chars`, `errors` | integer, `≥ 0` |
| `modeId` | present in the registry |
| `keyStats` | every key length 1, `wrong ≤ total` |

> **Why rejection rather than coercion:** `sync.js:78-96` currently coerces with `?? 0` at the row boundary. A corrupt run therefore persists as a plausible one — 0 WPM at 100% accuracy — and pollutes every average built on it.

## H.3 Client-side (feedback only)
Display name ≤40 chars · PIN exactly 6 chars from the confusable-free alphabet · avatar ≤64 KB, image MIME · custom text non-empty.

---

# PART I — Error formats & rate limits

## I.1 Error format

```
Postgres  { code: 'BF003' | 'TF002' | '42501', message, details, hint }
HTTP      { error: { reason: 'rate-limit', message: '…' } }
Client    Error & { code, raw }   — via battle/api.js rpc()
```

**Every code maps to actionable copy.** `42501` (permission denied) is already remapped to "sign in first", because the raw message is *"true and useless"* (`api.js:41-43`). Every new code follows that standard.

| Range | Domain |
|---|---|
| `BF000–BF016` | Battlefield (existing) |
| `TF000–TF099` | New RPCs |
| `42501` | Remapped to `BF000` |

## I.2 Rate limits `[NEW]`

**Postgres-side where possible — no new infrastructure.**

| Action | Limit | Mechanism |
|---|---|---|
| Room creation | 3 concurrent (existing) + 10 / 10 min | `battle_create` count query — uses the existing `admin_idx` |
| Quick Match | 20 / 10 min | Same pattern |
| Moderation reports | 10 / day | Count on `moderation_reports` |
| AI calls | 60 / hour/user | Proxy function, in-memory + `ai_usage` count |
| Auth | Supabase built-in | — |
| Session writes | Sync debounce (2 s) | Client; monitor only |

```sql
-- the pattern, inside battle_create
if (select count(*) from public.battle_rooms
     where admin_id = uid and created_at > now() - interval '10 minutes') >= 10 then
  raise exception 'Too many rooms created recently' using errcode = 'TF010';
end if;
```

---

# PART J — Security considerations

## J.1 Preserved — do not weaken

Every property in §A.3, plus: realtime keyed on UUID · anon gets nothing beyond the two board views · `search_path = ''` on every definer function · no self-service admin.

## J.2 New surface risk register

| # | Change | Risk | Mitigation |
|---|---|---|---|
| 1 | `is_public` on rooms | Room enumeration returns | RPC takes no PIN; table policy untouched; limit clamped (§D.4) |
| 2 | `battle_rematch` | Bypasses the 3-room cap | Re-runs every `battle_create` check (§D.2) |
| 3 | `battle_set_ready` | Widens the client write policy | Definer RPC instead; existing policy untouched (§D.3) |
| 4 | Rating in `battle_settle` | A bug fails the whole finish transaction | Build standalone; test on seeded data; flagged results excluded |
| 5 | `moderation_reports` | Report spam / harassment | Unique open-report index + 10/day limit |
| 6 | `profile_delete_self` | Deletes the wrong user's data | Definer, scoped to `auth.uid()` only, never takes an id parameter |
| 7 | AI proxy | New public HTTP surface | JWT required; rate-limited; keys server-side |

## J.3 Known accepted risks

| Risk | State | Action |
|---|---|---|
| AI keys in bundle | Documented `config.js:13-18` | Closed by §D.8 (P1) |
| `ai_usage` client-reported | Documented `0002` | Closed by §C.31 (P1) |
| No moderation | — | Closed by §C.32 (P1) |
| No deletion path | — | Closed by §D.5 (P1) |
| `auth_events` anonymous insert | Scoped to `event = 'failed'` | Accepted — a failed login has no session |

---

# PART K — Migration sequence

| # | Migration | Type | Risk | Gate |
|---|---|---|---|---|
| `0010` | Drop `learn_progress`, `problem_progress`, `beta_votes`, `beta_vote_tally` | **Destructive** | **High** | Ships **only after** `sync.js` stops writing `problem_progress`, and after a staging rehearsal |
| `0011` | `profiles` + rating/moderation/deleted columns; `rating_history`; `skill_leaderboard`; rebuilt `leaderboard` | Additive | Low | `check-contrast` unaffected; boards render |
| `0012` | `moderation_reports`; `report_content()`; `profile_delete_self()` | Additive | Low | Deletion verified to remove cloud rows |
| `0013` | `is_public`, `rated`, `rematch_of`, `ready`; `battle_find_public()`, `battle_rematch()`, `battle_set_ready()` | Additive | **Medium** | **Security review against §J.2** before apply |
| `0014` | Rating pass in `battle_settle()`; `flagged_results` view | Behavioural | **Medium** | Tested standalone on seeded data first |
| `0015` | Drop `ai_usage` client insert policy | Restrictive | Low | Only after the proxy is live |

**Ordering rules:**
1. **`0010` runs last among the MVP set**, not first. Dropping a table the client still writes to breaks sync immediately.
2. **`0013` needs explicit security sign-off** — it is the only migration that changes what one user can discover about another.
3. **`0014` is behavioural, not structural.** It changes what a finished match *does*. Ship it behind `battle_rooms.rated`, defaulting `false`, so it can be enabled per room.

**Rehearsal requirement (TRD BK-2):** every migration runs against a staging copy first. `0010` in particular, because schema drift between `migrations/` and the deployed database is unverified (TRD U-5).

---

## Appendix A — Entity index

| # | Domain | Object | Status |
|---|---|---|---|
| 1 | Users | `auth.users` | `[KEEP]` |
| 2 | Authentication | GoTrue | `[KEEP]` |
| 3 | Profiles | `profiles` | `[ALTER]` +4 cols |
| 4 | Typing sessions | `sessions` | `[KEEP]` |
| 5 | Typing tests | — | `[NOT A TABLE]` |
| 6 | Practice modes | — | `[NOT A TABLE]` |
| 7 | Text/templates | — | `[NOT A TABLE]` |
| 8 | Code templates | — | `[NOT A TABLE]` |
| 9 | Categories | — | `[NOT A TABLE]` |
| 10 | Difficulty | `check` constraint | `[NOT A TABLE]` |
| 11 | WPM records | derived | `[NOT A TABLE]` |
| 12 | Accuracy records | derived | `[NOT A TABLE]` |
| 13 | Mistakes | `key_stats` | `[KEEP]` |
| 14 | Personal records | derived | `[NOT A TABLE]` |
| 15 | Session history | `sessions` | `[KEEP]` |
| 16 | XP | `profiles.xp` | `[KEEP]` |
| 17 | Levels | pure function | `[NOT A TABLE]` |
| 18 | Ranks | `profiles.rating` + `rating_history` | `[ALTER]` + `[NEW]` |
| 19 | Achievements | `achievements` | `[KEEP]` |
| 20 | Leaderboards | `leaderboard`, `skill_leaderboard` | `[KEEP]` + `[NEW]` |
| 21 | Seasons | — | `[NOT A TABLE — yet]` |
| 22 | Battles | `battle_rooms` | `[ALTER]` +3 cols |
| 23 | Battle participants | `battle_players` | `[ALTER]` +1 col |
| 24 | Matchmaking | — | `[NOT A TABLE]` |
| 25 | Battle events | Broadcast | `[NOT A TABLE]` |
| 26 | Battle results | `battle_results` | `[KEEP]` |
| 27 | Multiplayer state | `battle_rooms.status` | `[KEEP]` |
| 28 | Combat state | — | `[NOT A TABLE]` |
| 29 | Notifications | — | `[NOT A TABLE]` |
| 30 | Settings | `profiles.settings` | `[KEEP]` |
| 31 | Reports/analytics | `daily_stats`, `ai_usage`, `admin_daily` | `[KEEP]`/`[ALTER]` |
| 32 | Admin/moderation | `user_roles`, `moderation_reports` | `[KEEP]` + `[NEW]` |
| 33 | Anti-cheat | `battle_results.flags`, `flagged_results` | `[KEEP]` + `[NEW]` view |
| 34 | Audit logs | `auth_events` | `[ALTER]` +1 col |

## Appendix B — Verification

| Check | Result |
|---|---|
| All 34 requested domains addressed | ✅ Appendix A |
| Every entity: fields, types, nullability, PK, FK, indexes, constraints, validation | ✅ Part C |
| Existing structures inspected before designing | ✅ Part A, traced to files |
| Unnecessary tables avoided, with reasons | ✅ 11 `[NOT A TABLE]` entries |
| **Net new tables: 2** | ✅ `rating_history`, `moderation_reports` |
| Nothing in `0009_battlefield.sql` modified | ✅ additive columns only |
| Session identity `(user_id, ts)` untouched | ✅ §C.4 |
| API contracts, realtime, auth, authz, validation, errors, limits, security | ✅ Parts D–J |
| Migration order prevents the sync-breaking case | ✅ §K rule 1 |
| Combat supported without a rewrite | ✅ §C.28 |
