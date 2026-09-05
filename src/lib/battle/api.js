import { supabase } from '../supabase.js';

/**
 * Battlefield's API surface.
 *
 * There is no HTTP API to wrap — the app is a static bundle with no backend, so
 * "the server" is Postgres and every call here is an RPC against a SECURITY
 * DEFINER function in migration 0009. Same stance as modules/admin/adminApi.js:
 * RLS and the function bodies are the real gate, so this layer only has to
 * translate, never to enforce.
 *
 * Errors carry a BF### code raised by plpgsql. `BATTLE_ERROR_COPY` maps them to
 * something a person can act on, the way AI_REASON_COPY does in ai-runner.js —
 * so no caller ever has to string-match a Postgres message.
 */

export const BATTLE_ERROR_COPY = {
  BF000: 'Sign in first — a Battlefield needs an account, and a name is enough.',
  BF001: 'No Battlefield with that code. Check the six characters and try again.',
  BF002: 'That Battlefield has expired.',
  BF003: 'That Battlefield is full.',
  BF004: 'That match has already started. Ask the host to open a new one.',
  BF005: 'Only the host can do that.',
  BF006: 'You need at least one opponent before you can start.',
  BF007: 'A Battlefield holds between 2 and 60 players.',
  BF008: 'That passage is not a usable length.',
  BF009: 'Could not mint a room code. Try again.',
  BF010: 'You already have 3 Battlefields open. Close one first.',
  BF011: 'Players can only be removed before the match starts.',
  BF012: 'Use Leave instead.',
  BF013: 'That match is already over.',
  BF014: 'The match has not started yet.',
  BF015: 'You are not in that Battlefield.',
  BF016: 'Join that Battlefield first.',
};

export function battleErrorMessage(err) {
  if (!err) return null;
  if (BATTLE_ERROR_COPY[err.code]) return BATTLE_ERROR_COPY[err.code];
  // 42501 is what a signed-out caller gets now that EXECUTE is revoked from
  // anon. "permission denied for function battle_room_by_pin" is true and
  // useless; the actual situation is that they need an account.
  if (err.code === '42501') return BATTLE_ERROR_COPY.BF000;
  return err.message ?? 'Something went wrong.';
}

/** Every RPC goes through here so the throw shape is identical everywhere. */
async function rpc(fn, args) {
  if (!supabase) {
    const err = new Error('Cloud sync is not configured, so Battlefield is unavailable.');
    err.code = 'NO_CLOUD';
    throw err;
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const err = new Error(battleErrorMessage(error));
    err.code = error.code;
    err.raw = error;
    throw err;
  }
  return data;
}

/* `returns public.battle_rooms` comes back as a bare object, but PostgREST has
   historically wrapped single composite results in an array. Accept both rather
   than depending on which. */
const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);

/* ── clock ─────────────────────────────────────────────────────────────── */

export async function serverTime() {
  return rpc('battle_server_time');
}

/* ── lifecycle ─────────────────────────────────────────────────────────── */

export async function createBattle({ passage, passageMeta, difficulty, maxPlayers, timeLimitSec }) {
  return one(await rpc('battle_create', {
    p_passage: passage,
    p_passage_meta: passageMeta ?? null,
    p_difficulty: difficulty ?? 'normal',
    p_max_players: maxPlayers ?? 8,
    p_time_limit_sec: timeLimitSec ?? 180,
  }));
}

export async function joinBattle(pin) {
  return one(await rpc('battle_join', { p_pin: String(pin || '').trim().toUpperCase() }));
}

export const leaveBattle = (roomId) => rpc('battle_leave', { p_room: roomId });
export const kickPlayer = (roomId, userId) => rpc('battle_kick', { p_room: roomId, p_user: userId });
export const abortBattle = (roomId) => rpc('battle_abort', { p_room: roomId });
export const touchBattle = (roomId) => rpc('battle_touch', { p_room: roomId });

/**
 * Asks the server to re-evaluate whether this room is over, and returns the
 * room as it stands afterwards.
 *
 * This is the escape from the freeze. `battle_maybe_settle` only ever ran as a
 * side effect of somebody calling finish or leave, so a player who closed their
 * tab — reporting neither — left the room `active` forever and everyone else
 * waiting on results that could not arrive. The server now settles a room whose
 * deadline has passed, but something still has to ask it to look, and with no
 * scheduler on the project that has to be a client.
 *
 * It is only a prompt, never an instruction: the RPC is membership-gated and
 * decides for itself, so a client cannot end a match that is genuinely still
 * running, and the answer is the same for every caller.
 */
export async function sweepBattle(roomId) {
  return one(await rpc('battle_sweep', { p_room: roomId }));
}

export async function startBattle(roomId) {
  return one(await rpc('battle_start', { p_room: roomId }));
}

/**
 * Reports a finished run.
 *
 * `wpm` is sent but not trusted: battle_finish recomputes it from
 * `correctChars` and the server's own elapsed time, and keeps this number only
 * as `client_wpm` so a divergence stays visible in the data.
 */
export async function finishBattle(roomId, run) {
  return one(await rpc('battle_finish', {
    p_room: roomId,
    p_correct_chars: Math.round(run.correctChars ?? 0),
    p_typed_chars: Math.round(run.typedChars ?? 0),
    p_mistakes: Math.round(run.mistakes ?? 0),
    p_accuracy: Number(run.accuracy ?? 0),
    p_consistency: run.consistency == null ? null : Number(run.consistency),
    p_client_wpm: Number(run.wpm ?? 0),
    p_finished: run.finished !== false,
  }));
}

/* ── reads ─────────────────────────────────────────────────────────────── */

export async function roomByPin(pin) {
  return one(await rpc('battle_room_by_pin', { p_pin: String(pin || '').trim().toUpperCase() }));
}

export const fetchPassage = (roomId) => rpc('battle_passage', { p_room: roomId });

export async function fetchRoom(roomId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('battle_rooms').select('*').eq('id', roomId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchRoster(roomId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('battle_players')
    .select('*')
    .eq('room_id', roomId)
    .is('left_at', null)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchResults(roomId) {
  return (await rpc('battle_leaderboard', { p_room: roomId })) ?? [];
}

/* ── removal ───────────────────────────────────────────────────────────── */

/**
 * The explanation for a room an operator closed, plus this player's own thread
 * about it.
 *
 * A separate RPC rather than a column on the room, because a removed room has
 * no live members and `battle_rooms`' own policy is member-scoped — the person
 * who most needs to read the reason is exactly the one who can no longer select
 * the row. The function checks historical membership instead, and returns only
 * the reason and the thread: no passage, no roster, no other player's messages.
 */
export async function fetchRemovalNotice(roomId) {
  return rpc('battle_removal_notice', { p_room: roomId });
}

/** Asks an operator why. Sending twice edits the question rather than adding a second. */
export async function appealRemoval(roomId, message) {
  return one(await rpc('battle_appeal_removal', { p_room: roomId, p_message: message }));
}
