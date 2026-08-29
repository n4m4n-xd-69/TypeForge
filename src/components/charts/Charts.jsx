import { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, PolarAngleAxis, PolarGrid,
  PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../../lib/theme.jsx';
import { chartTokens } from './palette.js';
import { TooltipCard } from './ChartFrame.jsx';
import { cx } from '../../lib/format.js';

const AXIS_TICK = { fontSize: 11, fontWeight: 600 };

/* ── Single-series trend ───────────────────────────────────────────────────
   One measure per chart. Two measures of different scale get two charts — a
   second y-axis would be a lie about shared scale. */

export function TrendLine({ data, dataKey, label, unit = '', domain, color, formatter = (v) => Math.round(v) }) {
  const { isDark } = useTheme();
  const t = chartTokens(isDark);
  const stroke = color ?? t.brand;
  const gradientId = `grad-${dataKey}-${t.mode}`;

  if (!data.length) return <NoData />;

  /* The axis floor is 0 unless the data actually goes below it.
     The previous default was an unconditional `dataMin - 4`, which gave every
     series four units of headroom underneath — including counts. A chart of
     daily active users, XP earned or matches played would draw ticks at -1 and
     -4, quantities that cannot exist, and a flat run at zero sat a third of
     the way up the panel instead of on the baseline. Series that genuinely go
     negative keep the headroom. */
  const values = data.map((d) => Number(d[dataKey])).filter(Number.isFinite);
  const lowerBound = values.length && Math.min(...values) < 0 ? 'dataMin - 4' : 0;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={t.grid} strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ ...AXIS_TICK, fill: t.muted }}
          tickLine={false}
          axisLine={{ stroke: t.axis }}
          minTickGap={18}
        />
        <YAxis
          tick={{ ...AXIS_TICK, fill: t.muted }}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={domain ?? [lowerBound, 'dataMax + 4']}
          tickFormatter={formatter}
        />
        <Tooltip
          cursor={{ stroke: t.axis, strokeWidth: 1 }}
          content={({ active, payload, label: lbl }) =>
            active && payload?.length ? (
              <TooltipCard
                label={lbl}
                rows={[{ name: label, value: `${formatter(payload[0].value)}${unit}`, color: stroke }]}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4.5, strokeWidth: 2, stroke: t.surface }}
          animationDuration={900}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Weekly bars ───────────────────────────────────────────────────────── */

