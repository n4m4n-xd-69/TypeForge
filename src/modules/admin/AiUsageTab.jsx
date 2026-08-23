import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card, Chip, EmptyState, SectionTitle } from '../../components/ui/Primitives.jsx';
import ChartFrame, { DataTable } from '../../components/charts/ChartFrame.jsx';
import { TrendLine } from '../../components/charts/Charts.jsx';
import { AI_REASON_COPY } from '../../lib/ai-runner.js';
import { fetchAiUsage, fetchOverview } from './adminApi.js';
import { estimateCost, summarizeSpend } from './costs.js';
import PanelSkeleton from './PanelSkeleton.jsx';

export default function AiUsageTab() {
  const [state, setState] = useState({ status: 'loading', rows: [], users: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAiUsage({ limit: 1000 }), fetchOverview()])
      .then(([rows, users]) => {
        if (!cancelled) setState({ status: 'ready', rows, users });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', rows: [], users: [], error: err });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const { rows, users } = state;
    const byDay = new Map();
    const bySurface = new Map();
    const byModel = new Map();
    const byReason = new Map();
    const byUser = new Map();
    const userLabel = new Map(users.map((u) => [u.id, u.display_name || u.email || u.id.slice(0, 8)]));

    let ok = 0;
    for (const r of rows) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);

      const s = bySurface.get(r.surface) ?? { calls: 0, tokens: 0 };
      s.calls += 1;
      s.tokens += (r.prompt_tokens ?? 0) + (r.output_tokens ?? 0);
      bySurface.set(r.surface, s);

      const key = `${r.provider} / ${r.model}`;
      const m = byModel.get(key) ?? { calls: 0, tokens: 0 };
      m.calls += 1;
      m.tokens += (r.prompt_tokens ?? 0) + (r.output_tokens ?? 0);
      byModel.set(key, m);

      if (r.ok) ok += 1;
      else byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);

      if (r.user_id) {
        const cost = estimateCost(r.model, (r.prompt_tokens ?? 0) + (r.output_tokens ?? 0)) ?? 0;
        byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + cost);
      }
    }

    const trend = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, calls]) => ({ label: new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), calls }));

    const topUsers = [...byUser.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, cost]) => ({ id, label: userLabel.get(id) ?? id.slice(0, 8), cost }));

    const spend = summarizeSpend(rows);

    return {
      totalCalls: rows.length,
      failureRate: rows.length ? Math.round(((rows.length - ok) / rows.length) * 100) : 0,
      trend,
      bySurface: [...bySurface.entries()],
      byModel: [...byModel.entries()],
      byReason: [...byReason.entries()],
      topUsers,
      spend,
    };
  }, [state]);

  if (state.status === 'loading') return <PanelSkeleton />;
  if (state.status === 'error') {
    return (
      <Card className="py-6">
        <EmptyState icon={ShieldAlert} title="Couldn't load AI usage" description={state.error?.message ?? 'Unknown error.'} />
      </Card>
    );
  }
  if (state.rows.length === 0) {
    return (
      <Card className="py-6">
        <EmptyState
          title="No AI usage recorded yet"
          description="Calls from the chat page and the code sidebar are logged here as they happen. Passage generation and other surfaces aren't instrumented yet."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-3">
        <MiniStat label="Calls logged" value={stats.totalCalls} />
        <MiniStat label="Failure rate" value={`${stats.failureRate}%`} />
        <MiniStat
          label="Estimated spend"
          value={`$${stats.spend.cost.toFixed(2)}`}
          hint={stats.spend.unrated ? `${stats.spend.unrated} calls on unrated models` : 'all calls rated'}
        />
      </div>

      <Card className="p-2.5">
        <ChartFrame
          title="Calls per day"
          height={220}
          table={<DataTable columns={['Day', 'Calls']} rows={stats.trend.map((t) => [t.label, t.calls])} />}
        >
          <TrendLine data={stats.trend} dataKey="calls" label="Calls" />
        </ChartFrame>
      </Card>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <Card className="p-2.5">
          <SectionTitle title="By surface" />
          <ul className="mt-1.5 space-y-1">
            {stats.bySurface.map(([surface, v]) => (
              <li key={surface} className="flex items-center justify-between text-sm">
                <Chip>{surface}</Chip>
                <span className="tnum text-ink-2">{v.calls} calls · {v.tokens.toLocaleString()} tokens</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-2.5">
          <SectionTitle title="By provider / model" />
          <ul className="mt-1.5 space-y-1">
            {stats.byModel.map(([model, v]) => (
              <li key={model} className="flex items-center justify-between text-sm">
                <span className="truncate font-mono text-xs text-ink-2">{model}</span>
                <span className="shrink-0 tnum text-ink-2">{v.calls} calls</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-2.5">
          <SectionTitle title="Failures by reason" hint={stats.byReason.length ? undefined : 'None yet'} />
          {stats.byReason.length ? (
            <ul className="mt-1.5 space-y-1">
              {stats.byReason.map(([reason, count]) => (
                <li key={reason} className="flex items-center justify-between text-sm">
                  <span className="text-ink-2">{AI_REASON_COPY?.[reason]?.label ?? reason}</span>
                  <span className="tnum text-bad">{count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card className="p-2.5">
          <SectionTitle title="Top users by estimated spend" />
          {stats.topUsers.length ? (
            <ul className="mt-1.5 space-y-1">
              {stats.topUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between text-sm">
                  <span className="truncate text-ink-2">{u.label}</span>
                  <span className="tnum text-ink-2">${u.cost.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-ink-3">No rated calls yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint }) {
  return (
    <Card className="p-2">
      <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold tnum">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
    </Card>
  );
}
