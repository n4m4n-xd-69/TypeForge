import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ACHIEVEMENTS, advanceStreak, bumpDaily, dayKey, levelFromXP, liveStreak,
  missionsForDay, missionProgress, xpForSession,
} from './gamification.js';
import { useAuth } from './auth.jsx';
import { useCloudSync } from './sync.js';

const KEY = 'keystroke.state.v2';

const EMPTY = {
  version: 2,
  profile: { name: '', goalMinutes: 15, onboarded: false, avatar: null, hideFromLeaderboard: false },
  xp: 0,
  streak: { count: 0, best: 0, last: null },
  sessions: [], // newest last, capped
  keyStats: {}, // char -> { total, wrong }
  achievements: {}, // id -> ISO unlock date
  // problemId -> { status, attempts, solvedAt, lastLanguage }. Nothing writes
  // this yet, but sync reads and merges it, and `unionProblems` dereferences
  // `local[id]` — an absent key threw the moment cloud sync touched a fresh
  // profile. Present and empty is the correct shape.
  problems: {},
  daily: {}, // dayKey -> counters used by missions + the heatmap
  settings: {
    theme: 'system',
    sound: true,
    showKeyboard: true,
    caret: 'block', // block | line | underline
    smoothCaret: true,
    confetti: true,
    blindMode: false,
    stopOnError: false,
    aiText: true, // fetch a fresh AI passage on each load
    handGuide: true, // the home-row overlay before each run
    handGuideSeen: 0, // shown at most HAND_GUIDE_LIMIT times, then retired
    fullscreen: true, // practice opens as a full-screen focus surface
    lastLanguage: 'javascript', // remembered across sessions in Code typing
    codeIntroOpen: true, // the long snippet intro, collapsible to just its name
  },
};

/** The hand guide is orientation, not furniture — three showings is enough. */
export const HAND_GUIDE_LIMIT = 3;

const MAX_SESSIONS = 400;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    // Shallow-merge so a new field added in a later version gets its default.
    return {
      ...EMPTY, ...parsed,
      profile: { ...EMPTY.profile, ...parsed.profile },
      settings: { ...EMPTY.settings, ...parsed.settings },
      // Saved before `problems` existed, so a spread alone leaves it undefined.
      problems: parsed.problems ?? EMPTY.problems,
    };
  } catch {
    return EMPTY;
  }
}

/** Recomputes which achievements are newly unlocked. Never re-locks anything. */
function evaluateAchievements(state) {
  const facts = {
    sessions: state.sessions,
    streak: state.streak,
    level: levelFromXP(state.xp).level,
    totalSeconds: state.sessions.reduce((a, s) => a + s.durationSec, 0),
    battles: state.sessions.filter((s) => s.mode === 'battle').length,
    // `rank` is stamped on by `battleRank` once the room settles, which is the
    // only moment it is known — a run is reported the instant it finishes, well
    // before anyone can say where it placed.
    battleWins: state.sessions.filter((s) => s.mode === 'battle' && s.rank === 1).length,
    best: {
      wpm: state.sessions.reduce((a, s) => Math.max(a, s.wpm), 0),
      accuracy: state.sessions.reduce((a, s) => Math.max(a, s.accuracy), 0),
    },
  };

  const unlocked = { ...state.achievements };
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    let passed = false;
    try { passed = a.test(facts); } catch { passed = false; }
    if (passed) {
      unlocked[a.id] = new Date().toISOString();
      fresh.push(a);
    }
  }
  return { unlocked, fresh };
}

