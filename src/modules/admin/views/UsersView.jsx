import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban, CheckCircle2, Flame, Minus, Plus, ShieldCheck, Trash2, UserCog, UserPlus, Users as UsersIcon,
} from 'lucide-react';
import { cx, humanDuration, relativeTime } from '../../../lib/format.js';
import { keyLabel, weakestKeys } from '../../../lib/typing.js';
import { Chip } from '../../../components/ui/Primitives.jsx';
import Avatar from '../../../components/ui/Avatar.jsx';
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
  subscribeToTables,
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

/* `all` deliberately excludes removed accounts: a removed account is gone as
   far as the roster is concerned, and leaving it in the default view makes the
   list grow forever with rows nobody acts on. `removed` brings them back when
   an operator needs to audit or restore one. */
const STATUS_FILTER = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Removed' },
];

/**
 * The app signs people in anonymously so it works before anyone commits to an
 * account, and each guest is a real auth.users row.
 *
 * Migration 0018 was right that counting guests as registered users reports
 * session churn as growth — but it fixed that in the wrong place. It made
 * `registered` the roster's *default filter*, so the one screen whose job is to
 * answer "who is in this database" answered it with a subset, silently. On a
 * project where nearly every account is a guest, that is an admin panel showing
 * one user out of dozens with no indication anything is hidden.
 *
 * The distinction belongs in the KPIs, which still report the two populations
 * separately, and in a filter the operator can choose. The roster's default is
 * now everyone, because a roster that hides rows by default is not a roster.
 */
const ACCOUNT_FILTER = [
  { value: 'all', label: 'Everyone' },
  { value: 'registered', label: 'Registered' },
  { value: 'guest', label: 'Guests' },
];

const ACTIVITY_FILTER = [
  { value: 'all', label: 'Any activity' },
  { value: 'active7', label: 'Seen in 7 days' },
  { value: 'dormant30', label: 'Dormant 30 days+' },
  { value: 'never', label: 'Never signed in' },
];

const BULK = {
  suspend: {
    status: 'suspended',
    verb: 'Suspend',
    confirm: 'Suspend all',
    tone: 'danger',
    requireReason: true,
    description:
      'Each account is suspended separately and each gets its own audit entry. Suspended people are shown the reason and can appeal.',
  },
  reactivate: {
    status: 'active',
    verb: 'Reactivate',
    confirm: 'Reactivate all',
    tone: 'default',
    requireReason: false,
    description: 'Restores full access and clears the suspension notice.',
  },
  delete: {
    status: 'deleted',
    verb: 'Remove',
    confirm: 'Remove from roster',
    tone: 'danger',
    requireReason: true,
    description:
      'Removes these accounts from the roster and blocks access. Practice history is kept, and an operator can restore them from the Removed filter.',
  },
};

