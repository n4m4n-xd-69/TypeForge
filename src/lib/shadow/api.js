import { supabase } from '../supabase.js';

/**
 * Shadow Battle API surface.
 *
 * Direct RPC and PostgREST client against 0010_shadow_battle.sql.
 * All mutations are gated via SECURITY DEFINER functions in Postgres.
 */

export const SHADOW_ERROR_COPY = {
  SB000: 'Sign in first — Shadow Battle requires an account.',
  SB001: 'No duel found with that code. Check the 4 characters and try again.',
  SB002: 'That duel has expired.',
  SB003: 'That duel is already full.',
  SB004: 'That match has already started.',
  SB005: 'Only the host can start the match.',
  SB006: 'Both fighters must be ready before starting.',
  SB007: 'You are not a participant in this duel.',
  SB008: 'The match is not active.',
  SB009: 'Could not generate a duel code. Try again.',
};

export function shadowErrorMessage(err) {
  if (!err) return null;
  if (SHADOW_ERROR_COPY[err.code]) return SHADOW_ERROR_COPY[err.code];
  if (err.code === '42501') return SHADOW_ERROR_COPY.SB000;
  return err.message ?? 'Something went wrong.';
}

/** Internal RPC runner with standardized error handling */
async function rpc(fn, args) {
  if (!supabase) {
    const err = new Error('Cloud sync is not configured, so Shadow Battle multiplayer is unavailable.');
    err.code = 'NO_CLOUD';
    throw err;
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const err = new Error(shadowErrorMessage(error));
    err.code = error.code;
    err.raw = error;
    throw err;
  }
  return data;
}

const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);

/* ── clock & lookup ──────────────────────────────────────────────────────── */

export async function serverTime() {
  return rpc('arena_server_time');
}

export async function lookupCode(pin) {
  return rpc('arena_code_lookup', { p_pin: String(pin || '').trim().toUpperCase() });
}

/* ── room lifecycle ──────────────────────────────────────────────────────── */

export async function createRoom({
  visibility = 'private',
  fighterId = 'standard',
  rated = false,
  band = 'steel',
} = {}) {
  return rpc('shadow_create', {
    p_visibility: visibility,
    p_fighter_id: fighterId,
    p_rated: rated,
    p_band: band,
  });
}

export async function joinRoom(pin, fighterId = 'standard') {
  return rpc('shadow_join', {
    p_pin: String(pin || '').trim().toUpperCase(),
    p_fighter_id: fighterId,
  });
}

export const createShadowRoom = createRoom;
export const joinShadowRoom = joinRoom;

export async function setReady(roomId, ready) {
  return rpc('shadow_set_ready', { p_room_id: roomId, p_ready: Boolean(ready) });
}

export async function setFighter(roomId, fighterId) {
  return rpc('shadow_set_fighter', { p_room_id: roomId, p_fighter_id: String(fighterId) });
}

export async function startMatch(roomId) {
  return rpc('shadow_start', { p_room_id: roomId });
}

export async function appendEvents(roomId, events) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  return rpc('shadow_event_append', { p_room_id: roomId, p_events: events });
}

export async function sendHeartbeat(roomId) {
  return rpc('shadow_heartbeat', { p_room_id: roomId });
}

export async function settleRound(roomId, {
  round,
  winnerSeat,
  hpP0,
  hpP1,
  reason,
  durationMs,
}) {
  return rpc('shadow_settle_round', {
    p_room_id: roomId,
    p_round: round,
    p_winner_seat: winnerSeat,
    p_hp_p0: hpP0,
    p_hp_p1: hpP1,
    p_reason: reason,
    p_duration_ms: durationMs,
  });
}

export async function settleMatch(roomId, results) {
  return rpc('shadow_settle_match', {
    p_room_id: roomId,
    p_results: results,
  });
}

export async function forfeitMatch(roomId) {
  return rpc('shadow_forfeit', { p_room_id: roomId });
}

export async function leaveRoom(roomId) {
  return rpc('shadow_leave', { p_room_id: roomId });
}

export async function closeRoom(roomId) {
  return rpc('shadow_close', { p_room_id: roomId });
}

/* ── data queries ────────────────────────────────────────────────────────── */

export async function fetchRoom(roomId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('shadow_rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchRoster(roomId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shadow_players')
    .select('*')
    .eq('room_id', roomId)
    .is('left_at', null)
    .order('seat', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchRounds(roomId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shadow_rounds')
    .select('*')
    .eq('room_id', roomId)
    .order('round', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchResults(roomId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shadow_results')
    .select('*')
    .eq('room_id', roomId);
  if (error) throw error;
  return data ?? [];
}

export async function fetchRating(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('shadow_ratings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchPublicRooms() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shadow_public_rooms')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchLeaderboard() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('shadow_leaderboard')
    .select('*')
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function fetchMatchHistory(limit = 20, offset = 0) {
  return rpc('shadow_match_history', { p_limit: limit, p_offset: offset });
}
