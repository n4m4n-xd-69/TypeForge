import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Award, Braces, CalendarDays, Flame, Gauge, Sparkles, Target, TrendingDown, TrendingUp, Zap,
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import Counter from '../../components/ui/Counter.jsx';
import { Card, Chip, EmptyState, ProgressBar, SectionTitle, Skeleton } from '../../components/ui/Primitives.jsx';
import ChartFrame, { DataTable } from '../../components/charts/ChartFrame.jsx';
import { Heatmap, SkillRadar, TrendLine, WeeklyBars } from '../../components/charts/Charts.jsx';
import { useStats, useStore } from '../../lib/store.jsx';
import { coachInsight } from '../../lib/ai.js';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { levelTitle } from '../../lib/gamification.js';
import { cx, humanDuration, relativeTime } from '../../lib/format.js';

const RANGES = [
  { value: 20, label: '20 runs' },
  { value: 50, label: '50 runs' },
  { value: 0, label: 'All' },
];

export default function Dashboard() {
  const stats = useStats();
  const { state } = useStore();
  const [range, setRange] = useState(20);

  const series = useMemo(() => {
    const slice = range ? stats.sessions.slice(-range) : stats.sessions;
    return slice.map((s, i) => ({
      label: new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      run: i + 1,
      wpm: Math.round(s.wpm),
      accuracy: Math.round(s.accuracy * 10) / 10,
      consistency: Math.round(s.consistency),
    }));
  }, [stats.sessions, range]);

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

  const skills = useMemo(() => {
    const codeRuns = stats.sessions.filter((s) => s.kind === 'code').length;
    return [
      { skill: 'Speed', value: Math.min(100, (stats.wpm / 110) * 100) },
      { skill: 'Accuracy', value: Math.min(100, stats.accuracy) },
      { skill: 'Consistency', value: Math.min(100, stats.consistency) },
      { skill: 'Code', value: Math.min(100, (codeRuns / 25) * 100) },
      { skill: 'Endurance', value: Math.min(100, (stats.totalSeconds / 1800) * 100) },
      { skill: 'Habit', value: Math.min(100, (stats.streak / 21) * 100) },
    ];
  }, [stats]);

  const weak = useMemo(() => weakestKeys(stats.keyStats, 8, 8), [stats.keyStats]);

  if (stats.isNew) {
    return (
      <div className="space-y-3">
        <Header stats={stats} />
        <Card className="py-6">
          <EmptyState
            icon={Activity}
            title="No data yet"
            description="Your dashboard fills in as you practise. One 60-second run is enough to draw the first chart."
            action={
              <Button as={Link} to="/practice" variant="primary" icon={Zap}>
                Start a session
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Header stats={stats} />

      {/* KPI row */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Gauge}
          label="Average WPM"
          value={Math.round(stats.wpm)}
          delta={stats.trend}
          hint="last 10 runs"
        />
        <Kpi icon={Target} label="Accuracy" value={Math.round(stats.accuracy)} suffix="%" hint="last 10 runs" />
        <Kpi icon={Activity} label="Consistency" value={Math.round(stats.consistency)} suffix="%" hint="steadiness of pace" />
        <Kpi icon={Flame} label="Streak" value={stats.streak} suffix=" days" hint={`best ${stats.bestStreak}`} />
      </div>

      <div className="grid gap-2.5 xl:grid-cols-3">
        <Card className="p-2.5 xl:col-span-2">
          <ChartFrame
            title="WPM growth"
            hint="Net words per minute, per session"
            height={240}
            action={<Segmented size="sm" label="Range" options={RANGES} value={range} onChange={setRange} />}
            table={
              <DataTable
                columns={['Date', 'Run', 'WPM']}
                rows={series.map((s) => [s.label, s.run, s.wpm])}
              />
            }
          >
            <TrendLine data={series} dataKey="wpm" label="WPM" />
          </ChartFrame>
        </Card>

        <Card className="p-2.5">
          <ChartFrame
            title="Accuracy trend"
            hint="Percentage of keystrokes landed first time"
            height={240}
            table={<DataTable columns={['Date', 'Accuracy']} rows={series.map((s) => [s.label, `${s.accuracy}%`])} />}
          >
            <TrendLine data={series} dataKey="accuracy" label="Accuracy" unit="%" domain={[80, 100]} />
          </ChartFrame>
        </Card>
      </div>

      <div className="grid gap-2.5 xl:grid-cols-3">
        <Card className="p-2.5">
          <ChartFrame
            title="This week"
            hint="Minutes practised per day"
            height={200}
            table={<DataTable columns={['Day', 'Minutes']} rows={week.map((w) => [w.label, w.value])} />}
          >
            <WeeklyBars data={week} />
          </ChartFrame>
        </Card>

        <Card className="p-2.5">
          <ChartFrame
            title="Skill breakdown"
            hint="Where you are strong, and where you are not"
            height={200}
            table={<DataTable columns={['Skill', 'Score']} rows={skills.map((s) => [s.skill, Math.round(s.value)])} />}
          >
            <SkillRadar data={skills} />
          </ChartFrame>
        </Card>

        <Card className="p-2.5">
          <SectionTitle title="Personal bests" hint="All time" />
          <ul className="mt-2 space-y-1.5">
            <Best label="Fastest run" value={`${Math.round(stats.bestWPM)} WPM`} icon={Zap} />
            <Best label="Best accuracy" value={`${Math.round(stats.bestAccuracy)}%`} icon={Target} />
            <Best label="Longest streak" value={`${stats.bestStreak} days`} icon={Flame} />
            <Best label="Time practised" value={humanDuration(stats.totalSeconds)} icon={CalendarDays} />
            <Best label="Badges unlocked" value={stats.unlockedCount} icon={Award} />
          </ul>
        </Card>
      </div>

      <Card className="p-2.5">
        <ChartFrame title="Practice footprint" hint="A month at a time — use the arrows to look back" height="auto">
          <Heatmap days={state.daily} />
        </ChartFrame>
      </Card>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <Insight stats={stats} />

        <Card className="p-2.5">
          <SectionTitle title="Keys costing you most" hint="At least 8 attempts recorded" />
          {weak.length ? (
            <ul className="mt-2 flex flex-wrap gap-1">
              {weak.map((k) => (
                <li
                  key={k.key}
                  className="flex items-center gap-1 rounded-sm border border-line bg-subtle/60 px-1.5 py-1"
                  title={`${k.wrong} misses in ${k.total} attempts`}
                >
                  <span className="font-mono text-lg font-bold">{keyLabel(k.key)}</span>
                  <span className="text-xs font-bold text-bad tnum">{Math.round(k.rate * 100)}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-ink-3">
              No key has enough misses to call it a weakness yet. Keep going and this fills in.
            </p>
          )}
          <Button as={Link} to="/practice?mode=drill" variant="secondary" size="sm" className="mt-2" icon={Braces}>
            Drill these keys
          </Button>
        </Card>
      </div>

      <Card className="p-2.5">
        <SectionTitle title="Recent activity" hint={`${stats.sessionCount} sessions logged`} />
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                {['When', 'Mode', 'WPM', 'Accuracy', 'Consistency', 'XP'].map((h) => (
                  <th key={h} scope="col" className="px-1 py-1 text-left text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.sessions.slice(-10).reverse().map((s, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-1 py-1 text-ink-3">{relativeTime(s.ts)}</td>
                  <td className="px-1 py-1">
                    <Chip tone={s.kind === 'code' ? 'brand' : 'neutral'}>{s.lang ?? s.mode}</Chip>
                  </td>
                  <td className="px-1 py-1 font-mono font-bold tnum">{Math.round(s.wpm)}</td>
                  <td className="px-1 py-1 tnum">{Math.round(s.accuracy)}%</td>
                  <td className="px-1 py-1 tnum">{Math.round(s.consistency)}%</td>
                  <td className="px-1 py-1 tnum text-brand">+{s.xp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

function Header({ stats }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <p className="eyebrow">Analytics</p>
        <h1 className="mt-0.5 text-3xl font-bold">Your progress</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Level {stats.level.level} · {levelTitle(stats.level.level)} · {stats.xp.toLocaleString()} XP
        </p>
      </div>
      <div className="w-full max-w-[280px]">
        <div className="mb-0.5 flex justify-between text-xs font-bold">
          <span className="text-ink-3">Level {stats.level.level}</span>
          <span className="text-ink-3">{stats.level.toNext} XP to go</span>
        </div>
        <ProgressBar value={stats.level.progress} label="Level progress" />
      </div>
    </header>
  );
}

function Kpi({ icon: Icon, label, value, suffix = '', delta, hint }) {
  const up = delta > 0.2;
  const down = delta < -0.2;
  return (
    <Card className="p-2">
      <div className="flex items-center gap-1">
        <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-subtle text-ink-2">
          <Icon size={15} strokeWidth={2.2} aria-hidden />
        </span>
        <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
      </div>
      <p className="mt-1.5 font-mono text-3xl font-medium leading-none tnum">
        <Counter value={value} />
        <span className="text-lg text-ink-3">{suffix}</span>
      </p>
      <div className="mt-1 flex items-center gap-0.5 text-xs">
        {delta !== undefined && (up || down) ? (
          <span className={cx('flex items-center gap-px font-bold', up ? 'text-good' : 'text-bad')}>
            {up ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
            {Math.abs(delta).toFixed(1)}
          </span>
        ) : null}
        <span className="text-ink-3">{hint}</span>
      </div>
    </Card>
  );
}

function Best({ label, value, icon: Icon }) {
  return (
    <li className="flex items-center gap-1.5">
      <Icon size={15} className="text-ink-3" aria-hidden />
      <span className="text-sm text-ink-2">{label}</span>
      <span className="ml-auto font-mono text-base font-bold tnum">{value}</span>
    </li>
  );
}

/** AI weekly read. Falls back to a locally computed observation offline. */
function Insight({ stats }) {
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
      weakKeys: weakestKeys(stats.keyStats, 3).map((k) => keyLabel(k.key)),
    }).then((res) => {
      if (!cancelled) setInsight(res);
    });
    return () => {
      cancelled = true;
    };
  }, [stats.sessionCount, stats.wpm, stats.accuracy, stats.consistency, stats.streak, stats.trend, stats.keyStats]);

  return (
    <Card className="relative overflow-hidden p-2.5">
      <div className="absolute -right-4 -top-4 h-10 w-10 rounded-full bg-brand-solid/20 blur-xl" aria-hidden />
      <div className="flex items-center gap-1">
        <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-brand-wash text-brand">
          <Sparkles size={15} strokeWidth={2.4} aria-hidden />
        </span>
        <h2 className="text-lg font-bold">Coach's read</h2>
        {insight?.source === 'offline' ? <Chip tone="warn" className="ml-auto">offline</Chip> : null}
      </div>

      {insight ? (
        <p className="mt-1.5 text-base leading-relaxed text-ink-2">{insight.text}</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-1.5 w-[86%]" />
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        <Button as={Link} to="/practice" size="sm" variant="brand" icon={Zap}>
          Practise now
        </Button>
        <Button as={Link} to="/code" size="sm" variant="secondary" icon={Braces}>
          Code typing
        </Button>
      </div>
    </Card>
  );
}
