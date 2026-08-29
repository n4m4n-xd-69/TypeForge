import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Bot, CircleDollarSign, Clock3, Cpu, Flame,
  Gauge, Swords, TrendingUp, UserPlus, Users,
} from 'lucide-react';
import { cx, humanDuration } from '../../../lib/format.js';
import ChartFrame, { DataTable } from '../../../components/charts/ChartFrame.jsx';
import { TrendLine } from '../../../components/charts/Charts.jsx';
import { ProgressBar } from '../../../components/ui/Primitives.jsx';
import {
  LiveRail, MetricRack, MetricTile, Panel, StateBlock, ViewHeader,
  useConsole, useConsoleQuery, usePolling,
} from '../kit/index.js';
import { fetchActivityFeed, fetchAnomalies, fetchKpis, fetchModelHealth, fetchTimeseries } from '../api/console.js';

/**
 * Executive overview — the console's front page.
 *
 * The layout is the argument: a rack of instruments and a chart on the left,
 * the live pulse pinned down the right. An operator opening this at 3am is
 * asking two questions in order — "is anything wrong" and "what is happening
 * right now" — and the split answers them in that order without a scroll.
 *
 * Every tile is a button that lands on the module which explains it. A metric
 * that cannot be interrogated is a poster, and the brief asked for a console.
 */

const DAY = 86_400_000;