function reducer(state, action) {
  switch (action.type) {
    case 'session': {
      const s = action.session;
      const today = dayKey();
      const previousBest = state.sessions.reduce((a, x) => Math.max(a, x.wpm), 0);
      const isPB = s.wpm > previousBest && s.chars > 40;
      const xp = xpForSession(s);

      const keyStats = { ...state.keyStats };
      for (const [ch, stat] of Object.entries(s.keyStats ?? {})) {
        const prev = keyStats[ch] ?? { total: 0, wrong: 0 };
        keyStats[ch] = { total: prev.total + stat.total, wrong: prev.wrong + stat.wrong };
      }

      const sessions = [...state.sessions, { ...s, xp, isPB, keyStats: undefined }].slice(-MAX_SESSIONS);

      const next = {
        ...state,
        xp: state.xp + xp,
        sessions,
        keyStats,
        streak: advanceStreak(state.streak, today),
        daily: bumpDaily(state.daily, today, {
          sessions: 1,
          seconds: Math.round(s.durationSec),
          chars: s.chars,
          codeRuns: s.kind === 'code' ? 1 : 0,
          accurateRuns: s.accuracy >= 96 ? 1 : 0,
          personalBests: isPB ? 1 : 0,
          xp,
        }),
      };
      const { unlocked, fresh } = evaluateAchievements(next);
      return { ...next, achievements: unlocked, _fresh: fresh, _lastAward: { xp, isPB } };
    }

    /**
     * Stamps a finishing position onto the most recent Battlefield run.
     *
     * Split from `session` because the two facts arrive at different times: the
     * run is reported the moment it ends (so XP lands immediately, even if the
     * player closes the tab), while the rank only exists once every other player
     * has finished and the room settles. Re-running the achievement pass here is
     * what lets "Champion" unlock on the results screen rather than a run later.
     */
    case 'battleRank': {
      const idx = [...state.sessions].reverse().findIndex((s) => s.mode === 'battle');
      if (idx === -1) return state;
      const at = state.sessions.length - 1 - idx;
      if (state.sessions[at].rank === action.rank) return state;
      const sessions = [...state.sessions];
      sessions[at] = { ...sessions[at], rank: action.rank };
      const next = { ...state, sessions };
      const { unlocked, fresh } = evaluateAchievements(next);
      return { ...next, achievements: unlocked, _fresh: fresh };
    }

    case 'setting':
      return { ...state, settings: { ...state.settings, [action.key]: action.value } };

    case 'profile':
      return { ...state, profile: { ...state.profile, ...action.patch } };

    case 'clearFresh':
      return { ...state, _fresh: [], _lastAward: null };

    case 'reset':
      return { ...EMPTY, settings: state.settings, profile: { ...EMPTY.profile, onboarded: true } };

    case 'seed':
      return { ...state, ...action.state };

    default:
      return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const saveTimer = useRef();
  const { user } = useAuth();

  /**
   * Cloud sync, as a side channel.
   *
   * Local state stays the source of truth and every write still lands in
   * localStorage first — this only mirrors it. Every function in sync.js
   * no-ops when Supabase is unconfigured or nobody is signed in, so the
   * local-only path is byte-for-byte what it was before this line existed.
   */
  useCloudSync(user, state, dispatch);

  // Debounced persistence — typing generates a lot of state churn.
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const { _fresh, _lastAward, ...persist } = state;
        localStorage.setItem(KEY, JSON.stringify(persist));
      } catch {
        /* quota or private mode — the app still works, it just won't remember */
      }
    }, 220);
    return () => clearTimeout(saveTimer.current);
  }, [state]);

  const api = useMemo(
    () => ({
      recordSession: (session) => dispatch({ type: 'session', session }),
      recordBattleRank: (rank) => dispatch({ type: 'battleRank', rank }),
      setSetting: (key, value) => dispatch({ type: 'setting', key, value }),
      updateProfile: (patch) => dispatch({ type: 'profile', patch }),
      clearFresh: () => dispatch({ type: 'clearFresh' }),
      resetAll: () => dispatch({ type: 'reset' }),
    }),
    [],
  );

  const value = useMemo(() => ({ state, ...api }), [state, api]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/* ── Derived selectors ─────────────────────────────────────────────────────
   Kept as a hook so every surface reads the same numbers. */

export function useStats() {
  const { state } = useStore();

  return useMemo(() => {
    const sessions = state.sessions;
    const level = levelFromXP(state.xp);
    const streak = liveStreak(state.streak);

    const recent = sessions.slice(-10);
    const avg = (arr, pick) => (arr.length ? arr.reduce((a, s) => a + pick(s), 0) / arr.length : 0);

    const thisWeek = sessions.filter((s) => Date.now() - new Date(s.ts).getTime() < 7 * 86_400_000);
    const lastWeek = sessions.filter((s) => {
      const age = Date.now() - new Date(s.ts).getTime();
      return age >= 7 * 86_400_000 && age < 14 * 86_400_000;
    });

    const todayKey = dayKey();
    const today = state.daily[todayKey] ?? { sessions: 0, seconds: 0, chars: 0, xp: 0 };
    const missions = missionsForDay(todayKey).map((m) => ({ ...m, ...missionProgress(m, today) }));

    return {
      xp: state.xp,
      level,
      streak,
      bestStreak: state.streak.best ?? 0,
      sessionCount: sessions.length,
      totalSeconds: sessions.reduce((a, s) => a + s.durationSec, 0),
      wpm: avg(recent, (s) => s.wpm),
      accuracy: recent.length ? avg(recent, (s) => s.accuracy) : 100,
      consistency: avg(recent, (s) => s.consistency),
      bestWPM: sessions.reduce((a, s) => Math.max(a, s.wpm), 0),
      bestAccuracy: sessions.reduce((a, s) => Math.max(a, s.accuracy), 0),
      trend: avg(thisWeek, (s) => s.wpm) - avg(lastWeek, (s) => s.wpm),
      today,
      todayMinutes: Math.round(today.seconds / 60),
      goalMinutes: state.profile.goalMinutes,
      missions,
      missionsDone: missions.filter((m) => m.done).length,
      unlockedCount: Object.keys(state.achievements).length,
      keyStats: state.keyStats,
      daily: state.daily,
      sessions,
      isNew: sessions.length === 0,
    };
  }, [state]);
}
