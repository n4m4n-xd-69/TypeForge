import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity, Braces, Crosshair, Crown, Flame, Gauge, Languages,
  Lock, Medal, Moon, Rocket, Sparkles, Swords, Target, Timer, Trophy, Wind, Zap,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Counter from '../../components/ui/Counter.jsx';
import { Card, Chip, ProgressRing, SectionTitle } from '../../components/ui/Primitives.jsx';
import MissionStrip from '../../components/gamify/MissionStrip.jsx';
import { useStats, useStore } from '../../lib/store.jsx';
import { ACHIEVEMENTS, LEVEL_TITLES, TIER_STYLES, levelTitle, xpForLevel } from '../../lib/gamification.js';
import { cx } from '../../lib/format.js';
import Avatar from '../../components/ui/Avatar.jsx';
import { supabase } from '../../lib/supabase.js';

/* Explicit map rather than `import * as Icons` — a namespace import of
   lucide-react drags every icon in the library into this chunk. */
const BADGE_ICONS = {
  Activity, Braces, Crosshair, Crown, Flame, Gauge, Languages,
  Moon, Rocket, Sparkles, Swords, Target, Timer, Trophy, Wind, Zap,
};

/**
 * The live board, with you folded in.
 *
 * Reads `public.leaderboard` — a view carrying a display name and an XP total
 * and nothing else, so ranking never requires exposing a profile.
 *
 * Your own row comes from local state rather than the view, because the view
 * only sees what has been synced. Between finishing a run and the two-second
 * push landing, the server's copy is stale by exactly one session; taking the
 * local figure means your XP moves the instant you earn it, which is what the
 * page is for. The remote copy of you is dropped so you never appear twice.
 *
 * Falls back to a board of one — you — when signed out or unconfigured, rather
 * than inventing rivals. A fake ranking is worse than an honest empty one.
 */
function useLeaderboard(name, xp, avatar) {
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    supabase
      .from('leaderboard')
      .select('display_name, avatar, xp')
      .order('xp', { ascending: false })
      .limit(25)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[leaderboard] unavailable:', error.message);
          setRemote([]);
          return;
        }
        setRemote(data ?? []);
      });
    return () => { cancelled = true; };
  }, [xp]); // refetch once your own total moves, so the board stays current

  return useMemo(() => {
    const you = { name: name || 'You', avatar, xp, you: true };
    const others = (remote ?? [])
      .filter((r) => r.display_name && r.display_name !== you.name)
      .map((r) => ({ name: r.display_name, avatar: r.avatar ?? null, xp: r.xp ?? 0, you: false }));

    return {
      live: Boolean(supabase) && others.length > 0,
      rows: [...others, you].sort((a, b) => b.xp - a.xp).slice(0, 10),
    };
  }, [remote, name, xp, avatar]);
}

