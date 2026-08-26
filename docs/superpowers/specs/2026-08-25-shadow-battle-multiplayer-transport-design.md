# Shadow Battle — Multiplayer Transport & Rooms (Design)

**Status:** Plan 5 of the 8-plan Shadow Battle build sequence.
**Source of truth:** `docs/08-PRD-shadow-battle.md` §15 (Multiplayer Transport), §16 (Matchmaking), §17 (Private Duels), §18 (Live Games), §26 (Backend & Data Schema).

---

## Goal

Build the client-side multiplayer transport, room lifecycle state machine, real-time sync hooks, clock synchronization, and API layer for Shadow Battle.

---

## Architecture & Modules

### 1. `src/lib/shadow/api.js`
- Translates Postgres RPCs (`0010_shadow_battle.sql`) into typed, ergonomic async JavaScript functions.
- Provides comprehensive error code mapping (`SHADOW_ERROR_COPY` / `shadowErrorMessage`).
- Functions:
  - `createRoom({ visibility, fighterId, rated, band })`
  - `joinRoom(pin, fighterId)`
  - `setReady(roomId, ready)`
  - `setFighter(roomId, fighterId)`
  - `startMatch(roomId)`
  - `appendEvents(roomId, events)`
  - `sendHeartbeat(roomId)`
  - `settleRound(roomId, params)`
  - `settleMatch(roomId, results)`
  - `forfeitMatch(roomId)`
  - `leaveRoom(roomId)`
  - `closeRoom(roomId)`
  - `fetchPublicRooms()`
  - `fetchLeaderboard()`
  - `fetchMatchHistory(limit, offset)`
  - `serverTime()`
  - `lookupCode(pin)`

### 2. `src/lib/shadow/clock.js`
- High-precision NTP-style clock offset measurement against `arena_server_time()`.
- Reuses monotonic `performance.timeOrigin + performance.now()` to guarantee immune-to-jitter readings.
- Utilities: `measureClockOffset(samples = 5)`, `serverNow(offset)`, `msUntil(iso, offset)`.

### 3. `src/lib/shadow/useShadowRoom.js`
- React hook managing the lifecycle of a single 2-player Shadow Battle duel room.
- Dual-transport pattern (PRD §15.2):
  1. **Durable Postgres Changes:** Listens to `shadow_rooms`, `shadow_players`, `shadow_rounds`, `shadow_events` filtered on `room_id = roomId`.
  2. **Ephemeral Broadcast Channel (`room:shadow:${roomId}`):** High-frequency telemetry (opponent typing index, lane commitment, damage pops) that never touches the database.
- State exposed:
  - `room`: Current room record (status, seed, band, current_round, scores, server timestamps).
  - `players`: Roster `[p0, p1]` with connection status, readiness, cosmetics.
  - `selfSeat`: 0 or 1 (derived from `auth.uid()`).
  - `opponent`: The other player in the room.
  - `rounds`: Settled rounds history.
  - `results`: Final match results once finished.
  - `clockOffset`: Measured ms offset to server.
  - `isConnected`: Boolean realtime connection health.
  - `broadcastTick`: Broadcast helper for local typing telemetry.
  - `subscribeBroadcast`: Subscriber callback for opponent live telemetry.

### 4. `src/lib/shadow/useMatchmaking.js`
- Hook for ranked/casual auto-matchmaking queue.
- Handles enqueuing, polling for matches, timeout handling, and automatic room transition.

---

## Verification & Testing
- `api.test.js`: Mocked and unit tested RPC parameter serialization, error translation, and response unpacking.
- `clock.test.js`: Monotonic offset calculation, median filtering, jitter rejection.
- `useShadowRoom.test.js` / `multiplayer.test.js`: Hook state transitions, event log synchronization, and broadcast handling.
