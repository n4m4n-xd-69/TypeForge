/**
 * XP, levels, badges and daily missions. Everything here is a pure function of
 * saved state so the same numbers can be recomputed on any device.
 */

import { kindFactorFor } from './modes/registry.js';

/* ── Levels ────────────────────────────────────────────────────────────────
   Quadratic curve: level n starts at 60·n·(n−1)/2 + 40·(n−1). Early levels
   arrive fast (first one inside a single session), later ones take real work. */

export function xpForLevel(level) {
  if (level <= 1) return 0;
  const n = level - 1;
  return 30 * n * (n + 1) + 40 * n;
}

export function levelFromXP(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 999) level++;
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return {
    level,
    floor,
    ceil,
    into: xp - floor,
    span: ceil - floor,
    progress: (xp - floor) / (ceil - floor),
    toNext: ceil - xp,
  };
}

export const LEVEL_TITLES = [
  [1, 'Tapper'], [3, 'Drummer'], [6, 'Typist'], [10, 'Rhythmist'],
  [15, 'Operator'], [21, 'Machinist'], [28, 'Virtuoso'], [36, 'Keysmith'],
  [45, 'Phantom'],
];

export function levelTitle(level) {
  let title = LEVEL_TITLES[0][1];
  for (const [at, name] of LEVEL_TITLES) if (level >= at) title = name;
  return title;
}

/* ── XP awards ─────────────────────────────────────────────────────────── */

/**
 * Speed and accuracy both matter, but accuracy is the multiplier — you cannot
 * farm XP by mashing keys. Sub-90% accuracy actively shrinks the award.
 */
export function xpForSession({ wpm, accuracy, durationSec, kind = 'text', difficulty = 'normal' }) {
  const base = Math.round(wpm * 0.9 + (durationSec / 60) * 18);
  const accuracyFactor = accuracy >= 98 ? 1.35 : accuracy >= 95 ? 1.15 : accuracy >= 90 ? 1 : 0.7;
  const kindFactor = kindFactorFor(kind);
  const diffFactor = { easy: 0.85, normal: 1, hard: 1.2, expert: 1.45 }[difficulty] ?? 1;
  return Math.max(5, Math.round(base * accuracyFactor * kindFactor * diffFactor));
}

/* ── Streaks ───────────────────────────────────────────────────────────── */

export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(aKey, bKey) {
  const a = new Date(`${aKey}T00:00:00`);
  const b = new Date(`${bKey}T00:00:00`);
  return Math.round((b - a) / 86_400_000);
}

export function advanceStreak(streak, today = dayKey()) {
  if (!streak.last) return { count: 1, best: Math.max(1, streak.best || 0), last: today };
  const gap = daysBetween(streak.last, today);
  if (gap === 0) return streak;
  const count = gap === 1 ? streak.count + 1 : 1;
  return { count, best: Math.max(count, streak.best || 0), last: today };
}

/** A streak only counts today if you practised today or yesterday. */
export function liveStreak(streak, today = dayKey()) {
  if (!streak?.last) return 0;
  const gap = daysBetween(streak.last, today);
  return gap <= 1 ? streak.count : 0;
}

/* ── Achievements ──────────────────────────────────────────────────────── */