export default function Achievements() {
  const stats = useStats();
  const { state } = useStore();

  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]);
  const locked = ACHIEVEMENTS.filter((a) => !state.achievements[a.id]);

  const { rows: leaderboard, live } = useLeaderboard(state.profile.name, stats.xp, state.profile.avatar);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Rewards</p>
          <h1 className="mt-0.5 text-3xl font-extrabold">Level up</h1>
          <p className="mt-0.5 max-w-[52ch] text-sm text-ink-3">
            XP comes from finishing runs, and accuracy is the multiplier. Mashing keys will not level you.
          </p>
        </div>
        <Button as={Link} to="/practice" variant="brand" icon={Zap}>
          Earn XP
        </Button>
      </header>

      <div className="grid gap-2.5 lg:grid-cols-[320px_1fr]">
        {/* Level card */}
        <Card className="relative overflow-hidden p-3">
          <div className="absolute -right-8 -top-8 h-16 w-16 rounded-full bg-brand-solid/20 blur-2xl" aria-hidden />
          <div className="relative flex flex-col items-center text-center">
            <ProgressRing value={stats.level.progress} size={140} stroke={12}>
              <div>
                <p className="font-mono text-4xl font-medium leading-none tnum">{stats.level.level}</p>
                <p className="mt-0.5 text-2xs font-extrabold uppercase tracking-[0.1em] text-ink-3">level</p>
              </div>
            </ProgressRing>
            <p className="mt-2 text-xl font-extrabold">{levelTitle(stats.level.level)}</p>
            <p className="text-sm text-ink-3">
              <Counter value={stats.xp} /> XP · {stats.level.toNext} to next
            </p>

            <div className="mt-2.5 w-full space-y-1">
              {LEVEL_TITLES.map(([at, name]) => {
                const reached = stats.level.level >= at;
                return (
                  <div
                    key={name}
                    className={cx(
                      'flex items-center gap-1 rounded-sm px-1 py-0.5 text-sm',
                      reached ? 'bg-brand-wash font-bold text-brand' : 'text-ink-3',
                    )}
                  >
                    <span className="w-[34px] font-mono text-xs tnum">Lv {at}</span>
                    {name}
                    <span className="ml-auto font-mono text-2xs tnum">{xpForLevel(at)} XP</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="space-y-2.5">
          <Card className="p-2.5">
            <SectionTitle title="Daily missions" hint={`${stats.missionsDone} of ${stats.missions.length} complete · resets at midnight`} />
            <MissionStrip missions={stats.missions} className="mt-2" />
          </Card>

          <Card className="p-2.5">
            <SectionTitle
              title="Leaderboard"
              hint={live ? 'Total XP · everyone playing, updated as you earn' : 'Sign in to appear on the live board'}
            />
            <ol className="mt-1.5 divide-y divide-line">
              {leaderboard.map((row, i) => (
                <li
                  // Names are not unique — the live board already has two
                  // different players called "Meow". A name-only key makes
                  // React reconcile the wrong rows, which can move the "you"
                  // highlight onto a stranger.
                  key={`${i}-${row.name}-${row.xp}`}
                  className={cx(
                    'flex items-center gap-1.5 py-1',
                    row.you && '-mx-1 rounded-sm bg-brand-wash px-1',
                  )}
                >
                  <span className={cx('w-[22px] font-mono text-sm font-bold tnum', i < 3 ? 'text-brand' : 'text-ink-3')}>
                    {i + 1}
                  </span>
                  {i === 0 ? <Crown size={14} className="text-warn" aria-hidden /> : null}
                  <Avatar
                    value={row.avatar}
                    name={row.name}
                    size={26}
                    className={cx(row.you && 'ring-2 ring-brand ring-offset-1 ring-offset-surface')}
                  />
                  <span className={cx('text-sm', row.you ? 'font-extrabold' : 'font-semibold text-ink-2')}>
                    {row.name}
                    {row.you ? ' (you)' : ''}
                  </span>
                  <span className="ml-auto font-mono text-sm font-bold tnum">{row.xp.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <section>
        <SectionTitle
          title="Badges"
          hint={`${unlocked.length} of ${ACHIEVEMENTS.length} unlocked`}
          className="mb-1.5"
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...unlocked, ...locked].map((a, i) => (
            <AchievementCard
              key={a.id}
              achievement={a}
              unlockedAt={state.achievements[a.id]}
              delay={Math.min(0.35, i * 0.025)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function AchievementCard({ achievement, unlockedAt, delay }) {
  const Icon = BADGE_ICONS[achievement.icon] ?? Medal;
  const tier = TIER_STYLES[achievement.tier];
  const unlocked = Boolean(unlockedAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card
        interactive={unlocked}
        className={cx('flex items-center gap-1.5 p-2 transition-opacity', !unlocked && 'opacity-60')}
      >
        <span
          className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-md border-2"
          style={
            unlocked
              ? { borderColor: tier.ring, background: tier.wash, color: tier.ring }
              : { borderColor: 'rgb(var(--line))', background: 'rgb(var(--subtle))', color: 'rgb(var(--ink-3))' }
          }
          aria-hidden
        >
          {unlocked ? <Icon size={20} strokeWidth={2.2} /> : <Lock size={17} strokeWidth={2.2} />}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-0.5">
            <p className="truncate text-sm font-extrabold">{achievement.name}</p>
            <Chip
              className="shrink-0"
              style={unlocked ? { color: tier.ring, background: tier.wash } : undefined}
            >
              {achievement.tier}
            </Chip>
          </div>
          <p className="truncate text-xs text-ink-3">{achievement.hint}</p>
          {unlocked ? (
            <p className="text-2xs text-ink-3">
              {new Date(unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </p>
          ) : null}
        </div>
      </Card>
    </motion.div>
  );
}
