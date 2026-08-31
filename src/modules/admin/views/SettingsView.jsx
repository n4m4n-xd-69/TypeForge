import { useMemo, useState } from 'react';
import { Bell, FileClock, Flag, Plus, ShieldCheck, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { cx, relativeTime } from '../../../lib/format.js';
import { Chip } from '../../../components/ui/Primitives.jsx';
import Button from '../../../components/ui/Button.jsx';
import Select from '../../../components/ui/Select.jsx';
import Segmented from '../../../components/ui/Segmented.jsx';
import {
  ConfirmAction, ConsoleTable, Drilldown, Field, FieldGrid, FilterBar,
  Panel, ScopeGate, StateBlock, ViewHeader, useConsole, useConsoleQuery,
} from '../kit/index.js';
import {
  deleteAnnouncement, fetchAnnouncements, fetchAuditLog, fetchConfig, fetchFlags,
  fetchNoticeStats, fetchOperators, fetchOverview, setConfig, setFlag, setUserRole,
  upsertAnnouncement,
} from '../api/console.js';
import { TIER_SCOPES, TIER_SUMMARY } from '../console/scopes.js';

/**
 * Admin & configuration.
 *
 * The two pieces worth calling out:
 *
 * **The tier table below is a display mirror.** `admin_tier_scopes()` in
 * 0014_admin_console.sql is the source of truth — it is what every RPC
 * actually consults — and this copy exists only so an operator can see what a
 * tier grants before they hand it to someone. If the two ever disagree, the
 * SQL wins and this constant is the bug.
 *
 * **The config editor is generated from the row.** `platform_config.schema`
 * carries the input type and its bounds, so adding a setting is an INSERT, not
 * a UI change. That is the whole reason the table exists in that shape.
 */

const AREAS = [
  { value: 'operators', label: 'Operators' },
  { value: 'audit', label: 'Audit log' },
  { value: 'flags', label: 'Feature flags' },
  { value: 'config', label: 'Configuration' },
  { value: 'announcements', label: 'Notices' },
];

export default function SettingsView() {
  const { can } = useConsole();
  const [area, setArea] = useState('operators');

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Settings"
        description="Who can operate this platform, what they have done, and the knobs that change how it behaves."
      >
        <Segmented options={AREAS} value={area} onChange={setArea} label="Settings area" />
      </ViewHeader>

      {area === 'operators' ? <Operators canWrite={can('roles.write')} /> : null}
      {area === 'audit' ? <AuditLog /> : null}
      {area === 'flags' ? <FeatureFlags canWrite={can('config.write')} /> : null}
      {area === 'config' ? <PlatformConfig canWrite={can('config.write')} /> : null}
      {area === 'announcements' ? <Announcements canWrite={can('config.write')} /> : null}
    </div>
  );
}

/* ── operators ─────────────────────────────────────────────────────────── */