export default function UsersView() {
  const { range, nonce, refresh, can } = useConsole();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ status: 'all', activity: 'all', account: 'all' });
  const [selected, setSelected] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [bulk, setBulk] = useState(null);

  const roster = useConsoleQuery(async () => {
    const [users, statuses] = await Promise.all([fetchOverview(), fetchUserStatuses()]);
    return users.map((u) => ({ ...u, ...(statuses.get(u.id) ?? { status: 'active' }) }));
  }, [nonce]);

  /**
   * A new registration should appear here without anyone pressing anything.
   *
   * `profiles` gets a row from the `on_auth_user_created` trigger the moment an
   * account exists, and it carries the status changes an operator makes, so one
   * subscription covers "someone signed up", "someone edited their profile" and
   * "someone was suspended" — the three things this screen is watching for.
   *
   * Coalesced through a timer rather than refetched per event: a burst of
   * profile writes (a bulk suspend is one per account) should cost one reload,
   * not one each. Realtime is advisory here — if the publication is not
   * configured this is simply inert and the console's own polling still
   * refreshes the roster.
   */
  useEffect(() => {
    let timer = null;
    const stop = subscribeToTables(['profiles'], () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; refresh(); }, 600);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [refresh]);

  const users = roster.data ?? [];

  const counts = useMemo(() => {
    const now = Date.now();
    const registered = users.filter((u) => !u.is_guest);
    return {
      total: registered.length,
      guests: users.length - registered.length,
      suspended: users.filter((u) => u.status === 'suspended').length,
      removed: users.filter((u) => u.status === 'deleted').length,
      activeInRange: registered.filter((u) => u.last_seen && new Date(u.last_seen) >= range.from).length,
      newInRange: registered.filter((u) => u.signed_up && new Date(u.signed_up) >= range.from).length,
      dormant: users.filter((u) => u.last_seen && now - new Date(u.last_seen).getTime() > 30 * DAY).length,
    };
  }, [users, range.from]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return users.filter((u) => {
      if (q && !(u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))) return false;
      if (filters.account === 'registered' && u.is_guest) return false;
      if (filters.account === 'guest' && !u.is_guest) return false;
      const st = u.status ?? 'active';
      if (filters.status === 'all' ? st === 'deleted' : st !== filters.status) return false;
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
            <Avatar value={u.photo_url || u.avatar} name={u.display_name || 'user'} size={22} />
            <span className="truncate font-semibold">{u.display_name || <span className="text-ink-3">unnamed</span>}</span>
            {u.is_guest ? <Chip>guest</Chip> : null}
            {u.status === 'suspended' ? <Chip tone="bad">suspended</Chip> : null}
            {u.status === 'deleted' ? <Chip tone="warn">removed</Chip> : null}
          </span>
        ),
      },
      {
        key: 'email',
        label: 'Email',
        width: '22%',
        render: (u) => (u.email ? <span className="truncate text-ink-2">{u.email}</span> : <span className="text-ink-3">no email · guest</span>),
      },
      {
        key: 'provider',
        label: 'Provider',
        width: '9%',
        render: (u) => <span className="text-ink-3">{providerLabel(u) ?? '—'}</span>,
      },
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
        {/* The headline is every account, with the split in the hint. The tile
            used to read "Registered users" and set the roster to match, which
            made the subset look like the whole — the panel below reported one
            user on a database holding dozens. Registered vs guest is a real
            distinction and it is still one click away, but it is a breakdown,
            not the default view of the roster. */}
        <MetricTile
          icon={UsersIcon}
          label="Accounts"
          value={users.length}
          loading={roster.status === 'loading'}
          hint={
            counts.guests
              ? `${counts.total.toLocaleString()} registered · ${counts.guests.toLocaleString()} guest`
              : `${counts.total.toLocaleString()} registered · no guest sessions`
          }
          source="admin_user_overview"
          active={filters.account === 'all' && filters.status === 'all' && filters.activity === 'all'}
          onClick={() => setFilters({ status: 'all', activity: 'all', account: 'all' })}
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
          hint={counts.removed ? `${counts.removed} removed from roster` : counts.dormant ? `${counts.dormant} dormant 30d+` : null}
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
              { key: 'account', label: 'Account', value: filters.account, defaultValue: 'registered', options: ACCOUNT_FILTER },
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
              minWidth={1080}
              bulkActions={
                <>
                  <ScopeGate can={can('users.write')} scope="users.write" inline>
                    <Button variant="secondary" onClick={() => setBulk('reactivate')}>
                      <CheckCircle2 size={13} aria-hidden />
                      Reactivate
                    </Button>
                  </ScopeGate>
                  <ScopeGate can={can('users.write')} scope="users.write" inline>
                    <Button variant="danger" onClick={() => setBulk('suspend')}>
                      <Ban size={13} aria-hidden />
                      Suspend {selected.length}
                    </Button>
                  </ScopeGate>
                  {can('users.delete') ? (
                    <Button variant="danger" onClick={() => setBulk('delete')}>
                      <Trash2 size={13} aria-hidden />
                      Remove
                    </Button>
                  ) : null}
                </>
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
      {/* One dialog for all three bulk actions. Each target is written
          separately so every account gets its own audit row, and the shared
          reason is recorded against every one of them — forty accounts should
          not mean forty dialogs, but it must still mean forty explanations. */}
      <ConfirmAction
        open={Boolean(bulk)}
        onClose={() => setBulk(null)}
        title={`${BULK[bulk]?.verb ?? ''} ${selected.length} ${selected.length === 1 ? 'account' : 'accounts'}`}
        description={BULK[bulk]?.description}
        confirmLabel={BULK[bulk]?.confirm}
        tone={BULK[bulk]?.tone}
        requireReason={BULK[bulk]?.requireReason}
        confirmPhrase={bulk === 'delete' ? `remove ${selected.length}` : null}
        onConfirm={async (reason) => {
          const target = BULK[bulk].status;
          const results = await Promise.allSettled(
            selected.map((id) => setUserStatus(id, target, reason || BULK[bulk].verb.toLowerCase())),
          );
          const failed = results.filter((r) => r.status === 'rejected');
          setSelected([]);
          refresh();
          if (failed.length) {
            throw new Error(
              `${results.length - failed.length} updated, ${failed.length} failed: ${failed[0].reason?.message ?? 'unknown error'}`,
            );
          }
        }}
      />
    </div>
  );
}

