import { useMemo } from 'react';
import { CircleDollarSign, Download, Flame, Users } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { useTheme } from '../../../lib/theme.jsx';
import ChartFrame, { DataTable } from '../../../components/charts/ChartFrame.jsx';
import { TrendLine } from '../../../components/charts/Charts.jsx';
import { chartTokens } from '../../../components/charts/palette.js';
import {
  MetricRack, MetricTile, Panel, StateBlock, ViewHeader,
  useConsole, useConsoleQuery,
} from '../kit/index.js';
import { fetchKpis, fetchRetention, fetchTimeseries } from '../api/console.js';

/**
 * Analytics and reporting.
 *
 * Two honesty constraints shape this module, and both are visible in the UI
 * rather than buried here:
 *
 * 1. **WAU and MAU are approximations.** `admin_timeseries` returns distinct
 *    users *per day*; summing seven of those counts a person once per day they
 *    appeared, not once for the week. A true rolling distinct-user set needs a
 *    different query shape. The panel says so, because a number labelled "WAU"
 *    that is not WAU will end up in a board deck.
 *
 * 2. **Earned and granted XP never merge.** Granted XP is an operator
 *    correcting a bug or compensating a user; folding it into the economy
 *    chart would make the platform look like it is rewarding activity it never
 *    saw.
 */

const DAY_MS = 86_400_000;