export function WeeklyBars({ data, unit = 'min', highlightLast = true }) {
  const { isDark } = useTheme();
  const t = chartTokens(isDark);

  if (!data.some((d) => d.value > 0)) return <NoData message="No practice logged this week yet." />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -22 }} barCategoryGap="26%">
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={{ ...AXIS_TICK, fill: t.muted }} tickLine={false} axisLine={{ stroke: t.axis }} />
        <YAxis tick={{ ...AXIS_TICK, fill: t.muted }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipCard label={label} rows={[{ name: 'Practice', value: `${payload[0].value} ${unit}`, color: t.brand }]} />
            ) : null
          }
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={800}>
          {data.map((d, i) => (
            <Cell
              key={d.label}
              fill={highlightLast && i === data.length - 1 ? t.brand : t.series[0]}
              fillOpacity={highlightLast && i === data.length - 1 ? 1 : 0.55}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Skill radar ───────────────────────────────────────────────────────── */

export function SkillRadar({ data }) {
  const { isDark } = useTheme();
  const t = chartTokens(isDark);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={t.grid} />
        <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fontWeight: 700, fill: t.muted }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipCard
                label={payload[0].payload.skill}
                rows={[{ name: 'Score', value: `${Math.round(payload[0].value)} / 100`, color: t.series[0] }]}
              />
            ) : null
          }
        />
        <Radar
          dataKey="value"
          stroke={t.series[0]}
          strokeWidth={2}
          fill={t.series[0]}
          fillOpacity={0.18}
          animationDuration={900}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/* ── Practice heatmap ──────────────────────────────────────────────────── */

/**
 * One calendar month at a time, navigable backwards.
 *
 * This replaced a rolling 18-week strip. That view could show a whole season at
 * once, but it could not answer "how did June go" — the columns were unlabelled
 * week boundaries with no month anywhere, so any question about a specific
 * period meant counting squares backwards from today.
 */
export function Heatmap({ days }) {
  const { isDark } = useTheme();
  const t = chartTokens(isDark);

  /**
   * Which month to open on.
   *
   * "Show last month if it has anything, otherwise this month." Someone opening
   * the dashboard on the 2nd wants to see the month they actually practised,
   * not two lonely squares — but a blank previous month would be worse than
   * either, so it only wins when it holds something.
   */
  const [offset, setOffset] = useState(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prefix = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-`;
    const prevHasData = Object.entries(days ?? {}).some(([k, v]) => k.startsWith(prefix) && (v?.seconds ?? 0) > 0);
    return prevHasData ? -1 : 0;
  });

  const { cells, label, total, active, isCurrent, hasEarlier } = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = first.getFullYear();
    const month = first.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const out = [];
    // Lead-in blanks so the 1st lands under its real weekday column.
    for (let i = 0; i < first.getDay(); i++) out.push(null);

    let seconds = 0;
    let activeDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const secs = days?.[key]?.seconds ?? 0;
      seconds += secs;
      // Counted in seconds, not rounded minutes: a 40-second drill is a day you
      // practised, and rounding it to 0 made the day vanish from both the
      // square and the "N days" summary.
      if (secs > 0) activeDays += 1;
      out.push({ key, date, day: d, seconds: secs, minutes: Math.round(secs / 60), future: date > today });
    }

    // Is there any recorded day before this month? Drives the back arrow.
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const earlier = Object.keys(days ?? {}).some((k) => k < monthStart);

    return {
      cells: out,
      label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      total: Math.round(seconds / 60),
      active: activeDays,
      isCurrent: offset >= 0,
      hasEarlier: earlier,
    };
  }, [days, offset]);

  // Keyed off seconds so any practice at all lights the square; the bands
  // above the first are still minute-scaled.
  const level = (secs) => {
    if (!secs) return -1;
    const m = secs / 60;
    return m < 5 ? 0 : m < 12 ? 1 : m < 25 ? 2 : 3;
  };

  return (
    // Capped rather than full-bleed: seven aspect-square columns across a full
    // card width give ~170px cells, which reads as a table of empty boxes
    // rather than a calendar.
    <div className="mx-auto w-full max-w-[380px]">
      <div className="mb-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOffset((o) => o - 1)}
          disabled={!hasEarlier && offset <= -1}
          aria-label="Previous month"
          className="grid h-[26px] w-[26px] place-items-center rounded-md text-ink-3 transition-colors hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft size={15} strokeWidth={2.4} aria-hidden />
        </button>
        <p className="text-sm font-bold tabular-nums">{label}</p>
        <button
          type="button"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={isCurrent}
          aria-label="Next month"
          className="grid h-[26px] w-[26px] place-items-center rounded-md text-ink-3 transition-colors hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight size={15} strokeWidth={2.4} aria-hidden />
        </button>
        <p className="ml-auto text-2xs font-bold uppercase tracking-[0.07em] text-ink-3">
          {total} min · {active} {active === 1 ? 'day' : 'days'}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-[3px]" role="grid" aria-label={`Practice in ${label}`}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="pb-0.5 text-center text-2xs font-bold text-ink-3" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((cell, i) =>
          cell === null ? (
            <span key={`pad-${i}`} aria-hidden />
          ) : (
            <div
              key={cell.key}
              title={
                cell.future
                  ? ''
                  : `${cell.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${
                      cell.seconds > 0 && cell.minutes === 0 ? '<1' : cell.minutes
                    } min`
              }
              className={cx(
                'grid aspect-square place-items-center rounded-[5px] text-2xs font-bold tabular-nums transition-transform duration-150',
                cell.future ? 'opacity-25' : 'hover:scale-[1.08]',
                cell.seconds > 0 ? 'text-brand-ink' : 'text-ink-3',
              )}
              style={{ background: level(cell.seconds) < 0 ? t.heat.empty : t.heat.steps[level(cell.seconds)] }}
            >
              {cell.day}
            </div>
          ),
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
        <span>Less</span>
        <span className="h-[10px] w-[10px] rounded-[3px]" style={{ background: t.heat.empty }} />
        {t.heat.steps.map((c) => (
          <span key={c} className="h-[10px] w-[10px] rounded-[3px]" style={{ background: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, width = 84, height = 26, color }) {
  const { isDark } = useTheme();
  const t = chartTokens(isDark);
  const stroke = color ?? t.brand;

  if (values.length < 2) return <div style={{ width, height }} aria-hidden />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`)
    .join(' ');

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={width}
        cy={height - ((values[values.length - 1] - min) / span) * (height - 4) - 2}
        r="3"
        fill={stroke}
      />
    </svg>
  );
}

function NoData({ message = 'Not enough data yet — finish a session to start the chart.' }) {
  return (
    <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-line px-2 text-center">
      <p className="max-w-[280px] text-sm text-ink-3">{message}</p>
    </div>
  );
}
