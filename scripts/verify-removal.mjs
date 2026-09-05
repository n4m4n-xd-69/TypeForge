/**
 * The player half of room removal, exercised for real.
 *
 * Phase 1 opens a room with two guests and writes their ids to a handoff file.
 * An operator step (run separately, with privileges a player does not have)
 * marks the room removed. Phase 2 is the player: they must be told the room is
 * gone, told why, able to ask about it, and able to see the answer — and a
 * stranger must be able to do none of that.
 *
 *   node scripts/verify-removal.mjs open
 *   …mark the room removed…
 *   node scripts/verify-removal.mjs check
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('C:/ZProjectx/TypeForge/.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const HANDOFF = 'C:/ZProjectx/TypeForge/.removal-handoff.json';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function guest() {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(error.message);
  return { c, id: data.user.id, token: data.session.access_token };
}

/* A session is restored from its refresh token so phase 2 is the same person as
   phase 1 — a fresh anonymous sign-in would be a different account, and the
   membership check this is testing would then be right to refuse them. */
function restore(session) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return c.auth.setSession(session).then(() => c);
}

const PASSAGE =
  'A room that an administrator removes must explain itself to the people who were standing in it, because silence reads as a bug rather than a decision.';

async function open_() {
  const a = await guest();
  const b = await guest();
  const made = await a.c.rpc('battle_create', {
    p_passage: PASSAGE, p_passage_meta: null, p_difficulty: 'normal',
    p_max_players: 4, p_time_limit_sec: 120,
  });
  if (made.error) throw new Error(made.error.message);
  const room = Array.isArray(made.data) ? made.data[0] : made.data;
  const joined = await b.c.rpc('battle_join', { p_pin: room.pin });
  if (joined.error) throw new Error(joined.error.message);

  const outsider = await guest();
  writeFileSync(HANDOFF, JSON.stringify({
    roomId: room.id,
    pin: room.pin,
    a: (await a.c.auth.getSession()).data.session,
    b: (await b.c.auth.getSession()).data.session,
    outsider: (await outsider.c.auth.getSession()).data.session,
  }));
  console.log(`room ${room.pin} (${room.id}) open with 2 players — now mark it removed`);
}

async function check_() {
  const h = JSON.parse(readFileSync(HANDOFF, 'utf8'));
  const b = await restore(h.b);
  const outsider = await restore(h.outsider);

  const notice = await b.rpc('battle_removal_notice', { p_room: h.roomId });
  const n = Array.isArray(notice.data) ? notice.data[0] : notice.data;
  check('a player who was in the room is told it was removed, and why',
    !notice.error && Boolean(n?.reason), notice.error?.message ?? JSON.stringify(n));

  const nosy = await outsider.rpc('battle_removal_notice', { p_room: h.roomId });
  const nn = Array.isArray(nosy.data) ? nosy.data[0] : nosy.data;
  check('somebody who was never in the room learns nothing about it',
    Boolean(nosy.error) || !nn, nosy.error?.message ?? JSON.stringify(nn));

  const appeal = await b.rpc('battle_appeal_removal', {
    p_room: h.roomId, p_message: 'automated verification — why was this removed?',
  });
  check('the player can ask about it', !appeal.error, appeal.error?.message ?? '');

  const again = await b.rpc('battle_appeal_removal', {
    p_room: h.roomId, p_message: 'automated verification — a second question',
  });
  const rows = await b.from('battle_room_appeals').select('id, message, admin_reply').eq('room_id', h.roomId);
  check('a second question adds to the same thread rather than opening another',
    !again.error && (rows.data ?? []).length === 1, `${(rows.data ?? []).length} threads`);

  const strangerAppeal = await outsider.rpc('battle_appeal_removal', {
    p_room: h.roomId, p_message: 'automated verification — should be refused',
  });
  check('a stranger cannot appeal a room they were never in',
    Boolean(strangerAppeal.error), strangerAppeal.error?.message ?? 'no error raised');

  const peek = await outsider.from('battle_room_appeals').select('id, message').eq('room_id', h.roomId);
  check('a stranger cannot read somebody else\'s appeal',
    (peek.data ?? []).length === 0, peek.error?.message ?? `${(peek.data ?? []).length} rows`);

  const forge = await b.from('battle_room_appeals')
    .update({ admin_reply: 'a player must not be able to answer themselves' })
    .eq('room_id', h.roomId).select();
  check('a player cannot write their own admin reply',
    Boolean(forge.error) || (forge.data ?? []).length === 0,
    forge.error?.message ?? `${(forge.data ?? []).length} rows updated`);

  console.log(JSON.stringify({ appealRoom: h.roomId }));
  console.log('──────────────────────────────────────────');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

async function reply_() {
  const h = JSON.parse(readFileSync(HANDOFF, 'utf8'));
  const b = await restore(h.b);
  const rows = await b.from('battle_room_appeals').select('admin_reply, replied_at').eq('room_id', h.roomId);
  check('the player sees the administrator\'s answer',
    Boolean(rows.data?.[0]?.admin_reply), rows.error?.message ?? JSON.stringify(rows.data?.[0]));
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

const mode = process.argv[2];
const fn = { open: open_, check: check_, reply: reply_ }[mode];
if (!fn) { console.error('usage: verify-removal.mjs open|check|reply'); process.exit(2); }
fn().catch((e) => { console.error('ABORTED:', e.message); process.exitCode = 1; });