function Operators({ canWrite }) {
  const { nonce, refresh, tier } = useConsole();
  const [editing, setEditing] = useState(null);
  const [nextTier, setNextTier] = useState('support');

  /* user_roles carries no name or email, so an operator list built from it
     alone is a column of UUIDs — technically complete and useless for the one
     question the panel exists to answer. The overview function already joins
     auth.users under the same scope, so the identity comes from there. */
  const operators = useConsoleQuery(async () => {
    const [roles, people] = await Promise.all([fetchOperators(), fetchOverview()]);
    const by = new Map(people.map((u) => [u.id, u]));
    return roles.map((r) => ({ ...r, ...(by.get(r.user_id) ?? {}) }));
  }, [nonce]);

  return (
    <>
      <Panel
        title="Operators"
        hint="Accounts with console access and the scopes their tier grants"
        source="user_roles · on demand"
      >
        <StateBlock
          status={operators.status}
          error={operators.error}
          empty={(operators.data ?? []).length === 0}
          emptyIcon={Users}
          emptyTitle="No operators recorded"
          emptyDescription="An owner grants access from a user's profile in the Users module."
          onRetry={operators.reload}
        >
          <ConsoleTable
            columns={[
              {
                key: 'display_name',
                label: 'Account',
                width: '24%',
                render: (o) => (
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {o.display_name || o.email || 'Unknown account'}
                    </span>
                    <span className="block truncate font-mono text-2xs text-ink-3">
                      {o.email ?? o.user_id}
                    </span>
                  </span>
                ),
              },
              {
                key: 'admin_tier',
                label: 'Tier',
                render: (o) => <Chip tone="brand">{o.admin_tier ?? 'admin'}</Chip>,
              },
              {
                key: 'scopes',
                label: 'Scopes granted',
                sortable: false,
                width: '40%',
                render: (o) => (
                  <span className="flex flex-wrap gap-px">
                    {(TIER_SCOPES[o.admin_tier ?? 'admin'] ?? []).map((s) => (
                      <span key={s} className="rounded-xs bg-raised px-0.5 font-mono text-[10px] text-ink-3">
                        {s}
                      </span>
                    ))}
                  </span>
                ),
              },
              { key: 'granted_at', label: 'Granted', align: 'right', render: (o) => <span className="text-ink-3">{relativeTime(o.granted_at)}</span> },
              { key: 'note', label: 'Note' },
            ]}
            rows={operators.data ?? []}
            rowKey={(o) => o.user_id}
            onRowClick={canWrite ? (o) => setEditing(o) : undefined}
            paginate={false}
            minWidth={900}
          />
        </StateBlock>

        <p className="mt-1.5 flex items-start gap-0.5 text-xs text-ink-3">
          <ShieldCheck size={12} className="mt-px shrink-0" aria-hidden />
          You are signed in as <strong className="font-semibold text-ink-2">{tier ?? 'admin'}</strong>. Tier changes are
          owner-only, and the database refuses to let anyone change their own — so a project can never end up with no
          owner.
        </p>
      </Panel>

      <ConfirmAction
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Change operator tier"
        description="Takes effect on this operator's next request."
        confirmLabel="Apply tier"
        onConfirm={async (reason) => {
          await setUserRole(editing.user_id, nextTier === 'none' ? 'user' : 'admin', nextTier === 'none' ? null : nextTier, reason);
          refresh();
        }}
      >
        <label className="block">
          <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">New tier</span>
          <div className="mt-0.5">
            <Select
              value={nextTier}
              onChange={setNextTier}
              label="Tier"
              minWidth={240}
              options={[
                { value: 'none', label: 'Revoke console access' },
                { value: 'support', label: 'Support' },
                { value: 'analyst', label: 'Analyst' },
                { value: 'admin', label: 'Admin' },
                { value: 'owner', label: 'Owner' },
              ]}
            />
          </div>
        </label>
        {nextTier !== 'none' ? (
          <p className="text-xs text-ink-3">{TIER_SUMMARY[nextTier]}</p>
        ) : null}
        {nextTier !== 'none' ? (
          <p className="flex flex-wrap gap-px">
            {(TIER_SCOPES[nextTier] ?? []).map((s) => (
              <span key={s} className="rounded-xs bg-raised px-0.5 font-mono text-[10px] text-ink-3">
                {s}
              </span>
            ))}
          </p>
        ) : null}
      </ConfirmAction>
    </>
  );
}

/* ── audit ─────────────────────────────────────────────────────────────── */

