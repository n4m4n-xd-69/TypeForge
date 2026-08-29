import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban, CheckCircle2, Flame, Minus, Plus, ShieldCheck, Trash2, UserCog, UserPlus, Users as UsersIcon,
} from 'lucide-react';
import { cx, humanDuration, relativeTime } from '../../../lib/format.js';
import { keyLabel, weakestKeys } from '../../../lib/typing.js';
import { Chip } from '../../../components/ui/Primitives.jsx';
import Button from '../../../components/ui/Button.jsx';
import Select from '../../../components/ui/Select.jsx';
import ChartFrame, { DataTable } from '../../../components/charts/ChartFrame.jsx';
import { Heatmap, TrendLine } from '../../../components/charts/Charts.jsx';
import {
  ConfirmAction, ConsoleTable, Drilldown, Field, FieldGrid, FilterBar,
  MetricRack, MetricTile, Panel, ScopeGate, StateBlock, ViewHeader,
  useConsole, useConsoleQuery,
} from '../kit/index.js';
import {
  adjustXp, fetchOverview, fetchUserDetail, fetchUserStatuses, setUserRole, setUserStatus,
} from '../api/console.js';

/**
 * User management.
 *
 * The roster is one query plus a status join, held in memory and filtered
 * client-side. That is a deliberate ceiling, not an oversight: `admin_user_overview`
 * is a per-user aggregate over every session and AI call, so it is expensive
 * to run and cheap to hold. When the user count makes that untrue the fix is a
 * server-paged variant of the function — the table already supports server
 * mode (see ContentView, which uses it) — not a rewrite of this view.
 */

const DAY = 86_400_000;

const STATUS_FILTER = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const ACTIVITY_FILTER = [
  { value: 'all', label: 'Any activity' },
  { value: 'active7', label: 'Seen in 7 days' },
  { value: 'dormant30', label: 'Dormant 30 days+' },
  { value: 'never', label: 'Never signed in' },
];

