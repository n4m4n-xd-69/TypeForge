# Shadow Battle — Backend Schema & RPC Surface (Design)

**Status:** Approved for planning. Plan 4 of the 8-plan Shadow Battle build sequence (see `typeforge-shadow-battle-build` project memory). Plans 0 (mode registry), 1 (combat reducer), 2 (word queue), and 3 (trial mode) are merged to `typeforge`.

**Source of truth:** `docs/08-PRD-shadow-battle.md` §26 (Backend & Data Schema), §7 (Game modes), §8.2 (CombatEvent wire protocol), §16 (Matchmaking), §18 (Live Games), §20 (Forge Rating), §21 (Anti-cheat & verification).

---

## Goal

Build `supabase/migrations/0010_shadow_battle.sql` — the complete Postgres database schema, row-level security policies, realtime publication bindings, and RPC functions required for Shadow Battle multiplayer duels, room management, event log persistence, match settlement, and ratings.

This migration discharges **SC-A3** (the room/contest concept is extensible to a duel without modifying `0009_battlefield.sql`).

---

## Key Schema Components

### 1. Tables (§26.3)

1. **`shadow_rooms`** — The match & room state.
   - `id uuid primary key default gen_random_uuid()`
   - `pin text` (partial unique index on live rooms)
   - `host_id uuid not null references auth.users on delete cascade`
   - `visibility text not null check (visibility in ('private', 'public'))`
   - `status text not null check (status in ('lobby','countdown','active','round_end','paused','finished','abandoned','cancelled','expired'))`
   - `seed bigint not null`
   - `band text not null default 'steel' check (band in ('ember', 'steel', 'damascus'))`
   - `rated boolean not null default false`
   - `current_round int not null default 1`
   - `score_p0 int not null default 0`, `score_p1 int not null default 0`
   - `starts_at timestamptz`, `round_starts_at timestamptz`, `round_deadline_at timestamptz`, `paused_at timestamptz`, `pause_ms_total int not null default 0`
   - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `expires_at timestamptz not null default now() + interval '30 minutes'`

2. **`shadow_players`** — 2 seats per room.
   - `room_id uuid not null references shadow_rooms on delete cascade`
   - `user_id uuid not null references auth.users on delete cascade`
   - `seat int not null check (seat in (0, 1))`
   - `display_name text`, `avatar text`, `fighter_id text not null default 'standard'`
   - `is_host boolean not null default false`
   - `ready boolean not null default false`
   - `connection text not null default 'connected' check (connection in ('connected', 'unstable', 'disconnected'))`
   - `last_seen_at timestamptz not null default now()`
   - `joined_at timestamptz not null default now()`, `left_at timestamptz`
   - `primary key (room_id, user_id)`, `unique (room_id, seat)`

3. **`shadow_events`** — Append-only combat event log (the source of truth).
   - `room_id uuid not null references shadow_rooms on delete cascade`
   - `seat int not null check (seat in (0, 1))`
   - `seq int not null`
   - `round int not null`
   - `card_index int not null`
   - `lane text not null check (lane in ('strike', 'guard'))`
   - `outcome text not null check (outcome in ('complete', 'expire', 'whiff'))`
   - `t_start int not null`, `t_end int not null`
   - `keystrokes int not null`, `errors int not null`
   - `iki_mean real not null default 0`, `iki_stdev real not null default 0`
   - `created_at timestamptz not null default now()`
   - `primary key (room_id, seat, seq)`

4. **`shadow_rounds`** — Settled per-round outcomes.
   - `room_id uuid not null references shadow_rooms on delete cascade`
   - `round int not null`
   - `winner_seat int check (winner_seat in (0, 1))` (null = draw)
   - `hp_p0 int not null`, `hp_p1 int not null`
   - `reason text not null check (reason in ('knockout', 'time', 'forfeit', 'double_ko'))`
   - `duration_ms int not null`
   - `settled_at timestamptz not null default now()`
   - `primary key (room_id, round)`

5. **`shadow_results`** — Immutable match outcomes (1 row per participant).
   - `room_id uuid not null references shadow_rooms on delete cascade`
   - `user_id uuid not null references auth.users on delete cascade`
   - `seat int not null check (seat in (0, 1))`
   - `outcome text not null check (outcome in ('win', 'loss', 'draw', 'forfeit'))`
   - `rounds_won int not null default 0`, `rounds_lost int not null default 0`
   - `damage_dealt int not null default 0`, `damage_taken int not null default 0`, `best_chain int not null default 0`
   - `wpm real not null default 0`, `accuracy real not null default 100`, `clean_rate real not null default 1`
   - `client_hp int not null default 1000`
   - `fr_before int not null default 1200`, `fr_after int not null default 1200`, `fr_delta int not null default 0`
   - `opponent_kind text not null check (opponent_kind in ('human', 'bot'))`
   - `bot_profile text`
   - `flags text[] not null default '{}'`
   - `created_at timestamptz not null default now()`
   - `primary key (room_id, user_id)`