function AuditLog() {
  const { range, nonce } = useConsole();
  const [action, setAction] = useState('');
  const [open, setOpen] = useState(null);

  const log = useConsoleQuery(
    () => fetchAuditLog({ limit: 300, action: action || null, from: range.from, to: range.to }),
    [action, range.from.getTime(), range.to.getTime(), nonce],
  );

  const actions = useMemo(() => {
    const set = new Set((log.data ?? []).map((r) => r.action));
    return [{ value: '', label: 'Any action' }, ...[...set].sort().map((a) => ({ value: a, label: a }))];
  }, [log.data]);

  return (
    <>
      <Panel
        title="Audit log"
        hint="Every console action that changed something, append-only"
        source={`admin_audit_log · ${range.days}d`}
        refreshing={log.isRefreshing}
      >
        <div className="space-y-1.5">
          <FilterBar
            filters={[{ key: 'action', label: 'Action', value: action, defaultValue: '', options: actions, minWidth: 200 }]}
            onFilterChange={(_, v) => setAction(v)}
          />
          <StateBlock
            status={log.status}
            error={log.error}
            empty={(log.data ?? []).length === 0}
            emptyIcon={FileClock}
            emptyTitle="No admin actions in this window"
            emptyDescription="Suspensions, XP corrections, moderation and config changes all land here."
            onRetry={log.reload}
          >
            <ConsoleTable
              columns={[
                { key: 'created_at', label: 'When', render: (r) => <span className="text-ink-3">{relativeTime(r.created_at)}</span> },
                { key: 'actor_email', label: 'Operator', render: (r) => <span className="truncate">{r.actor_email ?? 'deleted account'}</span> },
                { key: 'action', label: 'Action', mono: true },
                {
                  key: 'target_id',
                  label: 'Target',
                  render: (r) =>
                    r.target_type ? (
                      <span className="font-mono text-xs text-ink-3">
                        {r.target_type}:{String(r.target_id ?? '').slice(0, 12)}
                      </span>
                    ) : null,
                },
                { key: 'summary', label: 'Summary', width: '28%' },
                { key: 'reason', label: 'Reason', width: '20%', render: (r) => <span className="text-ink-3">{r.reason ?? '—'}</span> },
              ]}
              rows={log.data ?? []}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpen(r)}
              defaultSort={{ key: 'created_at', dir: 'desc' }}
              csvName="typeforge-audit"
              minWidth={980}
            />
          </StateBlock>
        </div>
      </Panel>

      <Drilldown
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        width="md"
        eyebrow="admin_audit_log"
        title={open?.action ?? 'Audit entry'}
        subtitle={open?.summary}
      >
        {open ? (
          <div className="space-y-2">
            <FieldGrid cols={2}>
              <Field label="Operator">{open.actor_email ?? 'deleted account'}</Field>
              <Field label="When">{new Date(open.created_at).toLocaleString()}</Field>
              <Field label="Target type">{open.target_type}</Field>
              <Field label="Target id" mono>{open.target_id}</Field>
            </FieldGrid>
            {open.reason ? <Field label="Reason">{open.reason}</Field> : null}
            <JsonDiff before={open.before} after={open.after} />
          </div>
        ) : null}
      </Drilldown>
    </>
  );
}

/**
 * Before/after, with the keys that actually changed marked.
 *
 * The audit rows store only the fields the action touched, so this is short by
 * construction — but "short" is not "obvious", and an operator reading back a
 * six-month-old change should not have to diff two JSON blobs by eye.
 */