export default function OverviewView() {
  const navigate = useNavigate();
  const { range, nonce, refresh } = useConsole();

  const kpis = useConsoleQuery(
    () => fetchKpis(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const series = useConsoleQuery(
    () => fetchTimeseries(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const feed = useConsoleQuery(() => fetchActivityFeed(60), [nonce]);
  const health = useConsoleQuery(() => fetchModelHealth(), [nonce]);
  const anomalies = useConsoleQuery(
    () => fetchAnomalies(new Date(Date.now() - 7 * DAY), new Date()),
    [nonce],
  );

  /* The pulse is the only thing on this page that must be current to the
     second; everything else is a window aggregate and re-reading it every ten
     seconds would be noise plus load. */
  usePolling(feed.reload, 10_000);
  usePolling(kpis.reload, 60_000);

  const k = kpis.data ?? {};
  const rows = series.data ?? [];

  const spark = useCallback((key) => rows.map((r) => Number(r[key]) || 0), [rows]);

  /* Period-over-period, against the immediately preceding window of equal
     length — which is what admin_kpis computes. A delta with an unnamed
     comparison window is not information, so `deltaLabel` always names it. */
  const pct = (now, prev) => {
    if (prev == null || prev === 0) return null;
    return ((Number(now) - Number(prev)) / Number(prev)) * 100;
  };
  const vsPrev = `vs prev ${range.days}d`;

  const failureRate = k.ai_calls ? (k.ai_failures / k.ai_calls) * 100 : null;

  const openBreakers = useMemo(
    () => (health.data ?? []).filter((h) => h.open_until && new Date(h.open_until) > new Date()),
    [health.data],
  );

  const trend = useMemo(
    () =>
      rows.map((r) => ({
        label: new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        active: Number(r.dau) || 0,
        sessions: Number(r.sessions) || 0,
      })),
    [rows],
  );

  const loading = kpis.status === 'loading' && !kpis.data;

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Overview"
        description={`Platform state across the last ${range.label.toLowerCase()}. Every tile opens the module behind it.`}
      />

      <MetricRack cols={6}>
        {/* Registered accounts only. Guests are real auth.users rows created
            by anonymous sign-in, and folding them in would report session
            churn as growth. */}
        <MetricTile
          icon={Users}
          label="Users"
          value={k.total_users}
          loading={loading}
          hint={
            k.guest_users
              ? `+${Number(k.guest_users).toLocaleString()} guest sessions`
              : k.suspended
                ? `${k.suspended} suspended`
                : 'all active'
          }
          source="admin_kpis · registered"
          onClick={() => navigate('/admin/users')}
        />
        <MetricTile
          icon={Activity}
          label="Active"
          value={k.active_users}
          delta={pct(k.active_users, k.prev_active_users)}
          deltaLabel={`% ${vsPrev}`}
          spark={spark('dau')}
          loading={loading}
          source="sessions · distinct"
          onClick={() => navigate('/admin/reports')}
        />
        <MetricTile
          icon={UserPlus}
          label="New"
          value={k.new_users}
          delta={pct(k.new_users, k.prev_new_users)}
          deltaLabel={`% ${vsPrev}`}
          spark={spark('new_users')}
          loading={loading}
          source="profiles.created_at"
          onClick={() => navigate('/admin/users')}
        />
        <MetricTile
          icon={Clock3}
          label="Practice time"
          value={k.seconds != null ? humanDuration(k.seconds) : null}
          hint={k.sessions ? `${Number(k.sessions).toLocaleString()} sessions` : null}
          spark={spark('seconds')}
          loading={loading}
          source="sessions.duration_sec"
          onClick={() => navigate('/admin/performance')}
        />
        <MetricTile
          icon={Flame}
          label="XP generated"
          value={k.xp_earned}
          hint={k.xp_granted ? `${Number(k.xp_granted).toLocaleString()} granted manually` : 'no manual grants'}
          spark={spark('xp')}
          loading={loading}
          source="sessions.xp"
          onClick={() => navigate('/admin/reports')}
        />
        <MetricTile
          icon={Bot}
          label="AI calls"
          value={k.ai_calls}
          delta={failureRate}
          deltaLabel="% failed"
          invert
          spark={spark('ai_calls')}
          loading={loading}
          source="ai_usage"
          onClick={() => navigate('/admin/ai')}
        />
      </MetricRack>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          <Panel
            title="Activity"
            hint="Distinct users and sessions per day"
            source={`admin_timeseries · ${range.days}d`}
            refreshing={series.isRefreshing}
          >
            <StateBlock
              status={series.status}
              error={series.error}
              empty={rows.length === 0}
              emptyTitle="No activity in this window"
              emptyDescription="Widen the range, or wait for the first session to land."
              onRetry={series.reload}
              rows={5}
            >
              <ChartFrame
                title="Daily active users"
                hint="One point per day; gaps are real zeroes, not missing data"
                height={240}
                table={
                  <DataTable
                    columns={['Day', 'Active', 'Sessions']}
                    rows={trend.map((t) => [t.label, t.active, t.sessions])}
                  />
                }
              >
                <TrendLine data={trend} dataKey="active" label="Active users" />
              </ChartFrame>
            </StateBlock>
          </Panel>

          <div className="grid gap-2 sm:grid-cols-2">
            <Panel
              title="Platform health"
              source="ai_usage + forge_model_health · 60s"
              refreshing={kpis.isRefreshing}
            >
              <dl className="space-y-1.5">
                <HealthRow
                  label="AI failure rate"
                  value={failureRate == null ? null : `${failureRate.toFixed(1)}%`}
                  ratio={failureRate == null ? null : Math.min(1, failureRate / 20)}
                  tone={failureRate == null ? 'ink' : failureRate > 10 ? 'warn' : 'good'}
                  detail={k.ai_calls ? `${k.ai_failures} of ${Number(k.ai_calls).toLocaleString()} calls` : 'no calls in range'}
                />
                <HealthRow
                  label="AI latency p95"
                  value={k.ai_p95_ms != null ? `${Number(k.ai_p95_ms).toLocaleString()} ms` : null}
                  ratio={k.ai_p95_ms != null ? Math.min(1, Number(k.ai_p95_ms) / 20000) : null}
                  tone={Number(k.ai_p95_ms) > 10000 ? 'warn' : 'accent'}
                  detail={k.ai_p50_ms != null ? `p50 ${Number(k.ai_p50_ms).toLocaleString()} ms` : null}
                />
                <HealthRow
                  label="Open circuit breakers"
                  value={health.status === 'ready' ? String(openBreakers.length) : null}
                  ratio={openBreakers.length ? 1 : 0}
                  tone={openBreakers.length ? 'warn' : 'good'}
                  detail={
                    openBreakers.length
                      ? openBreakers.map((b) => b.model).join(', ')
                      : 'every model is answering'
                  }
                />
                <HealthRow
                  label="Matchmaking queue"
                  value={k.queue_depth != null ? String(k.queue_depth) : null}
                  ratio={k.queue_depth != null ? Math.min(1, k.queue_depth / 20) : null}
                  tone="accent"
                  detail={`${(k.live_battle_rooms ?? 0) + (k.live_shadow_rooms ?? 0)} rooms live now`}
                />
              </dl>
            </Panel>

            <Panel
              title="Needs a look"
              hint="Signals for review — not verdicts"
              source="admin_anomalies · 7d"
              action={
                <button
                  onClick={() => navigate('/admin/arena')}
                  className="text-xs font-semibold text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                >
                  Open Arena
                </button>
              }
            >
              <StateBlock
                status={anomalies.status}
                error={anomalies.error}
                empty={(anomalies.data ?? []).length === 0}
                emptyIcon={Gauge}
                emptyTitle="Nothing flagged this week"
                emptyDescription="Implausible results, client/server divergence and session floods would appear here."
                onRetry={anomalies.reload}
                rows={3}
              >
                <ul className="space-y-1">
                  {(anomalies.data ?? []).slice(0, 6).map((a, i) => (
                    <li key={`${a.user_id}-${a.signal}-${i}`} className="flex items-start gap-1">
                      <AlertTriangle
                        size={13}
                        className={cx('mt-px shrink-0', a.severity === 'high' ? 'text-bad' : 'text-warn')}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {a.display_name || 'Unknown user'}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-ink-3">{a.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </StateBlock>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <MetricTile
              icon={Swords}
              label="Matches played"
              value={(k.battle_finishes ?? 0) + (k.shadow_results ?? 0)}
              hint={`${k.shadow_results ?? 0} shadow · ${k.battle_finishes ?? 0} battle`}
              spark={spark('matches')}
              loading={loading}
              source="battle_results + shadow_results"
              onClick={() => navigate('/admin/arena')}
            />
            <MetricTile
              icon={TrendingUp}
              label="Median WPM"
              value={k.avg_wpm}
              decimals={1}
              hint={k.avg_accuracy != null ? `${Number(k.avg_accuracy).toFixed(1)}% accuracy` : null}
              spark={spark('avg_wpm')}
              loading={loading}
              source="sessions · mean"
              onClick={() => navigate('/admin/performance')}
            />
            {/* Not a zero, and not an estimate. TypeForge has no billing
                system, so admin_kpis returns SQL NULL here and the tile says
                exactly that rather than implying a quiet month. */}
            <MetricTile
              icon={CircleDollarSign}
              label="Revenue"
              value={k.revenue}
              unavailable="not instrumented"
              hint="No billing system is connected"
              source="admin_kpis.revenue"
              onClick={() => navigate('/admin/reports')}
            />
          </div>
        </div>

        {/* The signature. Sticky and full-height so the feed stays visible
            while the left column scrolls — an operator watching the platform
            should not have to choose between the pulse and the numbers. */}
        <aside className="lg:sticky lg:top-[132px] lg:h-[calc(100dvh-160px)]">
          <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-lg border border-line bg-surface">
            <LiveRail
              events={feed.data ?? []}
              loading={feed.status === 'loading' && !feed.data}
              onSelectUser={() => navigate('/admin/users')}
            />
          </div>
        </aside>
      </div>

      <p className="flex items-center gap-0.5 pt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
        <Cpu size={11} aria-hidden />
        Window {range.from.toLocaleDateString()} → {range.to.toLocaleDateString()} · deltas compare the preceding {range.days} days
        <button onClick={refresh} className="ml-1 underline underline-offset-2 hover:text-ink">
          refresh
        </button>
      </p>
    </div>
  );
}

function HealthRow({ label, value, detail, ratio, tone = 'accent' }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1">
        <dt className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{label}</dt>
        <dd className={cx('font-mono text-sm font-semibold tnum', value == null && 'text-ink-3')}>
          {value ?? '—'}
        </dd>
      </div>
      {ratio != null ? <ProgressBar value={ratio} tone={tone === 'ink' ? 'ink' : tone} className="mt-0.5" label={label} /> : null}
      {detail ? <p className="mt-px truncate text-[11px] text-ink-3">{detail}</p> : null}
    </div>
  );
}