/* ── the drill-down ────────────────────────────────────────────────────── */

/**
 * Six sections rather than one long scroll, per spec §7: an operator opening an
 * account is usually answering one question, and the tab they land on should be
 * the one that answers "who is this and are they in trouble" — identity, totals
 * and the practice footprint. Everything else is one click away and nothing is
 * two.
 *
 * "Battles" leads with Battlefield and keeps Shadow below it: Battlefield is
 * the mode people actually play, and Shadow is behind the under-development
 * gate, so an account with no rated match is the normal case, not a gap.
 */
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'activity', label: 'Activity' },
  { value: 'performance', label: 'Performance' },
  { value: 'games', label: 'Battles' },
  { value: 'content', label: 'Community' },
  { value: 'audit', label: 'Audit' },
];

/* Guests have no provider string of their own and reading "anonymous" as a
   sign-in method is more confusing than helpful, so the two are one label. */
const PROVIDER_LABEL = {
  google: 'Google',
  email: 'Email',
  anonymous: 'Guest session',
  phone: 'Phone',
};

function providerLabel(profile) {
  if (!profile?.provider) return profile?.is_guest ? 'Guest session' : null;
  return PROVIDER_LABEL[profile.provider] ?? profile.provider;
}

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
        media={
          <Avatar
            value={profile.photo_url || profile.avatar}
            name={profile.display_name || profile.email || 'User'}
            size={40}
          />
        }
        title={profile.display_name || profile.email || 'User'}
        subtitle={profile.email || (profile.is_guest ? 'Guest session · no email' : null)}
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
              {/* Identity first. The sheet used to open on XP and streaks,
                  which answers "how much have they typed" before "who is
                  this" — and on a roster where most rows are guests, the
                  second question is the one an operator actually has. */}
              <FieldGrid cols={4}>
                <Field label="Account">
                  {profile.is_guest ? <Chip>guest</Chip> : <Chip tone="good">registered</Chip>}
                </Field>
                <Field label="Signed in with">{providerLabel(profile)}</Field>
                <Field label="Course">{profile.course}</Field>
                <Field label="Branch">{profile.branch}</Field>
                <Field label="Year" mono>{profile.study_year ? `Year ${profile.study_year}` : null}</Field>
                <Field label="Photo">{profile.photo_url ? 'uploaded' : 'preset avatar'}</Field>
                <Field label="Signed up">{profile.signed_up ? relativeTime(profile.signed_up) : null}</Field>
                <Field label="Last seen">{profile.last_seen ? relativeTime(profile.last_seen) : 'never'}</Field>
              </FieldGrid>

              {profile.bio ? (
                <p className="rounded-sm border border-line bg-raised/40 p-1.5 text-sm text-ink-2">
                  {profile.bio}
                </p>
              ) : null}

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
                <Field label="Battlefield matches" mono>{d.battle?.matches ?? 0}</Field>
                <Field label="Community posts" mono>{d.community?.posts ?? 0}</Field>
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
              <div>
                <p className="mb-1 text-sm font-bold">Battlefield</p>
                <FieldGrid cols={4}>
                  <Field label="Rooms opened" mono>{d.battle?.rooms_created ?? 0}</Field>
                  {/* Hosting a room also joins it, so this count includes the
                      rooms above rather than sitting beside them. */}
                  <Field label="Rooms joined" mono>{d.battle?.rooms_joined ?? 0}</Field>
                  <Field label="Matches" mono>{d.battle?.matches ?? 0}</Field>
                  <Field label="Wins" mono>{d.battle?.wins ?? 0}</Field>
                  <Field label="Top three" mono>
                    {(d.battle?.wins ?? 0) + (d.battle?.podium ?? 0)}
                  </Field>
                  {/* A result written by the settle path rather than by the
                      player — a closed tab or a timeout. High counts here are
                      the signature of someone who keeps abandoning rooms. */}
                  <Field label="Did not finish" mono>{d.battle?.unfinished ?? 0}</Field>
                  <Field label="Average WPM" mono>{d.battle?.avg_wpm ?? null}</Field>
                  <Field label="Best WPM" mono>{d.battle?.best_wpm ?? null}</Field>
                </FieldGrid>
              </div>

              <MiniTable
                title="Recent Battlefields"
                head={['Room', 'Role', 'Result', 'WPM', 'Accuracy', 'When']}
                rows={(d.battle_history ?? []).map((b) => [
                  b.pin,
                  b.hosted ? 'host' : 'player',
                  b.finished ? (b.rank ? `#${b.rank}` : 'finished') : 'did not finish',
                  b.wpm,
                  `${b.accuracy}%`,
                  relativeTime(b.created_at),
                ])}
                emptyText="This account has not raced in a Battlefield."
              />

              <p className="pt-0.5 text-sm font-bold">Shadow</p>
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
            <div className="space-y-2">
              <FieldGrid cols={4}>
                <Field label="Posts" mono>{d.community?.posts ?? 0}</Field>
                <Field label="Last 7 days" mono>{d.community?.posts_7d ?? 0}</Field>
                <Field label="Rooms shared" mono>{d.community?.shared_rooms ?? 0}</Field>
                <Field label="Removed" mono>{d.community?.removed ?? 0}</Field>
                <Field label="Last post">
                  {d.community?.last_post ? relativeTime(d.community.last_post) : null}
                </Field>
              </FieldGrid>

              {/* Post *text* is moderated in Content, under content.moderate.
                  What this screen answers is whether someone is active and
                  whether they are spraying room links — which is what these
                  columns show without reading anybody's messages. */}
              <MiniTable
                title="Community posts"
                head={['When', 'Shared room', 'Length', 'State']}
                rows={(d.community_posts ?? []).map((p) => [
                  relativeTime(p.created_at),
                  p.battle_pin ?? '—',
                  `${p.body_length} chars`,
                  p.deleted_at ? 'removed' : 'live',
                ])}
                emptyText="This account has not posted in the community."
              />

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
            </div>
          ) : null}

          {tab === 'audit' ? (
            <div className="space-y-2">
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
              {/* Appeals against a room an operator removed. Answering one
                  happens in Arena; seeing it here is what tells an operator
                  this is the fourth time, which Arena's per-room view cannot. */}
              <MiniTable
                title="Room removal appeals"
                head={['Room', 'Removed because', 'Answered', 'Filed']}
                rows={(d.appeals ?? []).map((a) => [
                  a.pin ?? '—',
                  a.removed_reason ?? '—',
                  a.answered ? relativeTime(a.replied_at) : 'open',
                  relativeTime(a.created_at),
                ])}
                emptyText="This account has not appealed a room removal."
              />
            </div>
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