6. **`shadow_ratings`** — Persistent Forge Rating & combat statistics per player.
   - `user_id uuid primary key references auth.users on delete cascade`
   - `fr int not null default 1200`, `peak_fr int not null default 1200`
   - `matches int not null default 0`, `wins int not null default 0`, `losses int not null default 0`, `draws int not null default 0`
   - `streak int not null default 0`, `best_streak int not null default 0`
   - `rounds_won int not null default 0`, `rounds_lost int not null default 0`
   - `damage_dealt bigint not null default 0`, `damage_taken bigint not null default 0`
   - `best_chain int not null default 0`, `parries int not null default 0`, `overdrives int not null default 0`
   - `avg_wpm real not null default 0`, `avg_accuracy real not null default 100`, `clean_rate real not null default 1`
   - `updated_at timestamptz not null default now()`

7. **`shadow_unlocks`** — Earned cosmetics.
   - `user_id uuid not null references auth.users on delete cascade`
   - `fighter_id text not null`
   - `unlocked_at timestamptz not null default now()`
   - `primary key (user_id, fighter_id)`

8. **`shadow_queue`** — Transient matchmaking queue.
   - `user_id uuid primary key references auth.users on delete cascade`
   - `fighter_id text not null default 'standard'`
   - `fr int not null default 1200`
   - `band text not null default 'steel'`
   - `enqueued_at timestamptz not null default now()`
   - `matched_room_id uuid references shadow_rooms on delete set null`
   - `matched_at timestamptz`

---

### 2. Row-Level Security (RLS) & Security Definer Functions (§26.4)

- `in_shadow(p_room_id uuid) returns boolean` (SECURITY DEFINER): Checks if `auth.uid()` is in `shadow_players` for the given room.
- `is_shadow_host(p_room_id uuid) returns boolean` (SECURITY DEFINER): Checks if `auth.uid()` is host of the room.
- Policies on tables:
  - `shadow_rooms`: Select allowed for room members (`in_shadow(id)` or `host_id = auth.uid()`) or admins. No direct insert/update/delete.
  - `shadow_players`: Select for room members. Update only own row (`user_id = auth.uid()`) for `ready` and `fighter_id` in `lobby` status.
  - `shadow_events`: Select for room members. Insert only via `shadow_event_append`.
  - `shadow_rounds`: Select for room members. No direct writes.
  - `shadow_results`: Select for room members and own rows. No direct writes.
  - `shadow_ratings`: Select for own row.
  - `shadow_unlocks`: Select for own row.

---

### 3. RPC Surface (§26.5)

- **Room Lifecycle:**
  - `shadow_create(p_visibility text, p_fighter_id text, p_rated boolean, p_band text)` -> returns room JSON.
  - `shadow_join(p_pin text, p_fighter_id text)` -> joins room by PIN.
  - `shadow_set_ready(p_room_id uuid, p_ready boolean)` -> updates ready status.
  - `shadow_set_fighter(p_room_id uuid, p_fighter_id text)` -> changes fighter in lobby.
  - `shadow_start(p_room_id uuid)` -> host only; writes server-anchored `starts_at` and `round_starts_at`.
  - `shadow_event_append(p_room_id uuid, p_events jsonb[])` -> batch appends validated events.
  - `shadow_heartbeat(p_room_id uuid)` -> updates `last_seen_at`.
  - `shadow_pause(p_room_id uuid)` / `shadow_resume(p_room_id uuid)` -> pause/resume mechanics.
  - `shadow_settle_round(p_room_id uuid, p_round int, p_winner_seat int, p_hp_p0 int, p_hp_p1 int, p_reason text, p_duration_ms int)` -> idempotent round settlement.
  - `shadow_settle_match(p_room_id uuid, p_results jsonb[])` -> match settlement, rating updates, results recording.
  - `shadow_forfeit(p_room_id uuid)` -> player forfeit handling.
  - `shadow_leave(p_room_id uuid)` -> lobby leave.
  - `shadow_close(p_room_id uuid)` -> host closes lobby.
  - `shadow_match_history(p_limit int, p_offset int)` -> paged match history.
  - `arena_server_time()` -> server clock handshake.
  - `arena_code_lookup(p_pin text)` -> unified code lookup returning `{ mode: 'shadow' | 'battle', room_id, status }`.

---

### 4. Realtime Publications (§26.7)

Add `shadow_rooms`, `shadow_players`, `shadow_rounds`, `shadow_events` to publication `supabase_realtime`.
