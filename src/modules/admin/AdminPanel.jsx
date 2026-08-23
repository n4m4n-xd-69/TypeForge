import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, DollarSign, ShieldAlert, Users as UsersIcon } from 'lucide-react';
import { Card, EmptyState } from '../../components/ui/Primitives.jsx';
import ChartFrame, { DataTable } from '../../components/charts/ChartFrame.jsx';
import { TrendLine } from '../../components/charts/Charts.jsx';
import Segmented from '../../components/ui/Segmented.jsx';
import Button from '../../components/ui/Button.jsx';
import Counter from '../../components/ui/Counter.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { fetchAiUsage, fetchDaily, fetchMyRole, fetchOverview } from './adminApi.js';
import { summarizeSpend } from './costs.js';
import PanelSkeleton from './PanelSkeleton.jsx';
import UsersTab from './UsersTab.jsx';
import AiUsageTab from './AiUsageTab.jsx';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'users', label: 'Users' },
  { value: 'ai', label: 'AI usage' },
];

/**
 * `/admin`. Client-side routing here is a convenience, not a control — every
 * query below is independently RLS-gated by `is_admin()` (0002_admin.sql).
 * This gate exists so a non-admin sees one clear message instead of four
 * empty-looking tabs.
 */
export default function AdminPanel() {
  const { user, ready, cloudEnabled, openAuthModal } = useAuth();
  const [role, setRole] = useState(null);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    let cancelled = false;
    fetchMyRole(user.id).then((r) => {
      if (!cancelled) setRole(r);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!cloudEnabled) {
    return (
      <Card className="py-6">
        <EmptyState
          icon={ShieldAlert}
          title="Admin needs cloud sync"
          description="This panel reads from Supabase. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use it."
        />
      </Card>
    );
  }

  if (!ready) return <PanelSkeleton />;

  if (!user) {
    return (
      <Card className="py-6">
        <EmptyState
          icon={ShieldAlert}
          title="Sign in required"
          description="Admin access is tied to your account's role."
          action={
            <Button variant="primary" onClick={() => openAuthModal('sign-in')}>
              Sign in
            </Button>
          }
        />
      </Card>
    );
  }

  if (role === null) return <PanelSkeleton />;

  if (role !== 'admin') {
    return (
      <Card className="py-6">
        <EmptyState
          icon={ShieldAlert}
          title="No access"
          description="This account isn't an admin. If you think that's wrong, ask whoever manages the Supabase project to add a row in user_roles."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Operator view</p>
          <h1 className="mt-0.5 text-3xl font-bold">Admin</h1>
        </div>
        <Segmented options={TABS} value={tab} onChange={setTab} label="Admin tab" />
      </header>

      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'users' ? <UsersTab adminId={user.id} /> : null}
      {tab === 'ai' ? <AiUsageTab /> : null}
    </div>
  );
}

function OverviewTab() {
  const [state, setState] = useState({ status: 'loading', users: [], daily: [], ai: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOverview(), fetchDaily(90), fetchAiUsage({ limit: 1000 })])
      .then(([users, daily, ai]) => {
        if (!cancelled) setState({ status: 'ready', users, daily, ai });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', users: [], daily: [], ai: [], error: err });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = useMemo(() => {
    const { users, daily, ai } = state;
    const cutoff = Date.now() - 7 * 86_400_000;
    const last7 = daily.filter((d) => new Date(d.day).getTime() >= cutoff);
    const minutes7d = last7.reduce((a, d) => a + Math.round((d.seconds ?? 0) / 60), 0);
    // admin_daily is a platform rollup (distinct users per day), not per-user
    // rows, so "active 7d" is the sum of each day's distinct-user count — a
    // reasonable proxy at this scale, not a true 7-day distinct-user set.
    const active7dCount = last7.reduce((a, d) => a + (d.active_users ?? 0), 0);
    const spend7d = summarizeSpend(ai.filter((r) => new Date(r.created_at).getTime() >= cutoff));

    return {
      totalUsers: users.length,
      active7dCount,
      minutes7d,
      spend7d,
    };
  }, [state]);

  const trend = useMemo(
    () =>
      [...state.daily]
        .reverse()
        .map((d) => ({ label: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), active: d.active_users })),
    [state.daily],
  );

  if (state.status === 'loading') return <PanelSkeleton />;

  if (state.status === 'error') {
    return (
      <Card className="py-6">
        <EmptyState icon={ShieldAlert} title="Couldn't load the overview" description={state.error?.message ?? 'Unknown error.'} />
      </Card>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={UsersIcon} label="Users" value={kpis.totalUsers} />
        <Kpi icon={Activity} label="Active 7d" value={kpis.active7dCount} hint="day-user rows, admin_daily" />
        <Kpi icon={Clock3} label="Minutes 7d" value={kpis.minutes7d} />
        <Kpi
          icon={DollarSign}
          label="AI spend 7d"
          value={kpis.spend7d.cost}
          prefix="$"
          decimals={2}
          hint={kpis.spend7d.unrated ? `${kpis.spend7d.unrated} of ${kpis.spend7d.total} calls unrated` : 'estimated'}
        />
      </div>

      <Card className="p-2.5">
        <ChartFrame
          title="Active users"
          hint="Distinct users per day, from admin_daily"
          height={240}
          table={<DataTable columns={['Day', 'Active users']} rows={trend.map((t) => [t.label, t.active])} />}
        >
          <TrendLine data={trend} dataKey="active" label="Active users" />
        </ChartFrame>
      </Card>

      <Card className="p-2.5">
        <ChartFrame title="Platform time" hint="Minutes logged per day, all users" height={200}>
          <TrendLine
            data={[...state.daily].reverse().map((d) => ({
              label: new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
              minutes: Math.round((d.seconds ?? 0) / 60),
            }))}
            dataKey="minutes"
            label="Minutes"
            color="#f59e0b"
          />
        </ChartFrame>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, prefix = '', decimals = 0 }) {
  return (
    <Card className="p-2">
      <div className="flex items-center gap-1">
        <span className="grid h-[28px] w-[28px] place-items-center rounded-[9px] bg-subtle text-ink-2">
          <Icon size={15} strokeWidth={2.2} aria-hidden />
        </span>
        <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-3">{label}</p>
      </div>
      <p className="mt-1.5 font-mono text-3xl font-medium leading-none tnum">
        <Counter value={value} decimals={decimals} prefix={prefix} />
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </Card>
  );
}