export const ACHIEVEMENTS = [
  { id: 'first-run', name: 'Hello, World', hint: 'Finish your first session', icon: 'Sparkles', tier: 'bronze', test: (s) => s.sessions.length >= 1 },
  { id: 'wpm-40', name: 'Cruising', hint: 'Hit 40 WPM', icon: 'Gauge', tier: 'bronze', test: (s) => s.best.wpm >= 40 },
  { id: 'wpm-60', name: 'Fast Hands', hint: 'Hit 60 WPM', icon: 'Zap', tier: 'silver', test: (s) => s.best.wpm >= 60 },
  { id: 'wpm-80', name: 'Blur', hint: 'Hit 80 WPM', icon: 'Wind', tier: 'gold', test: (s) => s.best.wpm >= 80 },
  { id: 'wpm-100', name: 'Triple Digits', hint: 'Hit 100 WPM', icon: 'Rocket', tier: 'legend', test: (s) => s.best.wpm >= 100 },
  { id: 'flawless', name: 'Flawless', hint: 'Finish a run at 100% accuracy', icon: 'Target', tier: 'silver', test: (s) => s.sessions.some((x) => x.accuracy >= 100 && x.chars > 60) },
  { id: 'accurate-10', name: 'Surgeon', hint: '10 sessions above 97% accuracy', icon: 'Crosshair', tier: 'gold', test: (s) => s.sessions.filter((x) => x.accuracy >= 97).length >= 10 },
  { id: 'streak-3', name: 'Warming Up', hint: 'A 3-day streak', icon: 'Flame', tier: 'bronze', test: (s) => (s.streak.best || 0) >= 3 },
  { id: 'streak-7', name: 'Week Solid', hint: 'A 7-day streak', icon: 'Flame', tier: 'silver', test: (s) => (s.streak.best || 0) >= 7 },
  { id: 'streak-30', name: 'Unbroken', hint: 'A 30-day streak', icon: 'Flame', tier: 'legend', test: (s) => (s.streak.best || 0) >= 30 },
  { id: 'code-10', name: 'Syntax Native', hint: 'Type 10 code snippets', icon: 'Braces', tier: 'silver', test: (s) => s.sessions.filter((x) => x.kind === 'code').length >= 10 },
  { id: 'polyglot', name: 'Polyglot', hint: 'Code-type in 5 languages', icon: 'Languages', tier: 'gold', test: (s) => new Set(s.sessions.filter((x) => x.kind === 'code').map((x) => x.lang)).size >= 5 },
  { id: 'level-10', name: 'Double Digits', hint: 'Reach level 10', icon: 'Trophy', tier: 'gold', test: (s) => s.level >= 10 },
  { id: 'marathon', name: 'Marathon', hint: 'Practise for 60 minutes total', icon: 'Timer', tier: 'silver', test: (s) => s.totalSeconds >= 3600 },
  { id: 'night-owl', name: 'Night Owl', hint: 'Finish a session after midnight', icon: 'Moon', tier: 'bronze', test: (s) => s.sessions.some((x) => new Date(x.ts).getHours() < 5) },
  { id: 'consistent', name: 'Metronome', hint: 'Finish a run above 90% consistency', icon: 'Activity', tier: 'gold', test: (s) => s.sessions.some((x) => x.consistency >= 90) },
  { id: 'battle-first', name: 'First Blood', hint: 'Finish a Battlefield', icon: 'Swords', tier: 'bronze', test: (s) => s.battles >= 1 },
  { id: 'battle-win', name: 'Champion', hint: 'Win a Battlefield', icon: 'Crown', tier: 'silver', test: (s) => s.battleWins >= 1 },
  { id: 'battle-win-5', name: 'Undisputed', hint: 'Win 5 Battlefields', icon: 'Crown', tier: 'gold', test: (s) => s.battleWins >= 5 },
  { id: 'shadow-first', name: 'Into the Dark', hint: 'Finish a Shadow Battle', icon: 'Sparkles', tier: 'bronze', test: (s) => (s.shadowBattles || 0) >= 1 || s.sessions.some((x) => x.kind === 'shadow') },
  { id: 'shadow-win', name: 'First Shadow', hint: 'Win a Shadow Battle', icon: 'Swords', tier: 'bronze', test: (s) => (s.shadowWins || 0) >= 1 || s.sessions.some((x) => x.kind === 'shadow' && x.roundsWon > x.roundsLost) },
  { id: 'shadow-flawless', name: 'Untouched', hint: 'Win a round without taking damage', icon: 'Shield', tier: 'silver', test: (s) => (s.shadowFlawless || 0) >= 1 || s.sessions.some((x) => x.kind === 'shadow' && x.flawlessRounds >= 1) },
  { id: 'shadow-parry-10', name: 'Read the Blade', hint: 'Land 10 parries', icon: 'Zap', tier: 'silver', test: (s) => (s.shadowParries || 0) >= 10 || s.sessions.some((x) => (x.parries || 0) >= 10) },
  { id: 'shadow-chain-15', name: 'Unbroken Chain', hint: 'Reach a chain of 15 in one round', icon: 'Link', tier: 'gold', test: (s) => (s.shadowBestChain || 0) >= 15 || s.sessions.some((x) => (x.bestChain || 0) >= 15) },
  { id: 'shadow-overdrive', name: 'Full Burn', hint: 'Land an Overdrive for 50+ damage', icon: 'Flame', tier: 'gold', test: (s) => (s.shadowOverdrives || 0) >= 1 || s.sessions.some((x) => x.overdriveLanded) },
  { id: 'shadow-comeback', name: 'From the Ashes', hint: 'Win a match after losing round one', icon: 'Flame', tier: 'gold', test: (s) => (s.shadowComebacks || 0) >= 1 },
  { id: 'shadow-rank-quench', name: 'Quenched', hint: 'Reach Quench tier', icon: 'Trophy', tier: 'gold', test: (s) => (s.shadowFr || 1200) >= 1400 },
  { id: 'shadow-rank-damascus', name: 'Folded Steel', hint: 'Reach Damascus tier', icon: 'Crown', tier: 'legend', test: (s) => (s.shadowFr || 1200) >= 1800 },
  { id: 'shadow-win-25', name: 'Duellist', hint: 'Win 25 Shadow Battles', icon: 'Crown', tier: 'legend', test: (s) => (s.shadowWins || 0) >= 25 || s.sessions.filter((x) => x.kind === 'shadow' && x.roundsWon > x.roundsLost).length >= 25 },
];

