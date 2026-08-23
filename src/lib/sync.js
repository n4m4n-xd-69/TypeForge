/**
 * Cloud sync — PRD 04 §Step 6.
 *
 * The conflict model, straight from the PRD: sessions are append-only and
 * immutable, everything else is last-write-wins. That split removes the hard
 * case almost entirely — appends can't conflict, and every other table is
 * small enough to upsert wholesale each tick rather than diff field by field.
 *
 * The one place real merging happens is `adoptLocalState`, run exactly once
 * per (device, account) pair the first time a signed-out user with local
 * history signs in: it sums key_stats, unions achievements/problems, and keeps
 * the larger of xp/streak so a local-only user never loses progress by
 * signing up. After that, sync is plain LWW snapshots.
 *
 * No persisted outbox. A failed push just logs and leaves `state` (and the
 * `online` listener) to trigger the next attempt — since every push is an
 * idempotent upsert of the current snapshot, "retry with whatever is current"
 * is equivalent to replaying a queued diff, without needing to serialise one.
 *
 * Every exported function no-ops when Supabase isn't configured, so callers
 * (store.jsx) don't need their own `cloudEnabled()` guards.
 */
import { useEffect, useRef } from 'react';
import { supabase, cloudEnabled } from './supabase.js';
import { readLocal, writeLocal } from './storage.js';
import { bumpDaily, dayKey } from './gamification.js';

const ADOPTED_KEY = 'keystroke.adopted';
// Mirrors MAX_SESSIONS in store.jsx — the reducer enforces this cap on every
// local `recordSession`, but `seed` replaces `sessions` wholesale, so a merge
// that grows past it has to re-cap here too.
const MAX_SESSIONS = 400;

export function isAdopted(userId) {
  return readLocal(ADOPTED_KEY) === userId;
}

function markAdopted(userId) {
  writeLocal(ADOPTED_KEY, userId);
}

/* ── row <-> local shape ──────────────────────────────────────────────────
   Local sessions key on `lang`; the table calls it `language`. Everything
   else is a 1:1 rename. */

function hash32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Stable idempotency key for a session.
 *
 * "Stable" has to mean *across a round trip through Postgres*, which the first
 * version of this did not. It hashed `s.ts` and `s.wpm` as they appeared
 * locally, but neither survives storage unchanged:
 *
 *   ts   local `2026-08-02T05:53:42.839Z`  ->  db `2026-08-02 05:53:42.839+00`
 *   wpm  local `219.35483870967741`        ->  db `219.355`  (column is `real`)
 *
 * So a pulled session hashed to a different id than the same session had going
 * up, the upsert's `onConflict (user_id, client_id)` never matched, and a fresh
 * row was inserted. Every pull-then-push cycle duplicated the entire history.
 *
 * Normalising fixes it in both directions: the timestamp becomes epoch
 * milliseconds, which both formats parse to identically, and WPM is quantised
 * to one decimal as an integer — coarse enough to survive float4, fine enough
 * that two genuinely different runs in the same millisecond still differ.
 */
function clientIdFor(s) {
  const parsed = Date.parse(s.ts);
  const ts = Number.isNaN(parsed) ? String(s.ts ?? '') : String(parsed);
  const wpm = Math.round((Number(s.wpm) || 0) * 10);
  return `c_${hash32(`${ts}|${s.mode ?? ''}|${wpm}|${s.chars ?? 0}`)}`;
}

function sessionToRow(userId, s) {
  return {
    user_id: userId,
    client_id: clientIdFor(s),
    ts: s.ts,
    kind: s.kind ?? 'text',
    mode: s.mode ?? null,
    language: s.lang ?? null,
    difficulty: s.difficulty ?? null,
    wpm: s.wpm ?? 0,
    raw_wpm: s.rawWpm ?? null,
    accuracy: s.accuracy ?? 0,
    consistency: s.consistency ?? null,
    duration_sec: s.durationSec ?? 0,
    chars: s.chars ?? null,
    errors: s.errors ?? null,
    xp: s.xp ?? 0,
  };
}

function rowToSession(row) {
  return {
    ts: row.ts,
    kind: row.kind,
    mode: row.mode,
    lang: row.language,
    difficulty: row.difficulty,
    wpm: row.wpm,
    rawWpm: row.raw_wpm,
    accuracy: row.accuracy,
    consistency: row.consistency,
    durationSec: row.duration_sec,
    chars: row.chars,
    errors: row.errors,
    xp: row.xp,
  };
}

function unionSessions(local, remoteRows) {
  const byKey = new Map();
  for (const s of local) byKey.set(clientIdFor(s), s);
  for (const row of remoteRows) {
    const s = rowToSession(row);
    if (!byKey.has(clientIdFor(s))) byKey.set(clientIdFor(s), s);
  }
  return [...byKey.values()].sort((a, b) => new Date(a.ts) - new Date(b.ts)).slice(-MAX_SESSIONS);
}