function JsonDiff({ before, after }) {
  const changed = useMemo(() => {
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    return [...keys].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  }, [before, after]);

  if (!before && !after) return <p className="text-sm text-ink-3">This action recorded no field-level snapshot.</p>;

  return (
    <div className="space-y-1">
      {changed.length ? (
        <p className="flex flex-wrap items-center gap-0.5 text-xs text-ink-3">
          Changed:
          {changed.map((k) => (
            <span key={k} className="rounded-xs bg-brand-wash px-0.5 font-mono text-[10px] text-brand">
              {k}
            </span>
          ))}
        </p>
      ) : null}
      <div className="grid gap-1 sm:grid-cols-2">
        <div>
          <p className="mb-px text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Before</p>
          <pre className="max-h-[220px] overflow-auto rounded-sm border border-line bg-raised/40 p-1.5 font-mono text-xs text-ink-2">
            {before ? JSON.stringify(before, null, 2) : '—'}
          </pre>
        </div>
        <div>
          <p className="mb-px text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">After</p>
          <pre className="max-h-[220px] overflow-auto rounded-sm border border-line bg-raised/40 p-1.5 font-mono text-xs text-ink-2">
            {after ? JSON.stringify(after, null, 2) : '—'}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ── feature flags ─────────────────────────────────────────────────────── */

function FeatureFlags({ canWrite }) {
  const { nonce, refresh } = useConsole();
  const [draft, setDraft] = useState(null);

  const flags = useConsoleQuery(() => fetchFlags(), [nonce]);

  return (
    <>
      <Panel title="Feature flags" hint="Policy, evaluated by the client" source="feature_flags · on demand">
        <div className="space-y-1.5">
          <p className="rounded-sm border border-line bg-raised/40 p-1.5 text-xs text-ink-2">
            Rollout is a percentage bucket the client computes by hashing its own user id, so a flag is a{' '}
            <strong className="font-semibold">policy</strong>, not a hard gate. Anything that must not be reachable
            belongs behind row-level security, not behind a flag.
          </p>

          <StateBlock
            status={flags.status}
            error={flags.error}
            empty={(flags.data ?? []).length === 0}
            emptyIcon={Flag}
            emptyTitle="No flags defined"
            emptyDescription="Flags are seeded by migration and read by the app at startup."
            onRetry={flags.reload}
          >
            <ul className="divide-y divide-line">
              {(flags.data ?? []).map((f) => (
                <li key={f.key} className="flex flex-wrap items-center gap-1 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-0.5">
                      <span className="truncate text-sm font-semibold">{f.label}</span>
                      {f.enabled ? <Chip tone="good">on</Chip> : <Chip>off</Chip>}
                      {f.enabled && f.rollout < 100 ? <Chip tone="warn">{f.rollout}%</Chip> : null}
                      {f.audience !== 'all' ? <Chip tone="accent">{f.audience}</Chip> : null}
                    </span>
                    <span className="mt-px block truncate font-mono text-2xs text-ink-3">{f.key}</span>
                    {f.description ? <span className="block truncate text-xs text-ink-3">{f.description}</span> : null}
                  </span>
                  <ScopeGate can={canWrite} scope="config.write" inline>
                    <Button variant="secondary" onClick={() => setDraft({ ...f })}>
                      Edit
                    </Button>
                  </ScopeGate>
                </li>
              ))}
            </ul>
          </StateBlock>
        </div>
      </Panel>

      <ConfirmAction
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft ? `Update ${draft.label}` : ''}
        description="Clients pick this up on their next load."
        confirmLabel="Save flag"
        onConfirm={async () => {
          await setFlag(draft.key, draft.enabled, draft.rollout, draft.audience);
          refresh();
        }}
      >
        {draft ? (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="h-[15px] w-[15px] accent-[rgb(var(--brand-solid))]"
              />
              <span className="text-sm font-semibold">Enabled</span>
            </label>
            <label className="block">
              <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                Rollout — {draft.rollout}% of users
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.rollout}
                onChange={(e) => setDraft({ ...draft, rollout: Number(e.target.value) })}
                className="mt-0.5 w-full accent-[rgb(var(--brand-solid))]"
              />
            </label>
            <label className="block">
              <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Audience</span>
              <div className="mt-0.5">
                <Select
                  value={draft.audience}
                  onChange={(v) => setDraft({ ...draft, audience: v })}
                  label="Audience"
                  minWidth={200}
                  options={[
                    { value: 'all', label: 'Everyone' },
                    { value: 'beta', label: 'Beta users' },
                    { value: 'admins', label: 'Admins only' },
                  ]}
                />
              </div>
            </label>
          </div>
        ) : null}
      </ConfirmAction>
    </>
  );
}

/* ── platform config ───────────────────────────────────────────────────── */