export default function UsersView() {
  const { range, nonce, refresh, can } = useConsole();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ status: 'all', activity: 'all' });
  const [selected, setSelected] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [bulk, setBulk] = useState(null);

  const roster = useConsoleQuery(async () => {
    const [users, statuses] = await Promise.all([fetchOverview(), fetchUserStatuses()]);
    return users.map((u) => ({ ...u, ...(statuses.get(u.id) ?? { status: 'active' }) }));
  }, [nonce]);

  const users = roster.data ?? [];

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      total: users.length,
      suspended: users.filter((u) => u.status === 'suspended').length,
      activeInRange: users.filter(
        (u) => u.last_seen && new Date(u.last_seen) >= range.from,
      ).length,
      newInRange: users.filter((u) => u.signed_up && new Date(u.signed_up) >= range.from).length,
      dormant: users.filter((u) => u.last_seen && now - new Date(u.last_seen).getTime() > 30 * DAY).length,
    };
  }, [users, range.from]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return users.filter((u) => {
      if (q && !(u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))) return false;
      if (filters.status !== 'all' && (u.status ?? 'active') !== filters.status) return false;
      if (filters.activity === 'active7' && !(u.last_seen && now - new Date(u.last_seen).getTime() <= 7 * DAY)) return false;
      if (filters.activity === 'dormant30' && !(u.last_seen && now - new Date(u.last_seen).getTime() > 30 * DAY)) return false;
      if (filters.activity === 'never' && u.last_seen) return false;
      return true;
    });
  }, [users, query, filters]);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const columns = useMemo(
    () => [
      {
        key: 'display_name',
        label: 'Name',
        width: '20%',
        render: (u) => (
          <span className="flex items-center gap-0.5">
            <span className="truncate font-semibold">{u.display_name || <span className="text-ink-3">unnamed</span>}</span>
            {u.status === 'suspended' ? <Chip tone="bad">suspended</Chip> : null}
          </span>
        ),
      },
      { key: 'email', label: 'Email', width: '22%', render: (u) => <span className="truncate text-ink-2">{u.email}</span> },
      { key: 'signed_up', label: 'Signed up', align: 'right', render: (u) => <span className="text-ink-3">{relativeTime(u.signed_up)}</span> },
      {
        key: 'last_seen',
        label: 'Last seen',
        align: 'right',
        render: (u) => <span className="text-ink-3">{u.last_seen ? relativeTime(u.last_seen) : 'never'}</span>,
      },
      { key: 'sessions', label: 'Sessions', align: 'right', mono: true },
      {
        key: 'total_seconds',
        label: 'Practised',
        align: 'right',
        mono: true,
        render: (u) => humanDuration(u.total_seconds ?? 0),
      },
      { key: 'xp', label: 'XP', align: 'right', mono: true, render: (u) => <span className="text-brand">{u.xp?.toLocaleString()}</span> },
      { key: 'streak_best', label: 'Best streak', align: 'right', mono: true },
      { key: 'ai_calls', label: 'AI calls', align: 'right', mono: true },
    ],
    [],
  );

  const applyTile = (key, value) => {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? 'all' : value }));
  };

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Users"
        description="Every account, what it has done, and the actions available on it. Open a row for the full profile."
      />

      <MetricRack cols={4}>
        <MetricTile
          icon={UsersIcon}
          label="Total users"
          value={counts.total}
          loading={roster.status === 'loading'}
          source="admin_user_overview"
          active={filters.status === 'all' && filters.activity === 'all'}
          onClick={() => setFilters({ status: 'all', activity: 'all' })}
        />
        <MetricTile
          icon={CheckCircle2}
          label={`Seen in ${range.label.toLowerCase()}`}
          value={counts.activeInRange}
          hint={counts.total ? `${Math.round((counts.activeInRange / counts.total) * 100)}% of accounts` : null}
          source="auth.users.last_sign_in_at"
          active={filters.activity === 'active7'}
          onClick={() => applyTile('activity', 'active7')}
        />
        <MetricTile
          icon={UserPlus}
          label={`New in ${range.label.toLowerCase()}`}
          value={counts.newInRange}
          source="profiles.created_at"
          onClick={() => applyTile('activity', 'all')}
        />
        <MetricTile
          icon={Ban}
          label="Suspended"
          value={counts.suspended}
          invert
          hint={counts.dormant ? `${counts.dormant} dormant 30d+` : null}
          source="profiles.status"
          active={filters.status === 'suspended'}
          onClick={() => applyTile('status', 'suspended')}
        />
      </MetricRack>

      <Panel
        title="Roster"
        hint={`${rows.length.toLocaleString()} of ${users.length.toLocaleString()} accounts match`}
        source="admin_user_overview + profiles.status"
        refreshing={roster.isRefreshing}
      >
        <div className="space-y-1.5">
          <FilterBar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search name or email…"
            filters={[
              { key: 'status', label: 'Status', value: filters.status, defaultValue: 'all', options: STATUS_FILTER },
              { key: 'activity', label: 'Activity', value: filters.activity, defaultValue: 'all', options: ACTIVITY_FILTER },
            ]}
            onFilterChange={setFilter}
          />

          <StateBlock
            status={roster.status}
            error={roster.error}
            onRetry={roster.reload}
            rows={8}
          >
            <ConsoleTable
              columns={columns}
              rows={rows}
              rowKey={(u) => u.id}
              onRowClick={(u) => setOpenId(u.id)}
              selectable
              selected={selected}
              onSelectionChange={setSelected}
              defaultSort={{ key: 'signed_up', dir: 'desc' }}
              csvName="typeforge-users"
              minWidth={980}
              bulkActions={
                <ScopeGate can={can('users.write')} scope="users.write" inline>
                  <Button variant="danger" onClick={() => setBulk('suspend')}>
                    <Ban size={13} aria-hidden />
                    Suspend {selected.length}
                  </Button>
                </ScopeGate>
              }
              empty={
                <p className="px-2 text-center text-sm text-ink-3">
                  No account matches this search and filter combination.
                </p>
              }
            />
          </StateBlock>
        </div>
      </Panel>

      <UserSheet
        userId={openId}
        summary={users.find((u) => u.id === openId)}
        onClose={() => setOpenId(null)}
        onMutated={refresh}
      />

      {/* Bulk suspension is one confirmation for the whole selection, and the
          reason it captures is written to every audit row it produces —
          suspending forty accounts should not mean forty dialogs, but it must
          still mean forty explanations. */}
      <ConfirmAction
        open={bulk === 'suspend'}
        onClose={() => setBulk(null)}
        title={`Suspend ${selected.length} accounts`}
        description="Each account is suspended separately and each gets its own audit entry."
        confirmLabel="Suspend all"
        tone="danger"
        requireReason
        onConfirm={async (reason) => {
          const results = await Promise.allSettled(
            selected.map((id) => setUserStatus(id, 'suspended', reason)),
          );
          const failed = results.filter((r) => r.status === 'rejected');
          setSelected([]);
          refresh();
          if (failed.length) {
            throw new Error(
              `${results.length - failed.length} suspended, ${failed.length} failed: ${failed[0].reason?.message ?? 'unknown error'}`,
            );
          }
        }}
      />
    </div>
  );
}

