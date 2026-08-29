import { useMemo, useState } from 'react';
import {
  AlertOctagon, Bot, CircleDollarSign, KeyRound, Plug, RotateCcw, Timer, Zap,
} from 'lucide-react';
import { cx, relativeTime } from '../../../lib/format.js';
import { Chip, ProgressBar } from '../../../components/ui/Primitives.jsx';
import Button from '../../../components/ui/Button.jsx';
import Select from '../../../components/ui/Select.jsx';
import {
  ConfirmAction, ConsoleTable, Drilldown, Field, FieldGrid,
  MetricRack, MetricTile, Panel, ScopeGate, StateBlock, ViewHeader,
  useConsole, useConsoleQuery, usePolling,
} from '../kit/index.js';
import {
  clearProviderKey, deleteModel, deleteProvider, fetchBudget, fetchKeyStatus, fetchKpis,
  fetchModelHealth, fetchModels, fetchModelStats, fetchProviders, resetModelHealth,
  setProviderKey, upsertModel, upsertProvider,
} from '../api/console.js';

/**
 * AI & model control centre.
 *
 * The load-bearing constraint, stated once here and enforced by the schema:
 * **no API key passes through this screen.** `ai_providers` stores the *name*
 * of an Edge Function secret, never its value, and `admin_upsert_provider`
 * rejects a `secret_ref` that does not look like an environment variable name
 * — so even a compromised console cannot be used to exfiltrate or plant a key.
 * What an operator gets instead is enough to answer "is this configured, and
 * is it the key I think it is": a presence flag and a four-character tail,
 * both written server-side by the function that can actually see the secret.
 *
 * The second rule is inherited from costs.js: a model with no configured rate
 * is reported as unrated. It is never counted as free, because a $0 line in a
 * spend table is a number someone will budget against.
 */

const LANES = [
  { value: 'general', label: 'General' },
  { value: 'chat', label: 'Chat' },
  { value: 'passage', label: 'Passage' },
  { value: 'snippet', label: 'Snippet' },
  { value: 'insight', label: 'Insight' },
  { value: 'embed', label: 'Embedding' },
];

const money = (n) =>
  n == null ? null : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

