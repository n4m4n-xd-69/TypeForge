import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search, ShieldAlert } from 'lucide-react';
import { Card, Chip, EmptyState } from '../../components/ui/Primitives.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ChartFrame from '../../components/charts/ChartFrame.jsx';
import { Heatmap } from '../../components/charts/Charts.jsx';
import { humanDuration, relativeTime } from '../../lib/format.js';
import { keyLabel, weakestKeys } from '../../lib/typing.js';
import { fetchAuthEvents, fetchOverview, fetchUserDetail, logAdminView } from './adminApi.js';
import PanelSkeleton from './PanelSkeleton.jsx';

const COLUMNS = [
  { key: 'display_name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'signed_up', label: 'Signed up' },
  { key: 'last_seen', label: 'Last seen' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'total_seconds', label: 'Time' },
  { key: 'xp', label: 'XP' },
  { key: 'streak_best', label: 'Best streak' },
  { key: 'ai_calls', label: 'AI calls' },
];

export default function UsersTab({ adminId }) {
  const [state, setState] = useState({ status: 'loading', users: [] });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'signed_up', dir: 'desc' });
  const [openUserId, setOpenUserId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then((users) => {
        if (!cancelled) setState({ status: 'ready', users });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', users: [], error: err });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = state.users;
    if (q) {
      list = list.filter(
        (u) => u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
      );
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [state.users, query, sort]);

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  if (state.status === 'loading') return <PanelSkeleton />;
  if (state.status === 'error') {
    return (
      <Card className="py-6">
        <EmptyState icon={ShieldAlert} title="Couldn't load users" description={state.error?.message ?? 'Unknown error.'} />
      </Card>
    );
  }

  return (
    <Card className="p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink-3">{rows.length} of {state.users.length} users</p>
        <div className="relative w-full max-w-[280px]">
          <Search size={14} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search users"
            className="h-[36px] w-full rounded-sm bg-subtle/60 pl-4 pr-1.5 text-sm outline-none transition-colors placeholder:text-ink-3 focus:bg-subtle"
            style={{ paddingLeft: 28 }}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No users match" description="Try a different search." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className="px-1 py-1 text-left">
                    <button
                      onClick={() => toggleSort(c.key)}
                      className="flex items-center gap-0.5 text-2xs font-extrabold uppercase tracking-[0.08em] text-ink-3 hover:text-ink"
                    >
                      {c.label}
                      {sort.key === c.key ? (
                        sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setOpenUserId(u.id)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-subtle/60"
                >
                  <td className="px-1 py-1.5 font-semibold">{u.display_name || <span className="text-ink-3">—</span>}</td>
                  <td className="px-1 py-1.5 text-ink-2">{u.email}</td>
                  <td className="px-1 py-1.5 text-ink-3">{relativeTime(u.signed_up)}</td>
                  <td className="px-1 py-1.5 text-ink-3">{u.last_seen ? relativeTime(u.last_seen) : '—'}</td>
                  <td className="px-1 py-1.5 tnum">{u.sessions}</td>
                  <td className="px-1 py-1.5 tnum">{humanDuration(u.total_seconds)}</td>
                  <td className="px-1 py-1.5 tnum text-brand">{u.xp}</td>
                  <td className="px-1 py-1.5 tnum">{u.streak_best}</td>
                  <td className="px-1 py-1.5 tnum">{u.ai_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserDetailModal
        userId={openUserId}
        summary={state.users.find((u) => u.id === openUserId)}
        adminId={adminId}
        onClose={() => setOpenUserId(null)}
      />
    </Card>
  );
}

function UserDetailModal({ userId, summary, adminId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!userId) {
      setDetail(null);
      setEvents([]);
      return;
    }
    let cancelled = false;
    logAdminView(adminId);
    Promise.all([fetchUserDetail(userId), fetchAuthEvents({ userId, limit: 20 })]).then(([d, e]) => {
      if (!cancelled) {
        setDetail(d);
        setEvents(e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, adminId]);

  const days = useMemo(() => {
    const out = {};
    for (const s of detail?.sessions ?? []) {
      const key = new Date(s.ts).toISOString().slice(0, 10);
      out[key] = { seconds: (out[key]?.seconds ?? 0) + (s.duration_sec ?? 0) };
    }
    return out;
  }, [detail]);

  const weak = useMemo(() => {
    const map = {};
    for (const k of detail?.keyStats ?? []) map[k.key] = { total: k.total, wrong: k.wrong };
    return weakestKeys(map, 8, 5);
  }, [detail]);

  return (
    <Modal open={Boolean(userId)} onClose={onClose} title={summary?.display_name || summary?.email || 'User'} size="xl">
      {!detail ? (
        <div className="p-3">
          <PanelSkeleton />
        </div>
      ) : (
        <div className="space-y-2.5 p-2.5">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Sessions" value={summary?.sessions} />
            <Stat label="Time practised" value={humanDuration(summary?.total_seconds ?? 0)} />
            <Stat label="XP" value={summary?.xp} />
            <Stat label="Best streak" value={`${summary?.streak_best ?? 0}d`} />
          </div>

          <ChartFrame title="Practice footprint" height="auto">
            <Heatmap days={days} weeks={26} />
          </ChartFrame>

          <div className="grid gap-2.5 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-bold">Weakest keys</p>
              {weak.length ? (
                <ul className="flex flex-wrap gap-1">
                  {weak.map((k) => (
                    <li key={k.key} className="flex items-center gap-1 rounded-sm border border-line bg-subtle/60 px-1.5 py-1">
                      <span className="font-mono text-base font-bold">{keyLabel(k.key)}</span>
                      <span className="text-xs font-bold text-bad tnum">{Math.round(k.rate * 100)}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">Not enough key data yet.</p>
              )}

              {detail.problems?.length ? (
                <>
                  <p className="mb-1 mt-2.5 text-sm font-bold">Code problems</p>
                  <p className="text-sm text-ink-3">
                    {detail.problems.filter((p) => p.status === 'solved').length} of {detail.problems.length} solved
                  </p>
                </>
              ) : null}
            </div>

            <div>
              <p className="mb-1 text-sm font-bold">Login history</p>
              {events.length ? (
                <ul className="max-h-[180px] space-y-1 overflow-y-auto">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-1 text-sm">
                      <span className="flex items-center gap-1">
                        <Chip tone={e.event === 'failed' ? 'bad' : e.event === 'admin_view' ? 'warn' : 'neutral'}>
                          {e.event}
                        </Chip>
                        {e.provider ? <span className="text-ink-3">{e.provider}</span> : null}
                      </span>
                      <span className="text-ink-3">{relativeTime(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">No recorded auth events yet.</p>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-bold">Recent sessions</p>
            <div className="max-h-[220px] overflow-y-auto overflow-x-auto rounded-sm border border-line">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead className="sticky top-0 bg-subtle">
                  <tr>
                    {['When', 'Kind', 'WPM', 'Accuracy', 'XP'].map((h) => (
                      <th key={h} className="px-1.5 py-1 text-left text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.sessions.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="px-1.5 py-1 text-ink-3">{relativeTime(s.ts)}</td>
                      <td className="px-1.5 py-1">
                        <Chip>{s.language ?? s.kind}</Chip>
                      </td>
                      <td className="px-1.5 py-1 tnum">{Math.round(s.wpm)}</td>
                      <td className="px-1.5 py-1 tnum">{Math.round(s.accuracy)}%</td>
                      <td className="px-1.5 py-1 tnum text-brand">+{s.xp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-2xs text-ink-3">
            No chat transcripts or typed content are ever shown here — PRD 05 §7.3. Verdict metadata only.
          </p>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <Card className="p-1.5">
      <p className="text-2xs font-extrabold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-bold tnum">{value}</p>
    </Card>
  );
}
