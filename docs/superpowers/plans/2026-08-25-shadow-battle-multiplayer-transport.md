# Shadow Battle Multiplayer Transport & Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build client-side multiplayer transport, room lifecycle state machine, real-time sync hooks, clock synchronization, and API layer for Shadow Battle duels.

---

## File Structure

**New:**
- `src/lib/shadow/api.js`
- `src/lib/shadow/api.test.js`
- `src/lib/shadow/clock.js`
- `src/lib/shadow/clock.test.js`
- `src/lib/shadow/useShadowRoom.js`
- `src/lib/shadow/useMatchmaking.js`
- `src/lib/shadow/multiplayer.test.js`

**Modified:**
- `docs/superpowers/SHADOW_BATTLE_STATUS.md`

---

### Task 1: API Layer & Error Mapping

**Files:**
- Create: `src/lib/shadow/api.js`
- Create: `src/lib/shadow/api.test.js`

**Objectives:**
- Implement all RPC wrappers corresponding to `0010_shadow_battle.sql`.
- Map errors using `SHADOW_ERROR_COPY` and `shadowErrorMessage`.
- Unit test all methods.

- [ ] **Step 1: Create `src/lib/shadow/api.js`**
- [ ] **Step 2: Create `src/lib/shadow/api.test.js` and verify tests pass**

---

### Task 2: Clock Synchronization

**Files:**
- Create: `src/lib/shadow/clock.js`
- Create: `src/lib/shadow/clock.test.js`

**Objectives:**
- Implement `measureClockOffset`, `serverNow`, `msUntil` using `performance.timeOrigin + performance.now()`.
- Unit test jitter rejection and median filtering.

- [ ] **Step 1: Create `src/lib/shadow/clock.js`**
- [ ] **Step 2: Create `src/lib/shadow/clock.test.js` and verify tests pass**

---

### Task 3: Dual-Transport Room Hook & Matchmaking

**Files:**
- Create: `src/lib/shadow/useShadowRoom.js`
- Create: `src/lib/shadow/useMatchmaking.js`
- Create: `src/lib/shadow/multiplayer.test.js`

**Objectives:**
- Implement `useShadowRoom` with Postgres Changes subscriptions and broadcast telemetry channel.
- Implement `useMatchmaking` for queueing and matching.
- Unit and integration test hook lifecycle and telemetry propagation.

- [ ] **Step 1: Create `src/lib/shadow/useShadowRoom.js`**
- [ ] **Step 2: Create `src/lib/shadow/useMatchmaking.js`**
- [ ] **Step 3: Create `src/lib/shadow/multiplayer.test.js`**
- [ ] **Step 4: Run `npm test` and verify full suite passes**

---

### Task 4: Status Update & Plan 5 Completion

- [ ] **Step 1: Update `docs/superpowers/SHADOW_BATTLE_STATUS.md` recording Plan 5 completion**
