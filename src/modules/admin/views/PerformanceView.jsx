import { useMemo, useState } from 'react';
import { Braces, CheckCheck, Crosshair, Gauge, Timer, Type, Users } from 'lucide-react';
import { cx, humanDuration } from '../../../lib/format.js';
import { ProgressBar } from '../../../components/ui/Primitives.jsx';
import Segmented from '../../../components/ui/Segmented.jsx';
import { useTheme } from '../../../lib/theme.jsx';
import ChartFrame, { DataTable } from '../../../components/charts/ChartFrame.jsx';
import { TrendLine } from '../../../components/charts/Charts.jsx';
import { chartTokens } from '../../../components/charts/palette.js';
import {
  ConsoleTable, MetricRack, MetricTile, Panel, StateBlock, ViewHeader,
  useConsole, useConsoleQuery,
} from '../kit/index.js';
import { fetchCodingAnalytics, fetchKpis, fetchTimeseries, fetchTypingAnalytics } from '../api/console.js';

/**
 * Performance analytics.
 *
 * One query, four lenses. `admin_typing_analytics` takes the grouping axis as
 * a parameter, so switching between language / difficulty / mode / kind is a
 * re-run of the same aggregate rather than four functions that will
 * eventually disagree with each other about what a "session" is.
 *
 * Rates are guarded everywhere: an empty bucket has no accuracy, no success
 * rate and no p90, and each of those renders as an em-dash. Zero would be a
 * claim about performance that nobody measured.
 */

const DIMENSIONS = [
  { value: 'language', label: 'Language' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'mode', label: 'Mode' },
  { value: 'kind', label: 'Kind' },
];

const num = (v) => (v == null ? null : Number(v));

