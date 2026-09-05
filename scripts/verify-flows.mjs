/**
 * End-to-end exercise of the flows the migrations enabled, against the real
 * project, over the same anon key and the same RPCs the browser uses.
 *
 * The headline test is the freeze: two players, one of them closes the tab and
 * never reports. Before 0023 that room stayed `active` forever. It must now
 * settle on the deadline, with a ranked forfeit row for the absent player —
 * and, just as important, it must NOT settle before the deadline, because a
 * sweep that could end a live match on request would be a worse bug than the
 * one it fixes.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('C:/ZProjectx/TypeForge/.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function guest(label) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`${label} sign-in: ${error.message}`);
  return { c, id: data.user.id, label };
}

const PASSAGE =
  'The quick brown fox jumps over the lazy dog while the tired programmer waits for the build to finish and wonders whether the tests will pass this time around.';

const run = async () => {
  const a = await guest('A');
  const b = await guest('B');
  check('anonymous sign-in works for two independent clients', Boolean(a.id && b.id && a.id !== b.id));

  /* ── capacity: the schema, not the frontend number ────────────────── */
  const over = await a.c.rpc('battle_create', {
    p_passage: PASSAGE, p_passage_meta: null, p_difficulty: 'normal',
    p_max_players: 31, p_time_limit_sec: 60,
  });
  check('31 players is refused by the server', Boolean(over.error), over.error?.message ?? 'no error raised');

  const made = await a.c.rpc('battle_create', {
    p_passage: PASSAGE, p_passage_meta: null, p_difficulty: 'normal',
    p_max_players: 30, p_time_limit_sec: 30,
  });
  if (made.error) throw new Error(`create: ${made.error.message}`);
  const room = Array.isArray(made.data) ? made.data[0] : made.data;
  check('30-player room is accepted', room?.max_players === 30, `max_players=${room?.max_players}`);

  /* ── join ─────────────────────────────────────────────────────────── */
  const joined = await b.c.rpc('battle_join', { p_pin: room.pin });
  check('second player joins by PIN', !joined.error, joined.error?.message ?? `pin ${room.pin}`);

  /* ── start ────────────────────────────────────────────────────────── */
  const started = await a.c.rpc('battle_start', { p_room: room.id });
  const startRow = Array.isArray(started.data) ? started.data[0] : started.data;
  check('host starts the match', !started.error, started.error?.message ?? `status=${startRow?.status}`);

  const deadline = new Date(startRow.deadline_at).getTime();

  /* Wait out the countdown, then A reports and B never does — B is the
     closed tab that used to hang the room. */
  await sleep(Math.max(0, new Date(startRow.starts_at).getTime() - Date.now()) + 1500);

  const fin = await a.c.rpc('battle_finish', {
    p_room: room.id, p_correct_chars: 120, p_typed_chars: 128, p_mistakes: 8,
    p_accuracy: 93.75, p_consistency: 80, p_client_wpm: 61, p_finished: true,
  });
  check('finisher reports a result', !fin.error, fin.error?.message ?? '');

  /* ── sharing a live room in the feed: the Community's whole point ──── */
  const livePost = await b.c.rpc('community_post', {
    p_body: `automated verification — ignore. join me: http://localhost:5173/battle/${room.pin}`,
    p_pin: room.pin,
  });
  const liveRow = Array.isArray(livePost.data) ? livePost.data[0] : livePost.data;
  check(
    'a live room code is attached to the post',
    !livePost.error && liveRow?.battle_pin === room.pin,
    livePost.error?.message ?? `battle_pin=${liveRow?.battle_pin}`,
  );

  const liveFeed = await a.c.from('community_feed').select('id, battle_pin, battle_status').eq('id', liveRow?.id);
  check(
    'the feed reports that shared room as joinable',
    Boolean(liveFeed.data?.[0]?.battle_status),
    liveFeed.error?.message ?? `battle_status=${liveFeed.data?.[0]?.battle_status ?? 'null'}`,
  );

  /* ── the sweep must NOT be able to end a live match ────────────────── */
  const early = await a.c.rpc('battle_sweep', { p_room: room.id });
  const earlyRow = Array.isArray(early.data) ? early.data[0] : early.data;
  check(
    'sweep before the deadline leaves a live match alone',
    earlyRow?.status === 'active',
    `status=${earlyRow?.status}`,
  );

  /* ── a non-member cannot sweep somebody else's room ────────────────── */
  const stranger = await guest('C');
  const nosy = await stranger.c.rpc('battle_sweep', { p_room: room.id });
  check('a non-member is refused the sweep', Boolean(nosy.error), nosy.error?.message ?? 'no error raised');

  /* ── past the deadline: this is the freeze ─────────────────────────── */
  const wait = deadline - Date.now() + 2000;
  console.log(`\n… waiting ${Math.ceil(wait / 1000)}s for the deadline (this is the freeze scenario)\n`);
  await sleep(Math.max(0, wait));

  const swept = await a.c.rpc('battle_sweep', { p_room: room.id });
  const sweptRow = Array.isArray(swept.data) ? swept.data[0] : swept.data;
  check(
    'room settles once the deadline passes, with nobody having reported for B',
    sweptRow?.status === 'finished',
    `status=${sweptRow?.status}`,
  );

  const board = await a.c.rpc('battle_leaderboard', { p_room: room.id });
  const rows = board.data ?? [];
  const mine = rows.find((r) => r.user_id === a.id);
  const theirs = rows.find((r) => r.user_id === b.id);
  check('both players appear on the leaderboard', rows.length === 2, `${rows.length} rows`);
  check('the finisher is ranked', mine?.rank != null, `rank=${mine?.rank}`);
  check(
    'the absent player gets a ranked forfeit row rather than vanishing',
    theirs?.rank != null && theirs?.finished === false,
    `rank=${theirs?.rank} finished=${theirs?.finished} flags=${JSON.stringify(theirs?.flags)}`,
  );

  /* ── server-side authorisation ─────────────────────────────────────── */
  const notAdmin = await b.c.rpc('admin_remove_battle_room', {
    p_room: room.id, p_reason: 'testing that this is refused',
  });
  check('an ordinary player cannot remove a room', Boolean(notAdmin.error), notAdmin.error?.message ?? 'no error raised');

  const roster = await b.c.rpc('admin_user_overview');
  check(
    'an ordinary player cannot read the admin roster',
    Boolean(roster.error) || (roster.data ?? []).length === 0,
    roster.error?.message ?? `${(roster.data ?? []).length} rows returned`,
  );

  /* ── community privacy: the boundary is the view, not the client ───── */
  const peek = await b.c.from('profiles').select('id, xp, settings').eq('id', a.id);
  check(
    'a member cannot select another member\'s profile row directly',
    (peek.data ?? []).length === 0,
    peek.error?.message ?? `${(peek.data ?? []).length} rows returned`,
  );

  const feedPeek = await b.c.from('community_profiles').select('user_id, display_name').eq('user_id', a.id);
  check(
    'the community view is readable and carries only public columns',
    !feedPeek.error && !('xp' in (feedPeek.data?.[0] ?? { xp: undefined })),
    feedPeek.error?.message ?? `${(feedPeek.data ?? []).length} rows`,
  );

  const deadFeed = await a.c.from('community_feed').select('id, battle_pin, battle_status').eq('id', liveRow?.id);
  check(
    'once the room is over the shared code stops offering a join button',
    deadFeed.data?.[0]?.battle_status == null && deadFeed.data?.[0]?.battle_pin === room.pin,
    `battle_status=${deadFeed.data?.[0]?.battle_status ?? 'null'}`,
  );

  const cleanupLive = await b.c.rpc('community_delete_post', { p_id: liveRow?.id });
  check('the shared-invite post is cleaned up', !cleanupLive.error, cleanupLive.error?.message ?? '');

  /* ── community post, with a shared room code, then cleaned up ──────── */
  const post = await a.c.rpc('community_post', {
    p_body: `automated verification post — please ignore. ${room.pin}`,
    p_pin: room.pin,
  });
  const postRow = Array.isArray(post.data) ? post.data[0] : post.data;
  // The room is finished by now, so the pin should be rejected as not-live
  // rather than stored — a dead code must not become a join button.
  check(
    'a code for a closed room drops the code but still posts the message',
    !post.error && postRow?.id && postRow?.battle_pin == null,
    post.error?.message ?? `battle_pin=${postRow?.battle_pin}`,
  );

  const feed = await b.c.from('community_feed').select('id, body, display_name').eq('id', postRow?.id);
  check('the post is visible to another member in the feed', (feed.data ?? []).length === 1,
    feed.error?.message ?? `${(feed.data ?? []).length} rows`);

  const notMine = await b.c.rpc('community_delete_post', { p_id: postRow?.id });
  check('another member cannot delete that post', Boolean(notMine.error) , notMine.error?.message ?? 'no error raised');

  const del = await a.c.rpc('community_delete_post', { p_id: postRow?.id });
  check('the author can delete their own post', !del.error, del.error?.message ?? 'cleaned up');

  const gone = await b.c.from('community_feed').select('id').eq('id', postRow?.id);
  check('the deleted post leaves the feed', (gone.data ?? []).length === 0, `${(gone.data ?? []).length} rows`);

  console.log('\n──────────────────────────────────────────');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  · ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
};

run().catch((e) => { console.error('\nABORTED:', e.message); process.exitCode = 1; });