function downloadCsv(name, columns, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsView() {
  const { range, nonce } = useConsole();
  const { isDark } = useTheme();
  const tokens = chartTokens(isDark);

  const series = useConsoleQuery(
    () => fetchTimeseries(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const kpis = useConsoleQuery(
    () => fetchKpis(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const retention = useConsoleQuery(() => fetchRetention(12), [nonce]);

  const rows = series.data ?? [];
  const k = kpis.data ?? {};

  /* Rolling sums over the per-day distinct counts. See the file header — this
     is a proxy, and the panel that renders it says so. */
  const engagement = useMemo(() => {
    return rows.map((r, i) => {
      const window = (n) => rows.slice(Math.max(0, i - n + 1), i + 1).reduce((a, x) => a + (Number(x.dau) || 0), 0);
      return {
        label: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        dau: Number(r.dau) || 0,
        wau: window(7),
        mau: window(30),
      };
    });
  }, [rows]);

  const latest = engagement[engagement.length - 1] ?? {};
  const stickiness = latest.mau ? (latest.dau / latest.mau) * 100 : null;

  const cohorts = useMemo(() => {
    const map = new Map();
    let maxWeek = 0;
    for (const r of retention.data ?? []) {
      const key = String(r.cohort).slice(0, 10);
      if (!map.has(key)) map.set(key, { cohort: key, size: Number(r.cohort_size) || 0, weeks: {} });
      map.get(key).weeks[r.week_offset] = Number(r.retained) || 0;
      if (r.week_offset > maxWeek) maxWeek = r.week_offset;
    }
    return { rows: [...map.values()].sort((a, b) => (a.cohort < b.cohort ? 1 : -1)), maxWeek: Math.min(maxWeek, 11) };
  }, [retention.data]);

  const xpSeries = useMemo(
    () =>
      rows.map((r) => ({
        label: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        xp: Number(r.xp) || 0,
      })),
    [rows],
  );

  const aiSeries = useMemo(
    () =>
      rows.map((r) => ({
        label: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        calls: Number(r.ai_calls) || 0,
        tokens: Number(r.ai_tokens) || 0,
        failures: Number(r.ai_failures) || 0,
      })),
    [rows],
  );

  const matchSeries = useMemo(
    () =>
      rows.map((r) => ({
        label: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        matches: Number(r.matches) || 0,
      })),
    [rows],
  );

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Reports"
        description={`Retention, engagement and the XP economy over ${range.from.toLocaleDateString()} → ${range.to.toLocaleDateString()}.`}
      />

      <MetricRack cols={5}>
        <MetricTile icon={Users} label="DAU (latest day)" value={latest.dau} source="admin_timeseries.dau" />
        <MetricTile
          icon={Users}
          label="WAU (approx)"
          value={latest.wau}
          hint="Sum of 7 daily counts, not a distinct set"
          source="rolling 7d"
        />
        <MetricTile
          icon={Users}
          label="Stickiness"
          value={stickiness}
          suffix="%"
          decimals={1}
          unavailable={stickiness == null ? 'needs 30 days' : null}
          hint="DAU ÷ MAU proxy"
          source="derived"
        />
        <MetricTile icon={Flame} label="XP earned" value={k.xp_earned} source="sessions.xp" />
        <MetricTile
          icon={Flame}
          label="XP granted"
          value={k.xp_granted}
          hint="Manual operator adjustments"
          source="xp_adjustments"
        />
      </MetricRack>

      <Panel
        title="Retention"
        hint="Weekly signup cohorts. A cell is the share of that cohort with at least one session in that week."
        source="admin_retention · 12 weeks"
        refreshing={retention.isRefreshing}
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(
                'typeforge-retention',
                ['cohort', 'size', 'week', 'retained', 'percent'],
                (retention.data ?? []).map((r) => [
                  String(r.cohort).slice(0, 10),
                  r.cohort_size,
                  r.week_offset,
                  r.retained,
                  r.cohort_size ? Math.round((r.retained / r.cohort_size) * 100) : '',
                ]),
              )
            }
          />
        }
      >
        <StateBlock
          status={retention.status}
          error={retention.error}
          empty={cohorts.rows.length === 0}
          emptyTitle="Not enough history for cohorts"
          emptyDescription="A cohort appears once a week's signups have had a chance to return."
          onRetry={retention.reload}
        >
          <RetentionGrid cohorts={cohorts} heat={tokens.heat} />
        </StateBlock>
      </Panel>

      <div className="grid gap-2 lg:grid-cols-2">
        <Panel
          title="Engagement"
          hint="WAU and MAU are rolling sums of daily distinct-user counts — a proxy, not a true distinct set over the window."
          source="admin_timeseries · derived"
          action={
            <ExportButton
              onClick={() =>
                downloadCsv(
                  'typeforge-engagement',
                  ['day', 'dau', 'wau_approx', 'mau_approx'],
                  engagement.map((e) => [e.label, e.dau, e.wau, e.mau]),
                )
              }
            />
          }
        >
          <StateBlock
            status={series.status}
            error={series.error}
            empty={engagement.length === 0}
            emptyTitle="No engagement data"
            emptyDescription="Widen the window, or wait for the first session."
            onRetry={series.reload}
          >
            <ChartFrame
              title="Daily active users"
              series={[{ name: 'DAU', color: tokens.series?.[0] }]}
              height={220}
              table={
                <DataTable
                  columns={['Day', 'DAU', 'WAU approx', 'MAU approx']}
                  rows={engagement.map((e) => [e.label, e.dau, e.wau, e.mau])}
                />
              }
            >
              <TrendLine data={engagement} dataKey="dau" label="DAU" />
            </ChartFrame>
          </StateBlock>
        </Panel>

        <Panel
          title="XP economy"
          hint="Earned XP only. Manual grants are counted separately above so the curve reflects real activity."
          source="admin_timeseries.xp"
          action={
            <ExportButton
              onClick={() => downloadCsv('typeforge-xp', ['day', 'xp_earned'], xpSeries.map((x) => [x.label, x.xp]))}
            />
          }
        >
          <StateBlock
            status={series.status}
            error={series.error}
            empty={xpSeries.length === 0}
            emptyTitle="No XP recorded"
            onRetry={series.reload}
          >
            <ChartFrame
              title="XP earned per day"
              height={220}
              table={<DataTable columns={['Day', 'XP']} rows={xpSeries.map((x) => [x.label, x.xp])} />}
            >
              <TrendLine data={xpSeries} dataKey="xp" label="XP" color={tokens.series?.[3]} />
            </ChartFrame>
          </StateBlock>
        </Panel>

        <Panel
          title="AI usage"
          source="admin_timeseries · ai_usage"
          action={
            <ExportButton
              onClick={() =>
                downloadCsv(
                  'typeforge-ai-usage',
                  ['day', 'calls', 'tokens', 'failures'],
                  aiSeries.map((a) => [a.label, a.calls, a.tokens, a.failures]),
                )
              }
            />
          }
        >
          <StateBlock status={series.status} error={series.error} empty={aiSeries.length === 0} emptyTitle="No AI calls" onRetry={series.reload}>
            <ChartFrame
              title="Calls per day"
              hint={`${Number(k.ai_tokens ?? 0).toLocaleString()} tokens over the window`}
              height={220}
              table={
                <DataTable
                  columns={['Day', 'Calls', 'Tokens', 'Failures']}
                  rows={aiSeries.map((a) => [a.label, a.calls, a.tokens, a.failures])}
                />
              }
            >
              <TrendLine data={aiSeries} dataKey="calls" label="Calls" color={tokens.series?.[1]} />
            </ChartFrame>
          </StateBlock>
        </Panel>

        <Panel
          title="Games"
          source="admin_timeseries.matches"
          action={
            <ExportButton
              onClick={() => downloadCsv('typeforge-matches-daily', ['day', 'matches'], matchSeries.map((m) => [m.label, m.matches]))}
            />
          }
        >
          <StateBlock status={series.status} error={series.error} empty={matchSeries.length === 0} emptyTitle="No matches" onRetry={series.reload}>
            <ChartFrame
              title="Matches settled per day"
              hint={`${((k.battle_finishes ?? 0) + (k.shadow_results ?? 0)).toLocaleString()} over the window`}
              height={220}
              table={<DataTable columns={['Day', 'Matches']} rows={matchSeries.map((m) => [m.label, m.matches])} />}
            >
              <TrendLine data={matchSeries} dataKey="matches" label="Matches" color={tokens.series?.[2]} />
            </ChartFrame>
          </StateBlock>
        </Panel>
      </div>

      {/* An empty panel would be a lie of omission — the brief asked for
          revenue, so the console says exactly why there is none rather than
          quietly leaving it out. */}
      <Panel title="Revenue" source="admin_kpis.revenue · NULL">
        <div className="flex flex-wrap items-start gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-raised text-ink-3">
            <CircleDollarSign size={22} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Not instrumented</p>
            <p className="mt-0.5 max-w-[64ch] text-sm text-ink-3">
              TypeForge has no billing system, so there is no revenue figure to report and this panel will not invent
              one. Instrumenting it needs three things that do not exist yet: a payments provider, a subscriptions or
              entitlements table keyed to <code className="font-mono">auth.users</code>, and a webhook that records
              charges. Once those land, <code className="font-mono">admin_kpis</code> can return a real number here
              instead of SQL <code className="font-mono">NULL</code>.
            </p>
            <p className="mt-1 text-sm text-ink-3">
              What <em>is</em> measured today is usage: {Number(k.ai_calls ?? 0).toLocaleString()} AI calls and{' '}
              {Number(k.ai_tokens ?? 0).toLocaleString()} tokens over this window. Per-model cost estimates are on the
              AI Control module.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-[28px] items-center gap-0.5 rounded-xs border border-line px-1 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
    >
      <Download size={12} aria-hidden />
      CSV
    </button>
  );
}

/**
 * The retention triangle.
 *
 * Intensity comes from the app's validated single-hue heat ramp rather than an
 * invented gradient — it is the same scale the practice heatmap uses, and it
 * has been checked for monotone lightness in both themes. A week with no data
 * is blank, not 0%: a cohort that has not yet reached week 6 has not churned.
 */
function RetentionGrid({ cohorts, heat }) {
  const weeks = Array.from({ length: cohorts.maxWeek + 1 }, (_, i) => i);

  const cellStyle = (ratio) => {
    if (ratio == null) return { background: 'transparent' };
    const steps = heat?.steps ?? [];
    if (!steps.length) return { background: 'transparent' };
    const idx = Math.min(steps.length - 1, Math.floor(ratio * steps.length));
    return { background: ratio === 0 ? heat.empty : steps[idx] };
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-1 py-1 text-left text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
              Cohort
            </th>
            <th scope="col" className="px-1 py-1 text-right text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
              Size
            </th>
            {weeks.map((w) => (
              <th
                key={w}
                scope="col"
                className="px-0.5 py-1 text-center font-mono text-2xs font-bold text-ink-3"
                style={{ minWidth: 44 }}
              >
                W{w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.rows.map((c) => (
            <tr key={c.cohort}>
              <th scope="row" className="whitespace-nowrap px-1 py-0.5 text-left font-mono text-xs font-semibold">
                {c.cohort}
              </th>
              <td className="px-1 py-0.5 text-right font-mono text-xs tnum text-ink-3">{c.size}</td>
              {weeks.map((w) => {
                const retained = c.weeks[w];
                const ratio = retained == null || !c.size ? null : retained / c.size;
                return (
                  <td key={w} className="p-px">
                    <span
                      title={
                        ratio == null
                          ? 'No data for this week yet'
                          : `${retained} of ${c.size} returned in week ${w}`
                      }
                      style={cellStyle(ratio)}
                      className={cx(
                        'grid h-[26px] place-items-center rounded-xs font-mono text-2xs tnum',
                        ratio == null ? 'border border-dashed border-line text-ink-3' : 'text-[rgb(var(--bg))]',
                        ratio != null && ratio < 0.25 && 'text-ink',
                      )}
                    >
                      {ratio == null ? '' : `${Math.round(ratio * 100)}`}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 font-mono text-[10px] text-ink-3">
        Values are percentages. Week 0 is the signup week itself, so it is normally 100 for anyone who typed at all.
      </p>
    </div>
  );
}