export default function PerformanceView() {
  const { range, nonce } = useConsole();
  const { isDark } = useTheme();
  const [dim, setDim] = useState('language');
  const [compare, setCompare] = useState([]);

  const typing = useConsoleQuery(
    () => fetchTypingAnalytics(range.from, range.to, dim),
    [range.from.getTime(), range.to.getTime(), dim, nonce],
  );
  const coding = useConsoleQuery(
    () => fetchCodingAnalytics(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const series = useConsoleQuery(
    () => fetchTimeseries(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const kpis = useConsoleQuery(
    () => fetchKpis(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );

  const buckets = typing.data ?? [];
  const codeRows = coding.data ?? [];
  const k = kpis.data ?? {};
  const tokens = chartTokens(isDark);

  const totals = useMemo(() => {
    let sessions = 0;
    let seconds = 0;
    let errors = 0;
    let p90 = null;
    for (const b of buckets) {
      sessions += Number(b.sessions) || 0;
      seconds += Number(b.seconds) || 0;
      errors += Number(b.errors) || 0;
      const bp = num(b.p90_wpm);
      if (bp != null && (p90 == null || bp > p90)) p90 = bp;
    }
    return { sessions, seconds, errors, p90 };
  }, [buckets]);

  const codeTotals = useMemo(() => {
    let attempts = 0;
    let solved = 0;
    const solvers = new Set();
    for (const r of codeRows) {
      attempts += Number(r.attempts) || 0;
      solved += Number(r.solved) || 0;
      solvers.add(r.language);
    }
    return {
      attempts,
      solved,
      // No attempts means no success rate. Not 0%.
      rate: attempts ? (solved / attempts) * 100 : null,
      languages: codeRows.length,
      solvers: codeRows.reduce((a, r) => a + (Number(r.solvers) || 0), 0),
    };
  }, [codeRows]);

  const trend = useMemo(
    () =>
      (series.data ?? []).map((r) => ({
        label: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        wpm: Number(r.avg_wpm) || 0,
        accuracy: Number(r.avg_accuracy) || 0,
      })),
    [series.data],
  );

  const toggleCompare = (bucket) =>
    setCompare((c) => (c.includes(bucket) ? c.filter((b) => b !== bucket) : c.length >= 4 ? c : [...c, bucket]));

  const compared = useMemo(() => buckets.filter((b) => compare.includes(b.bucket)), [buckets, compare]);

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Performance"
        description="How people actually type and code here, grouped by whichever axis you need."
      />

      <MetricRack cols={5}>
        <MetricTile
          icon={Gauge}
          label="Average WPM"
          value={k.avg_wpm}
          decimals={1}
          loading={kpis.status === 'loading'}
          source={`sessions · ${range.days}d`}
        />
        <MetricTile
          icon={Crosshair}
          label="Average accuracy"
          value={k.avg_accuracy}
          suffix="%"
          decimals={2}
          source="sessions.accuracy"
        />
        <MetricTile icon={Timer} label="Peak p90 WPM" value={totals.p90} decimals={1} source="admin_typing_analytics" />
        <MetricTile
          icon={Type}
          label="Sessions"
          value={totals.sessions}
          hint={`${k.typing_sessions ?? 0} typing · ${k.coding_sessions ?? 0} coding`}
          source="sessions"
        />
        <MetricTile
          icon={Users}
          label="Time practised"
          value={totals.seconds ? humanDuration(totals.seconds) : null}
          hint={totals.errors ? `${totals.errors.toLocaleString()} errors typed` : null}
          source="sessions.duration_sec"
        />
      </MetricRack>

      <Panel
        title="Typing"
        hint="Every typed session in the window, grouped by the selected axis"
        source={`admin_typing_analytics · ${dim} · ${range.days}d`}
        refreshing={typing.isRefreshing}
        action={<Segmented options={DIMENSIONS} value={dim} onChange={setDim} label="Grouping axis" />}
      >
        <StateBlock
          status={typing.status}
          error={typing.error}
          empty={buckets.length === 0}
          emptyIcon={Type}
          emptyTitle="No typed sessions in this window"
          emptyDescription="Widen the range, or wait for the first session to land."
          onRetry={typing.reload}
        >
          <ConsoleTable
            columns={[
              {
                key: 'bucket',
                label: DIMENSIONS.find((d) => d.value === dim)?.label ?? 'Bucket',
                render: (b) => (
                  <label className="flex cursor-pointer items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={compare.includes(b.bucket)}
                      onChange={() => toggleCompare(b.bucket)}
                      disabled={!compare.includes(b.bucket) && compare.length >= 4}
                      aria-label={`Compare ${b.bucket}`}
                      className="h-[13px] w-[13px] accent-[rgb(var(--brand-solid))]"
                    />
                    <span className="font-semibold">{b.bucket}</span>
                  </label>
                ),
              },
              { key: 'sessions', label: 'Sessions', align: 'right', mono: true },
              { key: 'users', label: 'Users', align: 'right', mono: true },
              { key: 'avg_wpm', label: 'Avg WPM', align: 'right', mono: true },
              { key: 'p90_wpm', label: 'p90 WPM', align: 'right', mono: true },
              {
                key: 'avg_accuracy',
                label: 'Accuracy',
                align: 'right',
                mono: true,
                render: (b) => (b.avg_accuracy == null ? '—' : `${b.avg_accuracy}%`),
              },
              {
                key: 'avg_consistency',
                label: 'Consistency',
                align: 'right',
                mono: true,
                render: (b) => (b.avg_consistency ? b.avg_consistency : <span className="text-ink-3">—</span>),
              },
              { key: 'errors', label: 'Errors', align: 'right', mono: true },
              {
                key: 'seconds',
                label: 'Time',
                align: 'right',
                mono: true,
                render: (b) => humanDuration(b.seconds ?? 0),
              },
            ]}
            rows={buckets}
            rowKey={(b) => b.bucket}
            defaultSort={{ key: 'sessions', dir: 'desc' }}
            csvName={`typeforge-typing-${dim}`}
            paginate={false}
            minWidth={900}
          />
        </StateBlock>
      </Panel>

      {compared.length >= 2 ? (
        <Panel
          title="Comparison"
          hint={`${compared.length} buckets side by side`}
          source="admin_typing_analytics · selected rows"
          action={
            <button
              onClick={() => setCompare([])}
              className="text-xs font-semibold text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              Clear
            </button>
          }
        >
          <ComparisonBars rows={compared} palette={tokens.series} />
        </Panel>
      ) : (
        <p className="px-0.5 text-xs text-ink-3">
          Tick two to four rows above to compare them across WPM, accuracy, consistency and errors.
        </p>
      )}

      <Panel
        title="Trend"
        hint="Daily mean WPM and accuracy across all typed sessions"
        source={`admin_timeseries · ${range.days}d`}
      >
        <StateBlock
          status={series.status}
          error={series.error}
          empty={trend.length === 0}
          emptyTitle="No trend data in this window"
          emptyDescription="One point is written per day with at least one session."
          onRetry={series.reload}
        >
          <div className="grid gap-2 lg:grid-cols-2">
            <ChartFrame
              title="Average WPM"
              height={200}
              table={<DataTable columns={['Day', 'WPM']} rows={trend.map((t) => [t.label, t.wpm])} />}
            >
              <TrendLine data={trend} dataKey="wpm" label="WPM" />
            </ChartFrame>
            <ChartFrame
              title="Average accuracy"
              height={200}
              table={<DataTable columns={['Day', 'Accuracy']} rows={trend.map((t) => [t.label, `${t.accuracy}%`])} />}
            >
              <TrendLine data={trend} dataKey="accuracy" label="Accuracy" unit="%" color={tokens.series?.[1]} />
            </ChartFrame>
          </div>
        </StateBlock>
      </Panel>

      <Panel
        title="Coding"
        hint="Problem attempts and solve rates per language"
        source={`admin_coding_analytics · ${range.days}d`}
        refreshing={coding.isRefreshing}
      >
        <div className="space-y-1.5">
          <MetricRack cols={4}>
            <MetricTile icon={Braces} label="Attempts" value={codeTotals.attempts} source="problem_progress" />
            <MetricTile icon={CheckCheck} label="Solved" value={codeTotals.solved} source="status = solved" />
            <MetricTile
              icon={Gauge}
              label="Success rate"
              value={codeTotals.rate}
              suffix="%"
              decimals={1}
              unavailable={codeTotals.rate == null ? 'no attempts' : null}
              source="solved / attempts"
            />
            <MetricTile icon={Users} label="Languages touched" value={codeTotals.languages} source="distinct language" />
          </MetricRack>

          <StateBlock
            status={coding.status}
            error={coding.error}
            empty={codeRows.length === 0}
            emptyIcon={Braces}
            emptyTitle="No coding activity in this window"
            emptyDescription="Attempts are recorded when someone opens a code problem."
            onRetry={coding.reload}
          >
            <ConsoleTable
              columns={[
                { key: 'language', label: 'Language', render: (r) => <span className="font-semibold">{r.language}</span> },
                { key: 'attempts', label: 'Attempts', align: 'right', mono: true },
                { key: 'solved', label: 'Solved', align: 'right', mono: true },
                { key: 'solvers', label: 'Solvers', align: 'right', mono: true },
                {
                  key: 'success_rate',
                  label: 'Success',
                  width: '18%',
                  render: (r) =>
                    r.attempts ? (
                      <span className="flex items-center gap-1">
                        <ProgressBar
                          value={(Number(r.success_rate) || 0) / 100}
                          tone={Number(r.success_rate) > 60 ? 'good' : 'warn'}
                          className="max-w-[90px]"
                          label={`${r.language} success rate`}
                        />
                        <span className="font-mono text-xs tnum">{r.success_rate}%</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    ),
                },
                { key: 'avg_attempts', label: 'Avg tries', align: 'right', mono: true },
                { key: 'sessions', label: 'Sessions', align: 'right', mono: true },
                {
                  key: 'avg_wpm',
                  label: 'Avg WPM',
                  align: 'right',
                  mono: true,
                  render: (r) => (r.sessions ? r.avg_wpm : <span className="text-ink-3">—</span>),
                },
              ]}
              rows={codeRows}
              rowKey={(r) => r.language}
              defaultSort={{ key: 'attempts', dir: 'desc' }}
              csvName="typeforge-coding"
              paginate={false}
              minWidth={820}
            />
          </StateBlock>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Grouped comparison.
 *
 * Bars rather than a radar: the four measures have different units and wildly
 * different ranges, so a shared radial axis would be a lie. Each measure gets
 * its own row normalised against the largest value in that row, with the real
 * number printed beside it — the bar carries the comparison, the numeral
 * carries the value.
 */
function ComparisonBars({ rows, palette = [] }) {
  const MEASURES = [
    { key: 'avg_wpm', label: 'Average WPM', fmt: (v) => v },
    { key: 'p90_wpm', label: 'p90 WPM', fmt: (v) => v },
    { key: 'avg_accuracy', label: 'Accuracy', fmt: (v) => `${v}%` },
    { key: 'avg_consistency', label: 'Consistency', fmt: (v) => v },
    { key: 'errors', label: 'Errors typed', fmt: (v) => Number(v).toLocaleString() },
  ];

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {rows.map((r, i) => (
          <li key={r.bucket} className="flex items-center gap-0.5 text-xs font-semibold">
            <span
              aria-hidden
              className="h-0.5 w-1.5 rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
            {r.bucket}
          </li>
        ))}
      </ul>

      {MEASURES.map((m) => {
        const values = rows.map((r) => Number(r[m.key]) || 0);
        const max = Math.max(...values, 1);
        return (
          <div key={m.key}>
            <p className="mb-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{m.label}</p>
            <ul className="space-y-0.5">
              {rows.map((r, i) => {
                const v = Number(r[m.key]);
                return (
                  <li key={r.bucket} className="flex items-center gap-1">
                    <span className="w-[110px] shrink-0 truncate text-xs text-ink-2">{r.bucket}</span>
                    <span className="h-[8px] flex-1 overflow-hidden rounded-full bg-line">
                      <span
                        className="block h-full origin-left rounded-full transition-transform duration-slow ease-out"
                        style={{
                          transform: `scaleX(${Number.isFinite(v) ? v / max : 0})`,
                          background: palette[i % palette.length],
                        }}
                      />
                    </span>
                    <span className={cx('w-[70px] shrink-0 text-right font-mono text-xs tnum', !Number.isFinite(v) && 'text-ink-3')}>
                      {Number.isFinite(v) ? m.fmt(v) : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
