# Shadow Battle Backend Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `supabase/migrations/0010_shadow_battle.sql` — the full Supabase backend schema for Shadow Battle. This provides 8 database tables, RLS security definer policies, the complete RPC surface for room creation, joining, start anchoring, event logging, round/match settlement, Forge Rating tracking, and realtime publications. This proves and discharges the **SC-A3** extensibility criterion.

**Architecture:**
- `supabase/migrations/0010_shadow_battle.sql`: Pure SQL migration adhering to Supabase / Postgres best practices.
- `src/lib/modes/stickmanExpressibility.test.js`: Updated to verify SC-A3 is discharged by the migration.
- `supabase/migrations/0010_shadow_battle.test.js`: Structural and syntax verification of `0010_shadow_battle.sql`.

---

## File Structure

**New:**
- `supabase/migrations/0010_shadow_battle.sql`
- `supabase/migrations/0010_shadow_battle.test.js`

**Modified:**
- `src/lib/modes/stickmanExpressibility.test.js`
- `docs/superpowers/SHADOW_BATTLE_STATUS.md`

---

### Task 1: SQL Migration `supabase/migrations/0010_shadow_battle.sql`

**Files:**
- Create: `supabase/migrations/0010_shadow_battle.sql`

**Objectives:**
- Tables: `shadow_rooms`, `shadow_players`, `shadow_events`, `shadow_rounds`, `shadow_results`, `shadow_ratings`, `shadow_unlocks`, `shadow_queue`.
- Views: `shadow_public_rooms`, `shadow_leaderboard`.
- RLS helpers: `in_shadow(uuid)`, `is_shadow_host(uuid)`.
- RPC functions:
  - `arena_server_time()`
  - `arena_mint_pin()`
  - `arena_code_lookup(text)`
  - `shadow_create(text, text, boolean, text)`
  - `shadow_join(text, text)`
  - `shadow_set_ready(uuid, boolean)`
  - `shadow_set_fighter(uuid, text)`
  - `shadow_start(uuid)`
  - `shadow_event_append(uuid, jsonb[])`
  - `shadow_heartbeat(uuid)`
  - `shadow_pause(uuid)` / `shadow_resume(uuid)`
  - `shadow_settle_round(uuid, int, int, int, int, text, int)`
  - `shadow_settle_match(uuid, jsonb[])`
  - `shadow_forfeit(uuid)`
  - `shadow_leave(uuid)`
  - `shadow_close(uuid)`
  - `shadow_match_history(int, int)`
  - `shadow_reap()`
- Realtime publication: `supabase_realtime`.

- [ ] **Step 1: Write `supabase/migrations/0010_shadow_battle.sql`**

---

### Task 2: Backend Migration Test & SC-A3 Extensibility Proof

**Files:**
- Create: `supabase/migrations/0010_shadow_battle.test.js`
- Modify: `src/lib/modes/stickmanExpressibility.test.js`

**Objectives:**
- Verify that `0010_shadow_battle.sql` contains all required table definitions, columns, RLS policies, and RPC definitions without syntax errors.
- Verify `0009_battlefield.sql` remains completely unmodified (G5).
- Discharge SC-A3 in `stickmanExpressibility.test.js`.

- [ ] **Step 1: Create `supabase/migrations/0010_shadow_battle.test.js`**
- [ ] **Step 2: Update `src/lib/modes/stickmanExpressibility.test.js`**
- [ ] **Step 3: Run `npm test` and verify full suite passes**

---

### Task 3: Status Update & Handoff

- [ ] **Step 1: Update `docs/superpowers/SHADOW_BATTLE_STATUS.md` recording Plan 4 completion**