export const TIER_STYLES = {
  bronze: { ring: '#c08457', wash: 'rgba(192,132,87,0.14)' },
  silver: { ring: '#9aa5b1', wash: 'rgba(154,165,177,0.16)' },
  gold: { ring: '#e0a615', wash: 'rgba(224,166,21,0.16)' },
  legend: { ring: '#8a6ad6', wash: 'rgba(138,106,214,0.18)' },
};

/* ── Daily missions ────────────────────────────────────────────────────── */

const MISSION_POOL = [
  { id: 'sessions-3', label: 'Finish 3 sessions', goal: 3, xp: 40, metric: 'sessions' },
  { id: 'minutes-10', label: 'Practise for 10 minutes', goal: 600, xp: 50, metric: 'seconds', unit: 'sec' },
  { id: 'acc-96', label: 'Land a run above 96% accuracy', goal: 1, xp: 45, metric: 'accurateRuns' },
  { id: 'code-2', label: 'Type 2 code snippets', goal: 2, xp: 55, metric: 'codeRuns' },
  { id: 'pb', label: 'Beat your personal best WPM', goal: 1, xp: 80, metric: 'personalBests' },
  { id: 'chars-800', label: 'Type 800 characters', goal: 800, xp: 45, metric: 'chars' },
  { id: 'shadow-rounds-3', label: 'Win 3 Shadow rounds', goal: 3, xp: 60, metric: 'shadowRoundsWon' },
  { id: 'shadow-clean-40', label: 'Land 40 clean words in Shadow Battle', goal: 40, xp: 55, metric: 'shadowCleanWords' },
  { id: 'shadow-parry-3', label: 'Land 3 parries', goal: 3, xp: 65, metric: 'shadowParries' },
  { id: 'shadow-chain-10', label: 'Reach a chain of 10', goal: 1, xp: 50, metric: 'shadowChain10' },
];

/** Deterministic per-day pick, so the same three missions survive a refresh. */
export function missionsForDay(key = dayKey()) {
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  const pool = [...MISSION_POOL];
  const picked = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return picked;
}

export function missionProgress(mission, today) {
  const raw = today?.[mission.metric] ?? 0;
  return { value: Math.min(raw, mission.goal), done: raw >= mission.goal };
}

/* ── Daily counters ────────────────────────────────────────────────────── */

/** The shape every `daily[dayKey]` entry has. Kept beside `MISSION_POOL`
 *  because the mission metrics above are exactly these keys. */
export const EMPTY_DAY = {
  sessions: 0, seconds: 0, chars: 0, codeRuns: 0,
  accurateRuns: 0, personalBests: 0, xp: 0,
  shadowRoundsWon: 0, shadowCleanWords: 0, shadowParries: 0, shadowChain10: 0,
};

/**
 * Adds `patch` into the counters for one day, returning a new `daily` map.
 *
 * Lives here rather than in store.jsx because sync.js has to rebuild the same
 * counters when merging remote sessions, and two implementations of "what a
 * day's totals mean" would drift. sync.js already imported it from this module;
 * it was only ever defined in the store, so that import would have failed the
 * build the moment anything pulled sync.js into the graph.
 */
export function bumpDaily(daily, key, patch) {
  const today = daily[key] ?? EMPTY_DAY;
  const next = { ...today };
  for (const [k, v] of Object.entries(patch)) next[k] = (next[k] ?? 0) + v;
  return { ...daily, [key]: next };
}