export default function AiControlView() {
  const { range, nonce, refresh, can } = useConsole();
  const [editing, setEditing] = useState(null);
  const [editingProvider, setEditingProvider] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const kpis = useConsoleQuery(
    () => fetchKpis(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const stats = useConsoleQuery(
    () => fetchModelStats(range.from, range.to),
    [range.from.getTime(), range.to.getTime(), nonce],
  );
  const models = useConsoleQuery(() => fetchModels(), [nonce]);
  const providers = useConsoleQuery(() => fetchProviders(), [nonce]);
  const health = useConsoleQuery(() => fetchModelHealth(), [nonce]);
  const keyStatus = useConsoleQuery(() => fetchKeyStatus(), [nonce]);
  const budget = useConsoleQuery(() => fetchBudget({ days: 14 }), [nonce]);

  usePolling(health.reload, 15_000);

  const k = kpis.data ?? {};
  const statRows = stats.data ?? [];

  const spend = useMemo(() => {
    let total = 0;
    let unrated = 0;
    let rated = 0;
    for (const r of statRows) {
      if (r.est_cost == null) unrated += Number(r.calls) || 0;
      else {
        total += Number(r.est_cost);
        rated += Number(r.calls) || 0;
      }
    }
    return { total, unrated, rated };
  }, [statRows]);

  const failureRate = k.ai_calls ? (k.ai_failures / k.ai_calls) * 100 : null;

  const vaultByProvider = useMemo(
    () => new Map((keyStatus.data ?? []).map((k) => [k.provider_id, k])),
    [keyStatus.data],
  );

  const now = Date.now();
  const openBreakers = (health.data ?? []).filter((h) => h.open_until && new Date(h.open_until).getTime() > now);

  return (
    <div className="space-y-2">
      <ViewHeader
        title="AI control"
        description="Providers, models, routing and spend. Keys are never stored, transported or displayed here."
      />

      <MetricRack cols={5}>
        <MetricTile
          icon={Bot}
          label="Calls"
          value={k.ai_calls}
          loading={kpis.status === 'loading'}
          source={`ai_usage · ${range.days}d`}
        />
        <MetricTile
          icon={AlertOctagon}
          label="Failure rate"
          value={failureRate}
          suffix="%"
          decimals={1}
          invert
          hint={k.ai_calls ? `${k.ai_failures} failed calls` : 'no calls in range'}
          source="ai_usage.ok"
        />
        <MetricTile
          icon={Zap}
          label="Tokens"
          value={k.ai_tokens}
          source="prompt + output"
        />
        <MetricTile
          icon={Timer}
          label="Latency p95"
          value={k.ai_p95_ms}
          suffix=" ms"
          invert
          hint={k.ai_p50_ms != null ? `p50 ${Number(k.ai_p50_ms).toLocaleString()} ms` : null}
          source="ai_usage.latency_ms"
        />
        {/* Unrated calls are surfaced on the tile itself, not buried in a
            footnote — the estimate is only meaningful alongside how much of
            the traffic it could not price. */}
        <MetricTile
          icon={CircleDollarSign}
          label="Estimated spend"
          value={spend.rated ? spend.total : null}
          prefix="$"
          decimals={4}
          compact={false}
          unavailable={spend.rated ? null : 'no rated calls'}
          hint={spend.unrated ? `${spend.unrated.toLocaleString()} calls unrated` : 'all calls priced'}
          source="ai_models.*_cost_per_1k"
        />
      </MetricRack>

      {openBreakers.length ? (
        <p className="flex flex-wrap items-center gap-1 rounded-md border border-warn/40 bg-warn/[0.07] px-2 py-1.5 text-sm">
          <AlertOctagon size={15} className="shrink-0 text-warn" aria-hidden />
          <strong className="font-semibold">
            {openBreakers.length} circuit breaker{openBreakers.length > 1 ? 's' : ''} open.
          </strong>
          <span className="text-ink-2">
            The router is skipping {openBreakers.map((b) => b.model).join(', ')} until it recovers.
          </span>
        </p>
      ) : null}

      <Panel
        title="Providers"
        hint="Upstream services the router can reach"
        source="ai_providers · on demand"
        action={
          <ScopeGate can={can('ai.write')} scope="ai.write" inline>
            <Button
              variant="secondary"
              onClick={() =>
                setEditingProvider({ id: '', label: '', secret_ref: '', base_url: '', enabled: true, priority: 100 })
              }
            >
              <Plug size={13} aria-hidden />
              Add provider
            </Button>
          </ScopeGate>
        }
      >
        <div className="space-y-1.5">
          <p className="flex items-start gap-1 rounded-sm border border-line bg-raised/40 p-1.5 text-xs text-ink-2">
            <KeyRound size={14} className="mt-px shrink-0 text-ink-3" aria-hidden />
            <span>
              Keys live in Supabase Edge Function secrets and are readable only inside a function. Set one with{' '}
              <code className="font-mono text-ink">supabase secrets set &lt;SECRET_NAME&gt;=…</code> using the name in
              the Key column. This table stores the secret&apos;s variable name, not its value — there is no field
              here that accepts a key, by design.
            </span>
          </p>

          <StateBlock
            status={providers.status}
            error={providers.error}
            empty={(providers.data ?? []).length === 0}
            emptyIcon={Plug}
            emptyTitle="No providers configured"
            emptyDescription="Add one to give the router somewhere to send requests."
            onRetry={providers.reload}
          >
            <ConsoleTable
              columns={[
                { key: 'label', label: 'Provider', render: (p) => <span className="font-semibold">{p.label}</span> },
                { key: 'id', label: 'ID', mono: true },
                {
                  key: 'key_present',
                  label: 'Key',
                  sortable: false,
                  render: (p) => {
                    // `in_vault` is what the runtime can actually read; a row
                    // claiming a key that Vault does not hold is the failure
                    // mode worth surfacing loudly.
                    const vault = vaultByProvider.get(p.id);
                    const live = vault?.in_vault || p.key_present;
                    return (
                      <span className="flex items-center gap-0.5">
                        {live ? <Chip tone="good">configured</Chip> : <Chip tone="warn">not set</Chip>}
                        <span className="font-mono text-2xs text-ink-3">
                          {live && p.key_tail ? `••••${p.key_tail}` : p.secret_ref}
                        </span>
                      </span>
                    );
                  },
                },
                {
                  key: 'key_rotated_at',
                  label: 'Rotated',
                  align: 'right',
                  render: (p) => <span className="text-ink-3">{p.key_rotated_at ? relativeTime(p.key_rotated_at) : 'never'}</span>,
                },
                { key: 'priority', label: 'Priority', align: 'right', mono: true },
                {
                  key: 'day_limit',
                  label: 'Daily cap',
                  align: 'right',
                  mono: true,
                  render: (p) => (p.day_limit == null ? <span className="text-ink-3">uncapped</span> : p.day_limit.toLocaleString()),
                },
                {
                  key: 'enabled',
                  label: 'State',
                  render: (p) => (
                    <span className="flex items-center gap-0.5">
                      {p.enabled ? <Chip tone="good">enabled</Chip> : <Chip>disabled</Chip>}
                      {/* A custom row is configuration only until providers.ts
                          learns how to talk to it. Saying so beats implying
                          parity with a built-in. */}
                      {p.is_builtin ? null : <Chip tone="warn">custom</Chip>}
                    </span>
                  ),
                },
              ]}
              rows={providers.data ?? []}
              rowKey={(p) => p.id}
              onRowClick={can('ai.write') ? (p) => setEditingProvider({ ...p }) : undefined}
              paginate={false}
              minWidth={860}
            />
          </StateBlock>
        </div>
      </Panel>

      <Panel
        title="Models"
        hint="Usage, health and estimated cost per model over the current window"
        source={`admin_model_stats · ${range.days}d · health 15s`}
        refreshing={stats.isRefreshing}
        action={
          <ScopeGate can={can('ai.write')} scope="ai.write" inline>
            <Button
              variant="secondary"
              onClick={() =>
                setEditing({
                  id: '',
                  provider_id: (providers.data ?? [])[0]?.id ?? '',
                  model: '',
                  label: '',
                  lane: 'general',
                  enabled: true,
                  priority: 100,
                })
              }
            >
              Add model
            </Button>
          </ScopeGate>
        }
      >
        <StateBlock status={models.status} error={models.error} onRetry={models.reload} rows={6}>
          <ModelsTable
            models={models.data ?? []}
            stats={statRows}
            health={health.data ?? []}
            onEdit={can('ai.write') ? (m) => setEditing({ ...m }) : undefined}
            onReset={can('ai.write') ? (m) => setConfirm({ kind: 'reset', model: m }) : undefined}
          />
        </StateBlock>
      </Panel>

      <div className="grid gap-2 lg:grid-cols-2">
        <Panel
          title="Routing"
          hint="What the router tries, in order, for each lane"
          source="ai_models.lane + priority"
        >
          <RoutingMap models={models.data ?? []} />
        </Panel>

        <Panel title="Daily budget" hint="Requests and tokens charged per provider" source="forge_budget · daily">
          <StateBlock
            status={budget.status}
            error={budget.error}
            empty={(budget.data ?? []).length === 0}
            emptyTitle="No budget rows yet"
            emptyDescription="The forge functions write one row per provider per day as they spend."
            onRetry={budget.reload}
          >
            <ul className="space-y-1.5">
              {(budget.data ?? []).slice(0, 10).map((b) => (
                <li key={`${b.provider}-${b.day}`}>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-semibold">
                      {b.provider}
                      <span className="ml-0.5 font-mono text-2xs text-ink-3">{String(b.day).slice(0, 10)}</span>
                    </span>
                    <span className="font-mono text-xs tnum text-ink-2">
                      {Number(b.requests).toLocaleString()}
                      {b.day_limit ? ` / ${Number(b.day_limit).toLocaleString()}` : ''} req
                      <span className="ml-1 text-ink-3">{Number(b.tokens).toLocaleString()} tok</span>
                    </span>
                  </div>
                  {b.day_limit ? (
                    <ProgressBar
                      value={b.requests / b.day_limit}
                      tone={b.requests / b.day_limit > 0.85 ? 'warn' : 'accent'}
                      className="mt-0.5"
                      label={`${b.provider} daily usage`}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </StateBlock>
        </Panel>
      </div>

      <ModelEditor
        model={editing}
        models={models.data ?? []}
        providers={providers.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        canDelete={can('ai.write')}
      />

      <ProviderEditor
        provider={editingProvider}
        vault={editingProvider ? vaultByProvider.get(editingProvider.id) : null}
        canWrite={can('ai.write')}
        onClose={() => setEditingProvider(null)}
        onSaved={refresh}
      />

      <ConfirmAction
        open={confirm?.kind === 'reset'}
        onClose={() => setConfirm(null)}
        title="Reset the circuit breaker"
        description={`The router will start sending traffic to ${confirm?.model?.model} again immediately.`}
        confirmLabel="Reset breaker"
        onConfirm={async () => {
          await resetModelHealth(confirm.model.provider_id ?? confirm.model.provider, confirm.model.model);
          refresh();
        }}
      />
    </div>
  );
}

function ModelsTable({ models, stats, health, onEdit, onReset }) {
  const now = Date.now();

  const rows = useMemo(() => {
    const statBy = new Map(stats.map((s) => [`${s.provider}:${s.model}`, s]));
    const healthBy = new Map(health.map((h) => [`${h.provider}:${h.model}`, h]));
    return models.map((m) => {
      const key = `${m.provider_id}:${m.model}`;
      const s = statBy.get(key) ?? {};
      const h = healthBy.get(key) ?? {};
      return {
        ...m,
        calls: Number(s.calls ?? 0),
        failures: Number(s.failures ?? 0),
        tokens: Number(s.tokens ?? 0),
        p50: s.p50_ms == null ? null : Number(s.p50_ms),
        p95: s.p95_ms == null ? null : Number(s.p95_ms),
        est_cost: s.est_cost == null ? null : Number(s.est_cost),
        open_until: h.open_until ?? null,
        consecutive_fail: h.consecutive_fail ?? 0,
        last_reason: h.last_reason ?? null,
      };
    });
  }, [models, stats, health]);

  return (
    <ConsoleTable
      columns={[
        {
          key: 'label',
          label: 'Model',
          width: '22%',
          render: (m) => (
            <span className="min-w-0">
              <span className="block truncate font-semibold">{m.label}</span>
              <span className="block truncate font-mono text-2xs text-ink-3">{m.model}</span>
            </span>
          ),
        },
        { key: 'provider_id', label: 'Provider', mono: true },
        { key: 'lane', label: 'Lane', render: (m) => <Chip tone="accent">{m.lane}</Chip> },
        { key: 'priority', label: 'Pri', align: 'right', mono: true },
        { key: 'calls', label: 'Calls', align: 'right', mono: true, render: (m) => m.calls.toLocaleString() },
        {
          key: 'failures',
          label: 'Fails',
          align: 'right',
          mono: true,
          render: (m) => (
            <span className={cx(m.failures > 0 && 'text-bad')}>
              {/* No calls means no failure rate — not a zero percent one. */}
              {m.calls ? `${m.failures} · ${Math.round((m.failures / m.calls) * 100)}%` : '—'}
            </span>
          ),
        },
        {
          key: 'p95',
          label: 'p50 / p95',
          align: 'right',
          mono: true,
          render: (m) => (m.calls ? `${m.p50 ?? 0} / ${m.p95 ?? 0}` : '—'),
        },
        { key: 'tokens', label: 'Tokens', align: 'right', mono: true, render: (m) => m.tokens.toLocaleString() },
        {
          key: 'est_cost',
          label: 'Est. cost',
          align: 'right',
          mono: true,
          render: (m) =>
            m.est_cost == null ? (
              <span className="text-ink-3" title="No rate is configured for this model">
                unrated
              </span>
            ) : (
              money(m.est_cost)
            ),
        },
        {
          key: 'open_until',
          label: 'State',
          sortable: false,
          render: (m) => {
            const tripped = m.open_until && new Date(m.open_until).getTime() > now;
            if (tripped) {
              return (
                <span className="flex items-center gap-0.5">
                  <Chip tone="bad">breaker open</Chip>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReset?.(m);
                    }}
                    disabled={!onReset}
                    title={m.last_reason || 'Reset the breaker'}
                    className="grid h-[20px] w-[20px] place-items-center rounded-xs border border-line text-ink-3 hover:text-ink disabled:opacity-40"
                  >
                    <RotateCcw size={11} aria-hidden />
                    <span className="sr-only">Reset breaker</span>
                  </button>
                </span>
              );
            }
            if (!m.enabled) return <Chip>disabled</Chip>;
            if (m.consecutive_fail > 0) return <Chip tone="warn">{m.consecutive_fail} recent fails</Chip>;
            return <Chip tone="good">healthy</Chip>;
          },
        },
      ]}
      rows={rows}
      rowKey={(m) => m.id}
      onRowClick={onEdit}
      defaultSort={{ key: 'calls', dir: 'desc' }}
      csvName="typeforge-models"
      paginate={false}
      minWidth={1080}
    />
  );
}

/**
 * The routing map answers a question the tables cannot: given a request on
 * this lane, what will actually be tried, and in what order. It is derived
 * rather than configured, so it cannot drift from the rows above it.
 */
function RoutingMap({ models }) {
  const byLane = useMemo(() => {
    const map = new Map();
    for (const m of models) {
      if (!m.enabled) continue;
      if (!map.has(m.lane)) map.set(m.lane, []);
      map.get(m.lane).push(m);
    }
    for (const list of map.values()) list.sort((a, b) => a.priority - b.priority);
    return map;
  }, [models]);

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  if (byLane.size === 0) {
    return <p className="text-sm text-ink-3">No model is enabled, so the router has nothing to try.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {[...byLane.entries()].map(([lane, list]) => (
        <li key={lane}>
          <p className="mb-0.5 font-mono text-2xs uppercase tracking-[0.1em] text-ink-3">{lane}</p>
          <ol className="flex flex-wrap items-center gap-0.5">
            {list.map((m, i) => (
              <li key={m.id} className="flex items-center gap-0.5">
                {i > 0 ? <span className="font-mono text-2xs text-ink-3">→</span> : null}
                <span className="rounded-xs border border-line bg-raised/60 px-1 py-px text-xs font-semibold">
                  {m.label}
                  {m.fallback_id && byId.get(m.fallback_id) ? (
                    <span className="ml-0.5 font-mono text-[10px] text-ink-3">
                      ↳ {byId.get(m.fallback_id).label}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

function ModelEditor({ model, models, providers, onClose, onSaved, canDelete }) {
  const [draft, setDraft] = useState(model);
  const [confirming, setConfirming] = useState(null);

  const current = draft?.id === model?.id ? draft : model;
  const set = (patch) => setDraft({ ...(current ?? {}), ...patch });

  if (!model) return null;

  const isNew = !model.id;

  return (
    <>
      <Drilldown
        open
        onClose={onClose}
        width="md"
        eyebrow="ai_models"
        title={isNew ? 'Add a model' : current.label}
        subtitle={current.model}
        footer={
          <div className="flex items-center justify-between gap-1">
            {!isNew && canDelete ? (
              <Button variant="danger" onClick={() => setConfirming('delete')}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={() => setConfirming('save')}>
              {isNew ? 'Create model' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <div className="space-y-1.5">
          <TextField label="Model id (unique)" value={current.id} disabled={!isNew} onChange={(v) => set({ id: v })} mono />
          <label className="block">
            <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Provider</span>
            <div className="mt-0.5">
              <Select
                value={current.provider_id}
                onChange={(v) => set({ provider_id: v })}
                label="Provider"
                minWidth={220}
                options={providers.map((p) => ({ value: p.id, label: p.label }))}
              />
            </div>
          </label>
          <TextField label="Provider's model name" value={current.model} onChange={(v) => set({ model: v })} mono />
          <TextField label="Display label" value={current.label} onChange={(v) => set({ label: v })} />
          <label className="block">
            <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Lane</span>
            <div className="mt-0.5">
              <Select value={current.lane} onChange={(v) => set({ lane: v })} label="Lane" minWidth={220} options={LANES} />
            </div>
          </label>
          <label className="block">
            <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Fallback model</span>
            <div className="mt-0.5">
              <Select
                value={current.fallback_id ?? ''}
                onChange={(v) => set({ fallback_id: v || null })}
                label="Fallback"
                minWidth={220}
                options={[
                  { value: '', label: 'None' },
                  ...models.filter((m) => m.id !== current.id).map((m) => ({ value: m.id, label: m.label })),
                ]}
              />
            </div>
          </label>

          <FieldGrid cols={2}>
            <NumberField label="Priority (lower wins)" value={current.priority} onChange={(v) => set({ priority: v })} />
            <NumberField label="Max tokens" value={current.max_tokens} onChange={(v) => set({ max_tokens: v })} />
            <NumberField label="Temperature" step="0.1" value={current.temperature} onChange={(v) => set({ temperature: v })} />
            <NumberField label="Top P" step="0.05" value={current.top_p} onChange={(v) => set({ top_p: v })} />
            <NumberField
              label="Input $/1k"
              step="0.0001"
              value={current.input_cost_per_1k}
              onChange={(v) => set({ input_cost_per_1k: v })}
              hint="Leave blank for unrated"
            />
            <NumberField
              label="Output $/1k"
              step="0.0001"
              value={current.output_cost_per_1k}
              onChange={(v) => set({ output_cost_per_1k: v })}
              hint="Leave blank for unrated"
            />
            <NumberField label="Context window" value={current.context_window} onChange={(v) => set({ context_window: v })} />
          </FieldGrid>

          <label className="flex items-center gap-1 pt-0.5">
            <input
              type="checkbox"
              checked={Boolean(current.enabled)}
              onChange={(e) => set({ enabled: e.target.checked })}
              className="h-[15px] w-[15px] accent-[rgb(var(--brand-solid))]"
            />
            <span className="text-sm font-semibold">Enabled — the router may select this model</span>
          </label>

          <p className="text-xs text-ink-3">
            Leaving a cost blank is meaningful: the model is reported as unrated everywhere rather than counted as free.
          </p>
        </div>
      </Drilldown>

      <ConfirmAction
        open={confirming === 'save'}
        onClose={() => setConfirming(null)}
        title={isNew ? 'Create this model' : 'Save model changes'}
        description="Routing takes effect on the next request the forge functions handle."
        confirmLabel="Save"
        onConfirm={async () => {
          await upsertModel(current);
          onSaved?.();
          onClose();
        }}
      />

      <ConfirmAction
        open={confirming === 'delete'}
        onClose={() => setConfirming(null)}
        title="Delete this model"
        description="Any model that falls back to it will have its fallback cleared."
        confirmLabel="Delete model"
        tone="danger"
        requireReason
        confirmPhrase={model.id}
        onConfirm={async (reason) => {
          await deleteModel(model.id, reason);
          onSaved?.();
          onClose();
        }}
      />
    </>
  );
}

function ProviderEditor({ provider, vault, canWrite, onClose, onSaved }) {
  const [draft, setDraft] = useState(provider);
  const [confirming, setConfirming] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyAction, setKeyAction] = useState(null);

  const current = draft?.id === provider?.id ? draft : provider;
  const set = (patch) => setDraft({ ...(current ?? {}), ...patch });

  if (!provider) return null;
  const isNew = !provider.id;

  return (
    <>
      <Drilldown
        open
        onClose={onClose}
        width="md"
        eyebrow="ai_providers"
        title={isNew ? 'Add a provider' : current.label}
        subtitle={current.id}
        footer={
          <div className="flex items-center justify-between gap-1">
            {!isNew && canWrite ? (
              <Button variant="danger" onClick={() => setKeyAction('delete')}>
                Delete provider
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={() => setConfirming(true)}>
              {isNew ? 'Create provider' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <div className="space-y-1.5">
          <TextField label="Provider id" value={current.id} disabled={!isNew} onChange={(v) => set({ id: v })} mono />
          <TextField label="Display label" value={current.label} onChange={(v) => set({ label: v })} />
          <TextField label="Base URL" value={current.base_url ?? ''} onChange={(v) => set({ base_url: v })} mono />
          <TextField
            label="Secret variable name"
            value={current.secret_ref ?? ''}
            onChange={(v) => set({ secret_ref: v.toUpperCase() })}
            mono
            hint="The NAME of the Edge Function secret, in SCREAMING_SNAKE_CASE — never the key itself."
          />
          <FieldGrid cols={2}>
            <NumberField label="Priority" value={current.priority} onChange={(v) => set({ priority: v })} />
            <NumberField
              label="Daily request cap"
              value={current.day_limit}
              onChange={(v) => set({ day_limit: v })}
              hint="Blank means uncapped"
            />
          </FieldGrid>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={Boolean(current.enabled)}
              onChange={(e) => set({ enabled: e.target.checked })}
              className="h-[15px] w-[15px] accent-[rgb(var(--brand-solid))]"
            />
            <span className="text-sm font-semibold">Enabled</span>
          </label>

          {!isNew ? (
            <div className="rounded-sm border border-line bg-raised/40 p-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <Field label="API key">
                  {vault?.in_vault || current.key_present ? (
                    <span className="flex items-center gap-0.5">
                      <Chip tone="good">configured</Chip>
                      <span className="font-mono text-xs text-ink-3">••••{current.key_tail ?? '????'}</span>
                    </span>
                  ) : (
                    <Chip tone="warn">not set</Chip>
                  )}
                </Field>
                {current.key_rotated_at ? (
                  <span className="font-mono text-2xs text-ink-3">
                    rotated {relativeTime(current.key_rotated_at)}
                  </span>
                ) : null}
              </div>

              {/* The value is write-only. It is posted to a SECURITY DEFINER
                  function that puts it in Supabase Vault, and no query in this
                  console can read it back — the tail below is all that
                  returns. `type=password` plus autoComplete off keeps it out
                  of the browser's own credential store too. */}
              <label className="mt-1.5 block">
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
                  Set or rotate key
                </span>
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  disabled={!canWrite}
                  placeholder="Paste the provider's API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-0.5 h-[34px] w-full rounded-sm border border-line bg-surface px-1.5 font-mono text-sm outline-none transition-colors focus:border-line-strong disabled:opacity-50"
                />
              </label>

              <div className="mt-1 flex flex-wrap items-center gap-1">
                <ScopeGate can={canWrite} scope="ai.write" inline>
                  <Button
                    variant="primary"
                    disabled={keyDraft.trim().length < 8}
                    onClick={() => setKeyAction('set')}
                  >
                    <KeyRound size={13} aria-hidden />
                    Save key
                  </Button>
                </ScopeGate>
                {vault?.in_vault ? (
                  <ScopeGate can={canWrite} scope="ai.write" inline>
                    <Button variant="danger" onClick={() => setKeyAction('clear')}>
                      Remove key
                    </Button>
                  </ScopeGate>
                ) : null}
              </div>

              <p className="mt-1 text-xs text-ink-3">
                Stored encrypted in Supabase Vault under{' '}
                <code className="font-mono text-ink-2">{current.secret_ref}</code>. The forge functions read it on
                their next cold start — no redeploy. An environment secret of the same name still wins over Vault.
              </p>
            </div>
          ) : (
            <p className="rounded-sm border border-line bg-raised/40 p-1.5 text-xs text-ink-2">
              Save the provider first, then set its key. The secret name must begin with{' '}
              <code className="font-mono text-ink">FORGE_</code> or the runtime will not read it.
            </p>
          )}
        </div>
      </Drilldown>

      <ConfirmAction
        open={confirming}
        onClose={() => setConfirming(false)}
        title={isNew ? 'Create this provider' : 'Save provider changes'}
        confirmLabel="Save"
        onConfirm={async () => {
          await upsertProvider(current);
          onSaved?.();
          onClose();
        }}
      />

      <ConfirmAction
        open={keyAction === 'set'}
        onClose={() => setKeyAction(null)}
        title={`${vault?.in_vault ? 'Rotate' : 'Set'} the ${current.label} key`}
        description="Stored encrypted in Vault. The audit log records that it changed and its last four characters — never the key."
        confirmLabel={vault?.in_vault ? 'Rotate key' : 'Save key'}
        onConfirm={async () => {
          await setProviderKey(current.id, keyDraft.trim());
          setKeyDraft('');
          onSaved?.();
        }}
      />

      <ConfirmAction
        open={keyAction === 'delete'}
        onClose={() => setKeyAction(null)}
        title={`Delete ${current.label}`}
        description="Its models are deleted with it — the console tells you how many in the audit entry. Any lane that relied on them falls through to its remaining rungs."
        confirmLabel="Delete provider"
        tone="danger"
        requireReason
        confirmPhrase={current.id}
        onConfirm={async (reason) => {
          await deleteProvider(current.id, reason);
          onSaved?.();
          onClose();
        }}
      />

      <ConfirmAction
        open={keyAction === 'clear'}
        onClose={() => setKeyAction(null)}
        title={`Remove the ${current.label} key`}
        description="The provider stops answering as soon as the functions next start. Models on its ladders fall through to the next rung."
        confirmLabel="Remove key"
        tone="danger"
        requireReason
        onConfirm={async (reason) => {
          await clearProviderKey(current.id, reason);
          onSaved?.();
        }}
      />
    </>
  );
}

/* ── small form controls ───────────────────────────────────────────────── */

function TextField({ label, value, onChange, disabled, mono, hint }) {
  return (
    <label className="block">
      <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <input
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          'mt-0.5 h-[34px] w-full rounded-sm border border-line bg-raised/50 px-1.5 text-sm outline-none transition-colors focus:border-line-strong focus:bg-raised disabled:opacity-50',
          mono && 'font-mono',
        )}
      />
      {hint ? <span className="mt-px block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

function NumberField({ label, value, onChange, step = '1', hint }) {
  return (
    <label className="block">
      <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="mt-0.5 h-[34px] w-full rounded-sm border border-line bg-raised/50 px-1.5 font-mono text-sm tnum outline-none transition-colors focus:border-line-strong focus:bg-raised"
      />
      {hint ? <span className="mt-px block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}