function rebuildDaily(sessions) {
  let daily = {};
  for (const s of sessions) {
    daily = bumpDaily(daily, dayKey(new Date(s.ts)), {
      sessions: 1,
      seconds: Math.round(s.durationSec ?? 0),
      xp: s.xp ?? 0,
    });
  }
  return daily;
}

/* ── push: current local snapshot -> remote, upsert (LWW) ─────────────── */

export async function pushSessions(userId, sessions) {
  if (!supabase || !sessions?.length) return;
  const rows = sessions.map((s) => sessionToRow(userId, s));
  // Conflict on the content, not on the hashed client_id. A user cannot finish
  // two runs in the same millisecond, so (user_id, ts) is the real identity —
  // and unlike the hash it cannot drift when Postgres reformats a value on the
  // way back out. See migration 0008.
  const { error } = await supabase.from('sessions').upsert(rows, { onConflict: 'user_id,ts', ignoreDuplicates: true });
  if (error) throw error;
}

export async function pushProfile(userId, { profile, xp, streak, settings }) {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      display_name: profile.name || null,
      avatar: profile.avatar ?? null,
      hide_from_leaderboard: profile.hideFromLeaderboard === true,
      goal_minutes: profile.goalMinutes ?? 15,
      xp: xp ?? 0,
      streak_count: streak?.count ?? 0,
      streak_best: streak?.best ?? 0,
      streak_last: streak?.last ?? null,
      settings: settings ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

export async function pushKeyStats(userId, keyStats) {
  if (!supabase) return;
  const entries = Object.entries(keyStats ?? {});
  if (!entries.length) return;
  const rows = entries.map(([key, v]) => ({ user_id: userId, key, total: v.total ?? 0, wrong: v.wrong ?? 0 }));
  const { error } = await supabase.from('key_stats').upsert(rows, { onConflict: 'user_id,key' });
  if (error) throw error;
}

export async function pushProblemProgress(userId, problems) {
  if (!supabase) return;
  const entries = Object.entries(problems ?? {});
  if (!entries.length) return;
  const rows = entries.map(([problemId, p]) => ({
    user_id: userId,
    problem_id: problemId,
    status: p.status,
    attempts: p.attempts ?? 0,
    solved_at: p.solvedAt ?? null,
    language: p.lastLanguage ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('problem_progress').upsert(rows, { onConflict: 'user_id,problem_id' });
  if (error) throw error;
}

export async function pushAchievements(userId, achievements) {
  if (!supabase) return;
  const entries = Object.entries(achievements ?? {});
  if (!entries.length) return;
  // ignoreDuplicates: an achievement's unlock date never moves once written.
  const rows = entries.map(([id, unlockedAt]) => ({ user_id: userId, achievement: id, unlocked_at: unlockedAt }));
  const { error } = await supabase.from('achievements').upsert(rows, { onConflict: 'user_id,achievement', ignoreDuplicates: true });
  if (error) throw error;
}

export async function pushDaily(userId, daily) {
  if (!supabase) return;
  const entries = Object.entries(daily ?? {});
  if (!entries.length) return;
  const rows = entries.map(([day, d]) => ({
    user_id: userId, day, seconds: d.seconds ?? 0, sessions: d.sessions ?? 0, xp: d.xp ?? 0,
  }));
  const { error } = await supabase.from('daily_stats').upsert(rows, { onConflict: 'user_id,day' });
  if (error) throw error;
}

/* ── pull: remote -> local-shaped patch ──────────────────────────────────
   daily_stats is written (for the admin rollup, PRD 05) but never read back
   here — it's a coarser aggregate than local `daily`, so re-deriving `daily`
   from the merged session set avoids a lossy round trip. */

async function fetchRemote(userId) {
  const [profileRes, sessionsRes, keyStatsRes, problemsRes, achievementsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('sessions').select('*').eq('user_id', userId).order('ts', { ascending: true }).limit(MAX_SESSIONS),
    supabase.from('key_stats').select('*').eq('user_id', userId),
    supabase.from('problem_progress').select('*').eq('user_id', userId),
    supabase.from('achievements').select('*').eq('user_id', userId),
  ]);
  for (const res of [profileRes, sessionsRes, keyStatsRes, problemsRes, achievementsRes]) {
    if (res.error) throw res.error;
  }
  return {
    profileRow: profileRes.data,
    sessionRows: sessionsRes.data ?? [],
    keyStatsRows: keyStatsRes.data ?? [],
    problemRows: problemsRes.data ?? [],
    achievementRows: achievementsRes.data ?? [],
  };
}

function keyStatsRowsToMap(rows) {
  const out = {};
  for (const row of rows) out[row.key] = { total: row.total, wrong: row.wrong };
  return out;
}

function problemRowsToLocal(rows) {
  const out = {};
  for (const row of rows) {
    out[row.problem_id] = {
      status: row.status,
      attempts: row.attempts,
      solvedAt: row.solved_at,
      lastLanguage: row.language,
    };
  }
  return out;
}

function achievementRowsToMap(rows) {
  const out = {};
  for (const row of rows) out[row.achievement] = row.unlocked_at;
  return out;
}

/** Never lets a solved problem or an unlocked achievement flicker back to
 * unsolved/locked just because a pull raced ahead of the push that would
 * have confirmed it remotely. Everything else here is plain LWW. */
function unionProblems(local, remote) {
  const out = { ...remote, ...local };
  for (const [id, r] of Object.entries(remote)) {
    const l = local[id];
    if (!l) continue;
    const solved = l.status === 'solved' || r.status === 'solved';
    out[id] = {
      status: solved ? 'solved' : l.status ?? r.status,
      attempts: Math.max(l.attempts ?? 0, r.attempts ?? 0),
      lastLanguage: l.lastLanguage ?? r.lastLanguage,
      solvedAt: l.solvedAt && r.solvedAt ? (l.solvedAt < r.solvedAt ? l.solvedAt : r.solvedAt) : l.solvedAt ?? r.solvedAt ?? null,
    };
  }
  return out;
}

function unionAchievements(local, remote) {
  const out = { ...local };
  for (const [id, remoteAt] of Object.entries(remote)) {
    const localAt = out[id];
    out[id] = !localAt || remoteAt < localAt ? remoteAt : localAt;
  }
  return out;
}

function sumKeyStats(local, remote) {
  const out = { ...local };
  for (const [k, r] of Object.entries(remote)) {
    const l = out[k] ?? { total: 0, wrong: 0 };
    out[k] = { total: l.total + r.total, wrong: l.wrong + r.wrong };
  }
  return out;
}

/** Larger of xp/streak.best wins, per PRD — a local-only user must never lose
 * progress by signing in. `onboarded` always stays local: it is UI state
 * about this device having shown the wizard, not something a profile row's
 * mere existence should imply. */
function maxProfile(local, remoteRow) {
  if (!remoteRow) return { profile: local.profile, xp: local.xp, streak: local.streak };
  const xp = Math.max(local.xp ?? 0, remoteRow.xp ?? 0);
  const localBest = local.streak?.best ?? 0;
  const remoteBest = remoteRow.streak_best ?? 0;
  const streak = localBest >= remoteBest
    ? local.streak
    : { count: remoteRow.streak_count, best: remoteRow.streak_best, last: remoteRow.streak_last };
  return {
    profile: {
      name: local.profile.name || remoteRow.display_name || '',
      avatar: local.profile.avatar ?? remoteRow.avatar ?? null,
      hideFromLeaderboard: local.profile.hideFromLeaderboard ?? remoteRow.hide_from_leaderboard ?? false,
      goalMinutes: local.profile.goalMinutes ?? remoteRow.goal_minutes ?? 15,
      onboarded: local.profile.onboarded,
    },
    xp,
    streak,
  };
}

function toLocalPatch(remote, local) {
  const sessions = unionSessions(local.sessions, remote.sessionRows);
  const profileRow = remote.profileRow;
  const profile = profileRow
    ? {
        name: profileRow.display_name || local.profile.name,
        // Remote wins for both: they are set on one device and are meant to
        // follow you, and `??` keeps a deliberate `false` rather than treating
        // it as absent.
        avatar: profileRow.avatar ?? local.profile.avatar ?? null,
        hideFromLeaderboard: profileRow.hide_from_leaderboard ?? local.profile.hideFromLeaderboard ?? false,
        goalMinutes: profileRow.goal_minutes ?? local.profile.goalMinutes,
        onboarded: local.profile.onboarded,
      }
    : local.profile;
  const xp = profileRow ? profileRow.xp ?? local.xp : local.xp;
  const streak = profileRow
    ? { count: profileRow.streak_count ?? local.streak.count, best: profileRow.streak_best ?? local.streak.best, last: profileRow.streak_last ?? local.streak.last }
    : local.streak;

  return {
    sessions,
    profile,
    xp,
    streak,
    keyStats: keyStatsRowsToMap(remote.keyStatsRows),
    problems: unionProblems(local.problems, problemRowsToLocal(remote.problemRows)),
    achievements: unionAchievements(local.achievements, achievementRowsToMap(remote.achievementRows)),
    daily: rebuildDaily(sessions),
  };
}

/** Pulls remote state and dispatches a `seed` patch. Safe to call often —
 * `seed` is a plain shallow merge, so this only ever overwrites the specific
 * keys listed above. */
export async function pullAndSeed(userId, localState, dispatch) {
  if (!supabase) return;
  const remote = await fetchRemote(userId);
  dispatch({ type: 'seed', state: toLocalPatch(remote, localState) });
}

/**
 * Runs once per (device, account): merges this device's never-synced local
 * history into whatever's already remote, then pushes the merge. Gated by
 * `keystroke.adopted` so it can't re-run and re-sum on every reload.
 */
export async function adoptLocalState(userId, localState) {
  if (!supabase || isAdopted(userId)) return;
  const remote = await fetchRemote(userId);

  const mergedSessions = unionSessions(localState.sessions, remote.sessionRows);
  const mergedKeyStats = sumKeyStats(localState.keyStats, keyStatsRowsToMap(remote.keyStatsRows));
  const mergedProblems = unionProblems(localState.problems, problemRowsToLocal(remote.problemRows));
  const mergedAchievements = unionAchievements(localState.achievements, achievementRowsToMap(remote.achievementRows));
  const { profile, xp, streak } = maxProfile(localState, remote.profileRow);

  await Promise.all([
    pushSessions(userId, mergedSessions),
    pushKeyStats(userId, mergedKeyStats),
    pushProblemProgress(userId, mergedProblems),
    pushAchievements(userId, mergedAchievements),
    pushProfile(userId, { profile, xp, streak, settings: localState.settings }),
  ]);
  await pushDaily(userId, rebuildDaily(mergedSessions));

  markAdopted(userId);
}

function pushSnapshot(userId, s) {
  return Promise.all([
    pushProfile(userId, { profile: s.profile, xp: s.xp, streak: s.streak, settings: s.settings }),
    pushSessions(userId, s.sessions),
    pushKeyStats(userId, s.keyStats),
    pushProblemProgress(userId, s.problems),
    pushAchievements(userId, s.achievements),
    pushDaily(userId, s.daily),
  ]);
}

/**
 * The sync side-channel called from `StoreProvider`. Adopts + pulls once a
 * user is present, re-pulls on window focus, and pushes the current snapshot
 * 2s after any local change (and again on `online`, for a change that was
 * made while offline). Never blocks a caller — every failure is caught and
 * logged, and the next natural trigger (change, focus, reconnect) retries.
 */
export function useCloudSync(user, state, dispatch) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const adoptingRef = useRef(false);

  /**
   * Whether the initial adopt-and-pull has finished for the current user.
   *
   * This gates the write-through push, and it is not optional. On a device
   * where local state is empty but the session is live — a cleared cache, a
   * second browser, a fresh install — the push timer would fire two seconds
   * after mount while the pull was still in flight, and upsert a blank
   * snapshot over good remote data. That is not hypothetical: it zeroed a
   * real account's XP from 790 to 0 during testing.
   *
   * Nothing is lost by waiting. The push effect re-runs on every state change,
   * so the first genuine edit after hydration carries everything up anyway.
   */
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!user || !cloudEnabled()) return undefined;
    if (adoptingRef.current) return undefined;
    adoptingRef.current = true;
    hydratedRef.current = false; // a new user id must hydrate before it pushes
    let cancelled = false;
    (async () => {
      try {
        if (!isAdopted(user.id)) await adoptLocalState(user.id, stateRef.current);
        if (!cancelled) await pullAndSeed(user.id, stateRef.current, dispatch);
        if (!cancelled) hydratedRef.current = true;
      } catch (err) {
        // Deliberately leaves `hydrated` false. A push after a failed pull is
        // exactly the case that overwrites remote data with a local blank, so
        // a device that cannot read stays read-only until it can.
        console.error('[sync] initial hydrate failed — writes stay disabled this session', err);
      } finally {
        adoptingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, dispatch]);

  useEffect(() => {
    if (!user || !cloudEnabled()) return undefined;
    const onFocus = () => {
      pullAndSeed(user.id, stateRef.current, dispatch).catch((err) => console.error('[sync] focus pull failed', err));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, dispatch]);

  useEffect(() => {
    if (!user || !cloudEnabled()) return undefined;
    const timer = setTimeout(() => {
      if (!hydratedRef.current) return; // see hydratedRef — never write before reading
      pushSnapshot(user.id, stateRef.current).catch((err) => console.error('[sync] write-through failed, will retry on next change', err));
    }, 2000);
    return () => clearTimeout(timer);
  }, [user, state]);

  useEffect(() => {
    if (!user || !cloudEnabled()) return undefined;
    const onOnline = () => {
      if (!hydratedRef.current) return;
      pushSnapshot(user.id, stateRef.current).catch((err) => console.error('[sync] reconnect push failed', err));
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user]);
}