function PlatformConfig({ canWrite }) {
  const { nonce, refresh } = useConsole();
  const [draft, setDraft] = useState(null);

  const config = useConsoleQuery(() => fetchConfig(), [nonce]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of config.data ?? []) {
      if (!map.has(row.category)) map.set(row.category, []);
      map.get(row.category).push(row);
    }
    return [...map.entries()];
  }, [config.data]);

  return (
    <>
      <Panel
        title="Platform configuration"
        hint="Editors are generated from each row's schema, so a new setting ships without a UI change"
        source="platform_config · on demand"
      >
        <StateBlock
          status={config.status}
          error={config.error}
          empty={groups.length === 0}
          emptyIcon={SlidersHorizontal}
          emptyTitle="No configuration rows"
          emptyDescription="Settings are seeded by migration."
          onRetry={config.reload}
        >
          <div className="space-y-2">
            {groups.map(([category, rows]) => (
              <div key={category}>
                <p className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-ink-3">{category}</p>
                <ul className="divide-y divide-line rounded-sm border border-line">
                  {rows.map((row) => (
                    <li key={row.key} className="flex flex-wrap items-center gap-1 px-1.5 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{row.label}</span>
                        <span className="block truncate font-mono text-2xs text-ink-3">{row.key}</span>
                        {row.description ? (
                          <span className="block truncate text-xs text-ink-3">{row.description}</span>
                        ) : null}
                      </span>
                      <span className="font-mono text-lg font-medium tnum">{String(row.value)}</span>
                      <ScopeGate can={canWrite} scope="config.write" inline>
                        <Button variant="secondary" onClick={() => setDraft({ ...row, next: row.value })}>
                          Change
                        </Button>
                      </ScopeGate>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </StateBlock>
      </Panel>

      <ConfirmAction
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft ? `Change ${draft.label}` : ''}
        description="Applies to every request the platform handles after it is saved."
        confirmLabel="Save setting"
        onConfirm={async () => {
          // The column is jsonb and the schema says this is a number, so send a
          // number — a quoted string would type-check as valid JSON and then
          // silently fail every comparison the backend makes against it.
          const value = draft.schema?.type === 'number' ? Number(draft.next) : draft.next;
          await setConfig(draft.key, value);
          refresh();
        }}
      >
        {draft ? (
          <label className="block">
            <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
              {draft.label}
              {draft.schema?.min != null ? ` (${draft.schema.min}–${draft.schema.max})` : ''}
            </span>
            <input
              data-autofocus
              type={draft.schema?.type === 'number' ? 'number' : 'text'}
              min={draft.schema?.min}
              max={draft.schema?.max}
              step={draft.schema?.step ?? 1}
              value={draft.next ?? ''}
              onChange={(e) => setDraft({ ...draft, next: e.target.value })}
              className="mt-0.5 h-[36px] w-full rounded-sm border border-line bg-raised/50 px-1.5 font-mono text-base tnum outline-none focus:border-line-strong focus:bg-raised"
            />
            <span className="mt-0.5 block font-mono text-xs text-ink-3">
              {String(draft.value)} → {String(draft.next)}
            </span>
          </label>
        ) : null}
      </ConfirmAction>
    </>
  );
}

/* ── announcements ─────────────────────────────────────────────────────── */

function Announcements({ canWrite }) {
  const { nonce, refresh } = useConsole();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);

  const list = useConsoleQuery(() => fetchAnnouncements(), [nonce]);
  const stats = useConsoleQuery(() => fetchNoticeStats(), [nonce]);
  /* The target picker needs real accounts. Registered only: a notice aimed at
     a throwaway guest session is delivered to a session that will not return. */
  const people = useConsoleQuery(
    async () => (await fetchOverview()).filter((u) => !u.is_guest && u.status !== 'deleted'),
    [nonce],
  );

  const statBy = useMemo(
    () => new Map((stats.data ?? []).map((r) => [r.id, r])),
    [stats.data],
  );

  const state = (a) => {
    if (!a.published) return { label: 'draft', tone: 'neutral' };
    const now = Date.now();
    if (new Date(a.starts_at).getTime() > now) return { label: 'scheduled', tone: 'accent' };
    if (a.ends_at && new Date(a.ends_at).getTime() < now) return { label: 'expired', tone: 'neutral' };
    return { label: 'live', tone: 'good' };
  };

  return (
    <>
      <Panel
        title="Announcements"
        hint="Messages shown in-product to the chosen audience"
        source="announcements · on demand"
        action={
          <ScopeGate can={canWrite} scope="config.write" inline>
            <Button
              variant="secondary"
              onClick={() =>
                setEditing({
                  id: null, title: '', body: '', tone: 'info', audience: 'all',
                  published: false, frequency: 'once', target_user_id: '', dismissible: true,
                })
              }
            >
              <Plus size={13} aria-hidden />
              New
            </Button>
          </ScopeGate>
        }
      >
        <StateBlock
          status={list.status}
          error={list.error}
          empty={(list.data ?? []).length === 0}
          emptyIcon={Bell}
          emptyTitle="No announcements"
          emptyDescription="Write one to tell everyone about maintenance, a new mode, or an incident."
          onRetry={list.reload}
        >
          <ul className="divide-y divide-line">
            {(list.data ?? []).map((a) => {
              const s = state(a);
              return (
                <li key={a.id} className="flex flex-wrap items-start gap-1 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-0.5">
                      <span className="truncate text-sm font-semibold">{a.title}</span>
                      <Chip tone={s.tone}>{s.label}</Chip>
                      <Chip tone={a.tone === 'critical' ? 'bad' : a.tone === 'warn' ? 'warn' : 'accent'}>{a.tone}</Chip>
                      {a.target_user_id ? <Chip tone="brand">one account</Chip> : a.audience !== 'all' ? <Chip>{a.audience}</Chip> : null}
                      <Chip tone={a.frequency === 'every_time' ? 'warn' : 'neutral'}>
                        {a.frequency === 'every_time' ? 'every visit' : 'once'}
                      </Chip>
                    </span>
                    <span className="mt-px block truncate text-xs text-ink-3">{a.body}</span>
                    <span className="block font-mono text-2xs text-ink-3">
                      {new Date(a.starts_at).toLocaleDateString()}
                      {a.ends_at ? ` → ${new Date(a.ends_at).toLocaleDateString()}` : ' → no end'}
                      {statBy.get(a.id)
                        ? ` · seen by ${statBy.get(a.id).seen_by}, dismissed by ${statBy.get(a.id).dismissed_by}`
                        : ''}
                    </span>
                  </span>
                  <ScopeGate can={canWrite} scope="config.write" inline>
                    <span className="flex gap-1">
                      <Button variant="secondary" onClick={() => setEditing({ ...a })}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setDeleting(a)}>
                        <Trash2 size={13} aria-hidden />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </span>
                  </ScopeGate>
                </li>
              );
            })}
          </ul>
        </StateBlock>
      </Panel>

      <Drilldown
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        width="md"
        eyebrow="announcements"
        title={editing?.id ? 'Edit announcement' : 'New announcement'}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setSaving(true)}>
              Save
            </Button>
          </div>
        }
      >
        {editing ? (
          <div className="space-y-1.5">
            <label className="block">
              <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Title</span>
              <input
                data-autofocus
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="mt-0.5 h-[34px] w-full rounded-sm border border-line bg-raised/50 px-1.5 text-sm outline-none focus:border-line-strong focus:bg-raised"
              />
            </label>
            <label className="block">
              <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Body</span>
              <textarea
                rows={4}
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                className="mt-0.5 w-full resize-y rounded-sm border border-line bg-raised/50 px-1.5 py-1 text-sm outline-none focus:border-line-strong focus:bg-raised"
              />
            </label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <label className="block">
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Tone</span>
                <div className="mt-0.5">
                  <Select
                    value={editing.tone}
                    onChange={(v) => setEditing({ ...editing, tone: v })}
                    label="Tone"
                    options={[
                      { value: 'info', label: 'Info' },
                      { value: 'success', label: 'Success' },
                      { value: 'warn', label: 'Warning' },
                      { value: 'critical', label: 'Critical' },
                    ]}
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">How often</span>
                <div className="mt-0.5">
                  <Select
                    value={editing.frequency}
                    onChange={(v) =>
                      setEditing({
                        ...editing,
                        frequency: v,
                        // The database refuses a permanent notice that returns
                        // on every visit; keep the form from offering it.
                        dismissible: v === 'every_time' ? true : editing.dismissible,
                      })
                    }
                    label="Frequency"
                    options={[
                      { value: 'once', label: 'Once — until they close it' },
                      { value: 'every_time', label: 'Every visit' },
                    ]}
                  />
                </div>
              </label>
            </div>

            {/* Who sees it. A named account overrides the audience entirely,
                so the two controls are stacked rather than side by side —
                picking a person should visibly retire the broader choice. */}
            <label className="block">
              <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Send to</span>
              <div className="mt-0.5">
                <Select
                  value={editing.target_user_id ? 'one' : editing.audience}
                  onChange={(v) =>
                    setEditing({
                      ...editing,
                      audience: v === 'one' ? editing.audience : v,
                      target_user_id: v === 'one' ? editing.target_user_id || ' ' : '',
                    })
                  }
                  label="Recipients"
                  minWidth={240}
                  options={[
                    { value: 'all', label: 'Everyone' },
                    { value: 'beta', label: 'Beta users' },
                    { value: 'admins', label: 'Admins only' },
                    { value: 'one', label: 'One specific person' },
                  ]}
                />
              </div>
            </label>

            {editing.target_user_id ? (
              <label className="block">
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Which account</span>
                <div className="mt-0.5">
                  <Select
                    value={editing.target_user_id.trim()}
                    onChange={(v) => setEditing({ ...editing, target_user_id: v })}
                    label="Account"
                    minWidth={240}
                    options={[
                      { value: '', label: 'Choose an account…' },
                      ...(people.data ?? []).map((u) => ({
                        value: u.id,
                        label: u.display_name ? `${u.display_name} · ${u.email}` : u.email,
                      })),
                    ]}
                  />
                </div>
                <span className="mt-px block text-xs text-ink-3">
                  Only this person sees it. The audience setting is ignored.
                </span>
              </label>
            ) : null}
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={Boolean(editing.published)}
                onChange={(e) => setEditing({ ...editing, published: e.target.checked })}
                className="h-[15px] w-[15px] accent-[rgb(var(--brand-solid))]"
              />
              <span className="text-sm font-semibold">Published — visible to the recipients above</span>
            </label>

            <label className={cx('flex items-center gap-1', editing.frequency === 'every_time' && 'opacity-50')}>
              <input
                type="checkbox"
                checked={editing.dismissible !== false}
                disabled={editing.frequency === 'every_time'}
                onChange={(e) => setEditing({ ...editing, dismissible: e.target.checked })}
                className="h-[15px] w-[15px] accent-[rgb(var(--brand-solid))]"
              />
              <span className="text-sm font-semibold">
                Dismissible
                {editing.frequency === 'every_time' ? (
                  <span className="ml-0.5 font-normal text-ink-3">— required when shown every visit</span>
                ) : null}
              </span>
            </label>
          </div>
        ) : null}
      </Drilldown>

      <ConfirmAction
        open={saving}
        onClose={() => setSaving(false)}
        title={editing?.published ? 'Publish this announcement' : 'Save as draft'}
        description={
          editing?.published ? 'It becomes visible to the selected audience immediately.' : 'Nobody sees a draft.'
        }
        confirmLabel="Save"
        onConfirm={async () => {
          // ' ' is the picker's "targeted but not yet chosen" state. Sending it
          // would silently broadcast a message written for one person.
          if (editing.target_user_id && !editing.target_user_id.trim()) {
            throw new Error('Choose which account this notice is for, or send it to everyone.');
          }
          await upsertAnnouncement(editing);
          refresh();
          setEditing(null);
        }}
      />

      <ConfirmAction
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this announcement"
        confirmLabel="Delete"
        tone="danger"
        confirmPhrase={deleting?.title ?? ''}
        onConfirm={async () => {
          await deleteAnnouncement(deleting.id);
          refresh();
        }}
      />
    </>
  );
}