/* ── the drill-down ────────────────────────────────────────────────────── */

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'activity', label: 'Activity' },
  { value: 'performance', label: 'Performance' },
  { value: 'games', label: 'Games' },
  { value: 'content', label: 'Content' },
  { value: 'audit', label: 'Audit' },
];

function UserSheet({ userId, summary, onClose, onMutated }) {
  const { can } = useConsole();
  const [tab, setTab] = useState('overview');
  const [action, setAction] = useState(null);
  const [xpDelta, setXpDelta] = useState(100);
  const [nextTier, setNextTier] = useState('support');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (userId) {
      setTab('overview');
      setReloadKey(0);
    }
  }, [userId]);

  const detail = useConsoleQuery(
    () => (userId ? fetchUserDetail(userId) : Promise.resolve(null)),
    [userId, reloadKey],
    { enabled: Boolean(userId) },
  );

  const d = detail.data ?? {};
  const profile = d.profile ?? summary ?? {};
  const suspended = profile.status === 'suspended';

  const afterMutation = useCallback(() => {
    setReloadKey((k) => k + 1);
    onMutated?.();
  }, [onMutated]);

  const heatmapDays = useMemo(() => {
    const out = {};
    for (const row of d.daily ?? []) out[String(row.day).slice(0, 10)] = { seconds: row.seconds ?? 0 };
    return out;
  }, [d.daily]);

  const weak = useMemo(() => {
    const map = {};
    for (const k of d.key_stats ?? []) map[k.key] = { total: k.total, wrong: k.wrong };
    return weakestKeys(map, 10, 5);
  }, [d.key_stats]);

  const wpmTrend = useMemo(
    () =>
      [...(d.recent_sessions ?? [])]
        .reverse()
        .map((s) => ({ label: new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), wpm: s.wpm })),
    [d.recent_sessions],
  );

  return (
    <>
      <Drilldown
        open={Boolean(userId)}
        onClose={onClose}
        width="xl"
        eyebrow="admin_user_detail"
        title={profile.display_name || profile.email || 'User'}
        subtitle={profile.email}
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="flex items-center gap-0.5 text-xs text-ink-3">
              {suspended ? <Chip tone="bad">suspended</Chip> : <Chip tone="good">active</Chip>}
              {profile.admin_tier ? <Chip tone="brand">{profile.admin_tier}</Chip> : null}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              <ScopeGate can={can('users.write')} scope="users.write" inline>
                <Button variant="secondary" onClick={() => setAction('xp')}>
                  <Flame size={13} aria-hidden />
                  Adjust XP
                </Button>
              </ScopeGate>
              <ScopeGate can={can('users.write')} scope="users.write" inline>
                <Button
                  variant={suspended ? 'secondary' : 'danger'}
                  onClick={() => setAction(suspended ? 'reactivate' : 'suspend')}
                >
                  {suspended ? <CheckCircle2 size={13} aria-hidden /> : <Ban size={13} aria-hidden />}
                  {suspended ? 'Reactivate' : 'Suspend'}
                </Button>
              </ScopeGate>
              {can('roles.write') ? (
                <Button variant="secondary" onClick={() => setAction('role')}>
                  <UserCog size={13} aria-hidden />
                  Role
                </Button>
              ) : null}
              {can('users.delete') ? (
                <Button variant="danger" onClick={() => setAction('delete')}>
                  <Trash2 size={13} aria-hidden />
                  Delete
                </Button>
              ) : null}
            </span>
          </div>
        }
      >
        <StateBlock status={detail.status} error={detail.error} onRetry={detail.reload} rows={6}>
          {tab === 'overview' ? (
            <div className="space-y-2">
              <FieldGrid cols={4}>
                <Field label="XP" mono>{profile.xp?.toLocaleString()}</Field>
                <Field label="Streak" mono>{profile.streak_count ?? 0}d</Field>
                <Field label="Best streak" mono>{profile.streak_best ?? 0}d</Field>
                <Field label="Daily goal" mono>{profile.goal_minutes} min</Field>
                <Field label="Sessions" mono>{d.totals?.sessions?.toLocaleString()}</Field>
                <Field label="Practised" mono>{humanDuration(d.totals?.seconds ?? 0)}</Field>
                <Field label="Average WPM" mono>{d.totals?.avg_wpm}</Field>
                <Field label="Best WPM" mono>{d.totals?.best_wpm}</Field>
                <Field label="Accuracy" mono>{d.totals?.avg_accuracy != null ? `${d.totals.avg_accuracy}%` : null}</Field>
                <Field label="Signed up">{profile.signed_up ? relativeTime(profile.signed_up) : null}</Field>
                <Field label="Last seen">{profile.last_seen ? relativeTime(profile.last_seen) : 'never'}</Field>
                <Field label="AI calls" mono>{d.ai?.calls?.toLocaleString()}</Field>
              </FieldGrid>

              {suspended ? (
                <p className="rounded-sm border border-bad/30 bg-bad/[0.06] p-1.5 text-sm">
                  <strong className="font-semibold">Suspended</strong>{' '}
                  {profile.status_changed_at ? relativeTime(profile.status_changed_at) : ''} —{' '}
                  <span className="text-ink-2">{profile.status_reason || 'no reason recorded'}</span>
                </p>
              ) : null}

              <ChartFrame title="Practice footprint" hint="Daily seconds, last 26 weeks" height="auto">
                <Heatmap days={heatmapDays} weeks={26} />
              </ChartFrame>
            </div>
          ) : null}

          {tab === 'activity' ? (
            <div className="space-y-2">
              <MiniTable
                title="Recent sessions"
                head={['When', 'Kind', 'WPM', 'Accuracy', 'Errors', 'XP']}
                rows={(d.recent_sessions ?? []).map((s) => [
                  relativeTime(s.ts),
                  s.language ?? s.mode ?? s.kind,
                  s.wpm,
                  `${s.accuracy}%`,
                  s.errors ?? 0,
                  `+${s.xp}`,
                ])}
                emptyText="No sessions recorded."
              />
              <MiniTable
                title="Auth events"
                head={['Event', 'Provider', 'When']}
                rows={(d.auth_events ?? []).map((e) => [e.event, e.provider ?? '—', relativeTime(e.created_at)])}
                emptyText="No auth events recorded."
              />
            </div>
          ) : null}

          {tab === 'performance' ? (
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-sm font-bold">Weakest keys</p>
                {weak.length ? (
                  <ul className="flex flex-wrap gap-0.5">
                    {weak.map((k) => (
                      <li
                        key={k.key}
                        className="flex items-center gap-0.5 rounded-sm border border-line bg-raised/60 px-1 py-0.5"
                      >
                        <span className="font-mono text-sm font-bold">{keyLabel(k.key)}</span>
                        <span className="font-mono text-2xs font-bold text-bad tnum">{Math.round(k.rate * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Not enough keystroke data yet.</p>
                )}
              </div>

              {wpmTrend.length > 1 ? (
                <ChartFrame
                  title="WPM over recent sessions"
                  hint="Newest last; not time-spaced"
                  height={200}
                  table={<DataTable columns={['Session', 'WPM']} rows={wpmTrend.map((t) => [t.label, t.wpm])} />}
                >
                  <TrendLine data={wpmTrend} dataKey="wpm" label="WPM" />
                </ChartFrame>
              ) : null}

              <MiniTable
                title="Code problems"
                head={['Problem', 'Language', 'Status', 'Attempts']}
                rows={(d.problems ?? []).map((p) => [p.problem_id, p.language ?? '—', p.status, p.attempts])}
                emptyText="No coding attempts recorded."
              />
            </div>
          ) : null}

          {tab === 'games' ? (
            <div className="space-y-2">
              {d.shadow ? (
                <FieldGrid cols={4}>
                  <Field label="Forge rating" mono>{d.shadow.fr}</Field>
                  <Field label="Peak" mono>{d.shadow.peak_fr}</Field>
                  <Field label="Matches" mono>{d.shadow.matches}</Field>
                  <Field label="Record" mono>{`${d.shadow.wins}-${d.shadow.losses}-${d.shadow.draws}`}</Field>
                  <Field label="Win rate" mono>
                    {/* Zero matches is not a zero percent win rate. */}
                    {d.shadow.matches ? `${Math.round((d.shadow.wins / d.shadow.matches) * 100)}%` : null}
                  </Field>
                  <Field label="Streak" mono>{d.shadow.streak}</Field>
                  <Field label="Best streak" mono>{d.shadow.best_streak}</Field>
                  <Field label="Average WPM" mono>{d.shadow.avg_wpm}</Field>
                </FieldGrid>
              ) : (
                <p className="text-sm text-ink-3">This account has not played a rated match.</p>
              )}
              <MiniTable
                title="Most-faced opponents"
                head={['Opponent', 'Meetings', 'Wins']}
                rows={(d.opponents ?? []).map((o) => [o.opponent, o.meetings, o.wins])}
                emptyText="No recorded opponents."
              />
            </div>
          ) : null}

          {tab === 'content' ? (
            <MiniTable
              title="Generations attributed to this account"
              head={['Title', 'Kind', 'Words', 'State', 'Created']}
              rows={(d.generations ?? []).map((g) => [
                g.title || g.kind,
                g.kind,
                g.word_count,
                g.flagged ? 'flagged' : g.published ? 'live' : 'archived',
                relativeTime(g.created_at),
              ])}
              emptyText="No generations attributed to this account."
            />
          ) : null}

          {tab === 'audit' ? (
            <MiniTable
              title="Manual XP adjustments"
              head={['Change', 'Reason', 'When']}
              rows={(d.xp_adjustments ?? []).map((a) => [
                `${a.delta > 0 ? '+' : ''}${a.delta}`,
                a.reason,
                relativeTime(a.created_at),
              ])}
              emptyText="No manual adjustments on this account."
            />
          ) : null}

          {/* PRD 05 §7.3. Worth repeating on the surface where it would be
              easiest to violate. */}
          <p className="mt-2 border-t border-line pt-1.5 text-2xs text-ink-3">
            Metadata only. No typed content, passage text or chat transcript is shown here, for any account, at any tier.
          </p>
        </StateBlock>
      </Drilldown>

      <ConfirmAction
        open={action === 'xp'}
        onClose={() => setAction(null)}
        title="Adjust XP"
        description="Recorded separately from earned XP so the economy analytics stay honest."
        confirmLabel="Apply adjustment"
        requireReason
        onConfirm={async (reason) => {
          await adjustXp(userId, Number(xpDelta), reason);
          afterMutation();
        }}
      >
        <div className="space-y-1">
          <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Amount</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setXpDelta((v) => Number(v) - 50)}
              aria-label="Decrease by 50"
              className="grid h-[34px] w-[34px] place-items-center rounded-sm border border-line hover:border-line-strong"
            >
              <Minus size={14} aria-hidden />
            </button>
            <input
              type="number"
              value={xpDelta}
              onChange={(e) => setXpDelta(e.target.value)}
              className="h-[34px] w-full rounded-sm border border-line bg-raised/50 px-1.5 text-center font-mono text-base tnum outline-none focus:border-line-strong"
            />
            <button
              onClick={() => setXpDelta((v) => Number(v) + 50)}
              aria-label="Increase by 50"
              className="grid h-[34px] w-[34px] place-items-center rounded-sm border border-line hover:border-line-strong"
            >
              <Plus size={14} aria-hidden />
            </button>
          </div>
          <p className="font-mono text-xs text-ink-3 tnum">
            {(profile.xp ?? 0).toLocaleString()} → {Math.max(0, (profile.xp ?? 0) + Number(xpDelta || 0)).toLocaleString()}
            {(profile.xp ?? 0) + Number(xpDelta || 0) < 0 ? ' (floors at zero)' : ''}
          </p>
        </div>
      </ConfirmAction>

      <ConfirmAction
        open={action === 'suspend'}
        onClose={() => setAction(null)}
        title="Suspend this account"
        description="The account keeps its data and can be reactivated at any time."
        confirmLabel="Suspend"
        tone="danger"
        requireReason
        onConfirm={async (reason) => {
          await setUserStatus(userId, 'suspended', reason);
          afterMutation();
        }}
      />

      <ConfirmAction
        open={action === 'reactivate'}
        onClose={() => setAction(null)}
        title="Reactivate this account"
        confirmLabel="Reactivate"
        onConfirm={async (reason) => {
          await setUserStatus(userId, 'active', reason || 'reactivated');
          afterMutation();
        }}
      />

      <ConfirmAction
        open={action === 'delete'}
        onClose={() => setAction(null)}
        title="Delete this account"
        description="Marks the account deleted and blocks access. Purging the auth record itself is a separate service-role operation."
        confirmLabel="Delete account"
        tone="danger"
        requireReason
        confirmPhrase={profile.email}
        onConfirm={async (reason) => {
          await setUserStatus(userId, 'deleted', reason);
          afterMutation();
          onClose();
        }}
      />

      <ConfirmAction
        open={action === 'role'}
        onClose={() => setAction(null)}
        title="Change operator tier"
        description="Tiers map to the scope set the database enforces on every admin action."
        confirmLabel="Grant tier"
        onConfirm={async (reason) => {
          await setUserRole(userId, nextTier === 'none' ? 'user' : 'admin', nextTier === 'none' ? null : nextTier, reason);
          afterMutation();
        }}
      >
        <label className="block">
          <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Tier</span>
          <div className="mt-0.5">
            <Select
              value={nextTier}
              onChange={setNextTier}
              label="Operator tier"
              minWidth={220}
              options={[
                { value: 'none', label: 'No console access' },
                { value: 'support', label: 'Support — act on users' },
                { value: 'analyst', label: 'Analyst — read only' },
                { value: 'admin', label: 'Admin — everything but roles' },
                { value: 'owner', label: 'Owner — everything' },
              ]}
            />
          </div>
        </label>
        <p className="flex items-start gap-0.5 text-xs text-ink-3">
          <ShieldCheck size={12} className="mt-px shrink-0" aria-hidden />
          You cannot change your own tier — the database rejects it, so a project can never end up with no owner.
        </p>
      </ConfirmAction>
    </>
  );
}

/** Small read-only table used throughout the sheet. */
function MiniTable({ title, head, rows, emptyText }) {
  return (
    <div>
      <p className="mb-1 text-sm font-bold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">{emptyText}</p>
      ) : (
        <div className="max-h-[260px] overflow-auto rounded-sm border border-line">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead className="sticky top-0 bg-raised">
              <tr>
                {head.map((h) => (
                  <th key={h} className="px-1.5 py-1 text-left text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((cell, j) => (
                    <td key={j} className={cx('px-1.5 py-1', j > 0 && 'font-mono tnum text-ink-2')}>
                      {cell ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
