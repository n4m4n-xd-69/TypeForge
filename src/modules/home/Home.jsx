import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Award, Braces, CalendarCheck, Flame, Keyboard, Sparkles, Target, Trophy, Zap,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Counter from '../../components/ui/Counter.jsx';
import { Card, Chip, ProgressBar, ProgressRing, SectionTitle, Skeleton } from '../../components/ui/Primitives.jsx';
import ChartFrame, { DataTable } from '../../components/charts/ChartFrame.jsx';
import { Sparkline, WeeklyBars } from '../../components/charts/Charts.jsx';
import MissionStrip from '../../components/gamify/MissionStrip.jsx';
import Onboarding from './Onboarding.jsx';
import { useStats, useStore } from '../../lib/store.jsx';
import { coachInsight } from '../../lib/ai.js';
import { ACHIEVEMENTS, TIER_STYLES, dayKey, levelTitle } from '../../lib/gamification.js';
import { LANGUAGES } from '../../lib/content.js';
import { cx, greeting, humanDuration, longDate, relativeTime, seeded } from '../../lib/format.js';

export default function Home() {
  const navigate = useNavigate();
  const { state } = useStore();
  const stats = useStats();
  const [onboardingOpen, setOnboardingOpen] = useState(!state.profile.onboarded);

  const week = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        value: Math.round((state.daily[key]?.seconds ?? 0) / 60),
      });
    }
    return out;
  }, [state.daily]);

  const goalProgress = Math.min(1, stats.todayMinutes / Math.max(1, stats.goalMinutes));
  const wpmHistory = stats.sessions.slice(-14).map((s) => s.wpm);
  const challenge = useDailyChallenge();

  return (
    <div className="space-y-3">
      <Hero
        name={state.profile.name}
        stats={stats}
        onStart={() => navigate('/practice')}
        onCode={() => navigate('/code')}
      />

      {/* Two primary actions */}
      <section className="grid gap-2 md:grid-cols-2">
        <ActionCard
          to="/practice"
          eyebrow="Prose"
          title="Start typing"
          blurb="Time, words, quotes, drills and zen. Live WPM, accuracy and a keyboard that shows you the next key."
          icon={Keyboard}
          accent="from-brand-solid/35"
          stat={stats.sessionCount ? `${Math.round(stats.wpm)} WPM average` : 'Set your baseline'}
        />
        <ActionCard
          to="/code"
          eyebrow="Code"
          title="Code typing"
          blurb="Real snippets with syntax highlighting in eleven languages, plus an AI panel that explains what you just typed."
          icon={Braces}
          accent="from-[#6bb8d6]/35"
          stat={`${LANGUAGES.length} languages`}
        />
      </section>

      {/* Daily progress */}
      <section className="grid gap-2.5 xl:grid-cols-[300px_1fr_300px]">
        <Card className="p-2.5">
          <SectionTitle title="Today" hint={longDate()} />
          <div className="mt-2 flex items-center gap-2">
            <ProgressRing value={goalProgress} size={112} stroke={11}>
              <div>
                <p className="font-mono text-2xl font-medium leading-none tnum">{stats.todayMinutes}</p>
                <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">min</p>
              </div>
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {goalProgress >= 1
                  ? 'Daily goal met.'
                  : `${Math.max(0, stats.goalMinutes - stats.todayMinutes)} min to go`}
              </p>
              <p className="mt-px text-xs leading-relaxed text-ink-3">
                {stats.streak > 0
                  ? `Keeps your ${stats.streak}-day streak alive.`
                  : 'Finish one session to start a streak.'}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <MiniStat label="Sessions" value={stats.today.sessions ?? 0} />
                <MiniStat label="XP today" value={stats.today.xp ?? 0} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-2.5">
          <ChartFrame
            title="Weekly rhythm"
            hint="Minutes practised each day"
            height={180}
            table={<DataTable columns={['Day', 'Minutes']} rows={week.map((w) => [w.label, w.value])} />}
            action={
              <Link to="/dashboard" className="text-xs font-bold text-brand hover:underline">
                Full report →
              </Link>
            }
          >
            <WeeklyBars data={week} />
          </ChartFrame>
        </Card>

        <Card className="p-2.5">
          <SectionTitle title="Daily missions" hint={`${stats.missionsDone}/${stats.missions.length} done`} />
          <MissionStrip missions={stats.missions} className="mt-1.5" />
        </Card>
      </section>

      {/* Stats row */}
      <section className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Zap} label="Average WPM" value={Math.round(stats.wpm)} trail={wpmHistory} />
        <StatCard icon={Target} label="Accuracy" value={Math.round(stats.accuracy)} suffix="%" />
        <StatCard icon={Flame} label="Streak" value={stats.streak} suffix=" d" hint={`best ${stats.bestStreak}`} />
        <StatCard icon={Trophy} label="Level" value={stats.level.level} hint={levelTitle(stats.level.level)} />
      </section>

      {/* Challenge + insight */}
      <section className="grid gap-2.5 lg:grid-cols-2">
        <ChallengeCard challenge={challenge} />
        <InsightCard stats={stats} />
      </section>

      {/* Activity + badges */}
      <section className="grid gap-2.5 lg:grid-cols-2">
        <Card className="p-2.5">
          <SectionTitle
            title="Recent activity"
            hint={stats.sessionCount ? `${stats.sessionCount} sessions` : 'Nothing yet'}
            action={
              <Link to="/dashboard" className="text-xs font-bold text-brand hover:underline">
                See all →
              </Link>
            }
          />
          {stats.sessions.length ? (
            <ul className="mt-1.5 divide-y divide-line">
              {stats.sessions.slice(-5).reverse().map((s, i) => (
                <li key={i} className="flex items-center gap-1.5 py-1.5">
                  <span
                    className={cx(
                      'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px]',
                      s.kind === 'code' ? 'bg-brand-wash text-brand' : 'bg-subtle text-ink-2',
                    )}
                    aria-hidden
                  >
                    {s.kind === 'code' ? <Braces size={15} /> : <Keyboard size={15} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {s.kind === 'code' ? `${s.lang} snippet` : `${s.mode} run`}
                    </p>
                    <p className="text-xs text-ink-3">
                      {Math.round(s.wpm)} WPM · {Math.round(s.accuracy)}% · {humanDuration(s.durationSec)}
                    </p>
                  </div>
                  <span className="ml-auto shrink-0 text-right">
                    <span className="block font-mono text-sm font-bold text-brand tnum">+{s.xp}</span>
                    <span className="block text-2xs text-ink-3">{relativeTime(s.ts)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-ink-3">
              Your finished runs land here with WPM, accuracy and the XP they earned.
            </p>
          )}
        </Card>

        <Card className="p-2.5">
          <SectionTitle
            title="Recent badges"
            hint={`${stats.unlockedCount} of ${ACHIEVEMENTS.length} unlocked`}
            action={
              <Link to="/achievements" className="text-xs font-bold text-brand hover:underline">
                All rewards →
              </Link>
            }
          />
          <BadgeStrip achievements={state.achievements} />
        </Card>
      </section>

      <Onboarding
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onStart={(focus) => navigate(focus === 'code' ? '/code' : focus === 'battle' ? '/battle' : '/practice')}
      />
    </div>
  );
}

/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero({ name, stats, onStart, onCode }) {
  const fresh = stats.isNew;

  return (
    /* Grid, not an absolutely-positioned overlay. The level panel used to be
       centred with `top-1/2` inside an `overflow-hidden` card, so whenever it
       was taller than the hero its lower half was simply cut off. As a grid
       column it defines its own row height and can never clip. */
    <section className="relative overflow-hidden rounded-xl border border-line bg-surface px-2.5 py-4 sm:px-5 sm:py-6">
      <div className="relative grid items-center gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 max-w-[720px]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <span className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface/80 px-1 py-px text-2xs font-bold uppercase tracking-[0.1em] text-brand">
            <Sparkles size={11} aria-hidden />
            {fresh ? 'Welcome to TypeForge' : longDate()}
          </span>

          {/* The marketing headline moved to the public landing page, where a
              stranger sees it. Reaching /home means either a returning user or
              someone who skipped onboarding — neither needs the pitch, and
              repeating it here would make the dashboard read like an advert
              for the thing they are already inside. */}
          <h1 className="mt-1.5 font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            {fresh ? 'Set your baseline.' : `${greeting()}${name ? `, ${name}` : ''}.`}
          </h1>

          <p className="mt-1.5 max-w-[54ch] text-base leading-relaxed text-ink-2">
            {fresh
              ? 'One sixty-second run is enough to draw the first chart and tell you which keys are costing you.'
              : 'Keep your eyes on the screen. Your fingers already know the way — the numbers below are just proof.'}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <Button size="lg" variant="primary" icon={Keyboard} iconRight={ArrowRight} onClick={onStart}>
              Start typing
            </Button>
            <Button size="lg" variant="secondary" icon={Braces} onClick={onCode}>
              Code typing
            </Button>
            {!fresh ? (
              <span className="ml-1 flex items-center gap-0.5 text-sm font-bold text-ink-3">
                <Flame size={15} className="text-brand" aria-hidden />
                {stats.streak}-day streak
              </span>
            ) : null}
          </div>

          {fresh ? (
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-3">
              {['Live WPM, accuracy and consistency', 'Syntax-aware code drills', 'XP, levels and daily missions', 'Works offline'].map(
                (f) => (
                  <li key={f} className="flex items-center gap-0.5">
                    <span className="h-0.5 w-0.5 rounded-full bg-brand-solid" aria-hidden />
                    {f}
                  </li>
                ),
              )}
            </ul>
          ) : null}
        </motion.div>
      </div>

        {/* Level panel — a real grid column, hidden below xl where it would crowd. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="glass-raised hidden self-center rounded-lg border border-line p-2 xl:block"
        >
          <div className="flex items-baseline justify-between gap-1">
            <p className="eyebrow">Level {stats.level.level}</p>
            <p className="font-mono text-2xs text-ink-3 tnum">{stats.xp.toLocaleString()} XP</p>
          </div>
          <p className="mt-0.5 text-xl font-bold leading-tight">{levelTitle(stats.level.level)}</p>
          <ProgressBar value={stats.level.progress} className="mt-1.5" label="Level progress" />
          <p className="mt-0.5 text-2xs text-ink-3">{stats.level.toNext} XP to next level</p>
          <div className="mt-2 grid grid-cols-2 gap-1 border-t border-line pt-1.5">
            <div>
              <p className="font-mono text-lg font-medium leading-none tnum">{Math.round(stats.wpm)}</p>
              <p className="mt-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">wpm</p>
            </div>
            <div>
              <p className="font-mono text-lg font-medium leading-none tnum">{Math.round(stats.accuracy)}%</p>
              <p className="mt-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">accuracy</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

function ActionCard({ to, eyebrow, title, blurb, icon: Icon, accent, stat }) {
  return (
    <Link to={to} className="group block">
      <Card interactive className="relative h-full overflow-hidden p-2.5 sm:p-3">
        <div
          className={cx(
            'pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-gradient-to-br to-transparent blur-2xl transition-transform duration-700 group-hover:scale-125',
            accent,
          )}
          aria-hidden
        />
        <div className="relative flex items-start gap-2">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md bg-ink text-bg transition-transform duration-300 group-hover:scale-105 dark:bg-brand-solid dark:text-brand-ink">
            <Icon size={22} strokeWidth={2.1} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="mt-px flex items-center gap-0.5 text-xl font-bold">
              {title}
              <ArrowRight
                size={17}
                className="translate-x-0 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
                aria-hidden
              />
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-3">{blurb}</p>
            <Chip tone="brand" className="mt-1.5">
              {stat}
            </Chip>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function StatCard({ icon: Icon, label, value, suffix = '', hint, trail }) {
  return (
    <Card className="p-2">
      <div className="flex items-center gap-1">
        <Icon size={14} className="text-ink-3" aria-hidden />
        <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
      </div>
      <div className="mt-1 flex items-end justify-between gap-1">
        <p className="font-mono text-2xl font-medium leading-none tnum">
          <Counter value={value} />
          <span className="text-base text-ink-3">{suffix}</span>
        </p>
        {trail?.length > 1 ? <Sparkline values={trail} width={64} height={24} /> : null}
      </div>
      {hint ? <p className="mt-0.5 text-2xs text-ink-3">{hint}</p> : null}
    </Card>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-sm border border-line px-1 py-0.5">
      <p className="font-mono text-sm font-bold tnum">{value}</p>
      <p className="text-2xs font-bold uppercase tracking-[0.07em] text-ink-3">{label}</p>
    </div>
  );
}

/* ── Daily challenge ───────────────────────────────────────────────────── */

const CHALLENGES = [
  { id: 'quote', title: 'Quote sprint', blurb: 'Type three quotes without dropping below 95% accuracy.', to: '/practice?mode=quote', icon: CalendarCheck },
  { id: 'code', title: 'Snippet of the day', blurb: 'Clear one hard snippet in the language of your choice.', to: '/code', icon: Braces },
  { id: 'symbols', title: 'Bracket bootcamp', blurb: 'Run the brackets and symbols drill twice.', to: '/practice?mode=drill', icon: Keyboard },
];

function useDailyChallenge() {
  return useMemo(() => {
    const idx = Math.floor(seeded(dayKey()) * CHALLENGES.length);
    return CHALLENGES[idx];
  }, []);
}

function ChallengeCard({ challenge }) {
  const Icon = challenge.icon;
  return (
    <Card className="relative overflow-hidden p-2.5">
      <div className="absolute -right-6 -bottom-6 h-14 w-14 rounded-full bg-brand-solid/20 blur-2xl" aria-hidden />
      <div className="relative">
        <p className="eyebrow">Daily challenge</p>
        <div className="mt-1 flex items-start gap-1.5">
          <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-md bg-brand-solid text-brand-ink">
            <Icon size={18} strokeWidth={2.2} aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">{challenge.title}</h2>
            <p className="mt-px text-sm leading-relaxed text-ink-3">{challenge.blurb}</p>
          </div>
        </div>
        <Button as={Link} to={challenge.to} variant="brand" size="sm" className="mt-2" iconRight={ArrowRight}>
          Take the challenge
        </Button>
      </div>
    </Card>
  );
}

/* ── AI insight ────────────────────────────────────────────────────────── */

function InsightCard({ stats }) {
  const [insight, setInsight] = useState(null);

  useEffect(() => {
    let cancelled = false;
    coachInsight({
      sessions: stats.sessionCount,
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      consistency: stats.consistency,
      streak: stats.streak,
      trend: stats.trend,
    }).then((res) => !cancelled && setInsight(res));
    return () => {
      cancelled = true;
    };
  }, [stats.sessionCount, stats.wpm, stats.accuracy, stats.consistency, stats.streak, stats.trend]);

  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-1">
        <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-brand-wash text-brand">
          <Sparkles size={15} strokeWidth={2.4} aria-hidden />
        </span>
        <h2 className="text-lg font-bold">Coach's read</h2>
        {insight?.source === 'offline' ? <Chip tone="warn" className="ml-auto">offline</Chip> : null}
      </div>
      {insight ? (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{insight.text}</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-1.5 w-[88%]" />
          <Skeleton className="h-1.5 w-[62%]" />
        </div>
      )}
    </Card>
  );
}

/* ── Badges ────────────────────────────────────────────────────────────── */

function BadgeStrip({ achievements }) {
  const unlocked = ACHIEVEMENTS.filter((a) => achievements[a.id]).slice(-4);
  const next = ACHIEVEMENTS.filter((a) => !achievements[a.id]).slice(0, 4 - unlocked.length);

  if (!unlocked.length) {
    return (
      <div className="mt-1.5">
        <p className="text-sm text-ink-3">No badges yet — the first one unlocks the moment you finish a run.</p>
        <ul className="mt-1.5 grid grid-cols-2 gap-1">
          {next.map((a) => (
            <li key={a.id} className="flex items-center gap-1 rounded-sm border border-dashed border-line px-1 py-1">
              <Award size={15} className="shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold">{a.name}</span>
                <span className="block truncate text-2xs text-ink-3">{a.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="mt-1.5 grid grid-cols-2 gap-1">
      {unlocked.map((a) => {
        const tier = TIER_STYLES[a.tier];
        return (
          <li
            key={a.id}
            className="flex items-center gap-1 rounded-sm border px-1 py-1"
            style={{ borderColor: tier.ring, background: tier.wash }}
          >
            <Award size={15} className="shrink-0" style={{ color: tier.ring }} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold">{a.name}</span>
              <span className="block truncate text-2xs text-ink-3">{a.hint}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
