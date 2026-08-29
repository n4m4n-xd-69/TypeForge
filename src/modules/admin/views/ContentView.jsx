import { useEffect, useMemo, useState } from 'react';
import { Archive, Eye, Flag, Library, ShieldCheck, Trash2 } from 'lucide-react';
import { relativeTime } from '../../../lib/format.js';
import { DIFFICULTIES } from '../../../lib/content.js';
import { Chip } from '../../../components/ui/Primitives.jsx';
import Button from '../../../components/ui/Button.jsx';
import {
  ConfirmAction, ConsoleTable, Drilldown, Field, FieldGrid, FilterBar,
  MetricRack, MetricTile, Panel, ScopeGate, StateBlock, ViewHeader,
  useConsole, useConsoleQuery,
} from '../kit/index.js';
import { fetchGenerationBody, moderateGeneration, searchGenerations } from '../api/console.js';

/**
 * The generated-content database.
 *
 * Paged, filtered and sorted **on the server**. The library is designed to
 * grow without bound — the whole point of `forge_generations` is that a
 * passage generated for one user is reusable by every other — so the
 * fetch-everything-and-filter-in-JS approach the rest of the console can get
 * away with would fail here first and worst.
 *
 * Bodies are never fetched in list mode. A page of fifty rows carrying fifty
 * full passages is megabytes of text an operator is not reading; the body
 * arrives only when one record is opened.
 */

const PAGE_SIZE = 25;

const KINDS = [
  { value: '', label: 'Any kind' },
  { value: 'passage', label: 'Passage' },
  { value: 'snippet', label: 'Snippet' },
  { value: 'drill', label: 'Drill' },
  { value: 'quote', label: 'Quote' },
  { value: 'explanation', label: 'Explanation' },
  { value: 'analysis', label: 'Analysis' },
];

/* Derived from the canonical list rather than restated. `DIFFICULTIES` has
   exactly one array-literal definition in the codebase and a test in
   src/lib/modes/duplication.test.js enforces that — a second copy here would
   be free to drift from the one the typing surfaces actually use. */
const DIFFICULTY_FILTER = [
  { value: '', label: 'Any difficulty' },
  ...DIFFICULTIES.map((d) => ({ value: d.id, label: d.name })),
];

const STATUSES = [
  { value: 'all', label: 'Any state' },
  { value: 'live', label: 'Live' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'archived', label: 'Archived' },
];

export default function ContentView() {
  const { nonce, refresh, can } = useConsole();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ kind: '', difficulty: '', status: 'all', language: '' });
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [bulk, setBulk] = useState(null);

  /* Any change to what is being asked for resets to the first page. Leaving an
     operator on page 7 of a result set that now has two pages is the classic
     "the table is empty and I don't know why". */
  useEffect(() => setPage(0), [query, filters, sort]);

  const results = useConsoleQuery(
    () =>
      searchGenerations({
        query,
        kind: filters.kind || null,
        difficulty: filters.difficulty || null,
        language: filters.language || null,
        status: filters.status,
        sort,
        page,
        pageSize: PAGE_SIZE,
      }),
    [query, filters.kind, filters.difficulty, filters.language, filters.status, sort.key, sort.dir, page, nonce],
  );

  /* Counts come from the same paged query run with a different status filter,
     asking only for the count. Cheap because PostgREST returns `count` without
     the rows when the range is empty. */
  const tallies = useConsoleQuery(
    async () => {
      const [all, flagged, archived] = await Promise.all([
        searchGenerations({ status: 'all', page: 0, pageSize: 1 }),
        searchGenerations({ status: 'flagged', page: 0, pageSize: 1 }),
        searchGenerations({ status: 'archived', page: 0, pageSize: 1 }),
      ]);
      return { all: all.count, flagged: flagged.count, archived: archived.count };
    },
    [nonce],
  );

  const rows = results.data?.rows ?? [];
  const count = results.data?.count ?? 0;
  const t = tallies.data ?? {};

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const languages = useMemo(() => {
    const set = new Set(rows.map((r) => r.language).filter(Boolean));
    return [{ value: '', label: 'Any language' }, ...[...set].sort().map((l) => ({ value: l, label: l }))];
  }, [rows]);

  const columns = useMemo(
    () => [
      {
        key: 'title',
        label: 'Title',
        width: '26%',
        render: (g) => (
          <span className="min-w-0">
            <span className="block truncate font-semibold">{g.title || g.topic || <span className="text-ink-3">untitled</span>}</span>
            <span className="block truncate font-mono text-2xs text-ink-3">{g.source_model ?? 'unknown model'}</span>
          </span>
        ),
      },
      { key: 'kind', label: 'Kind', render: (g) => <Chip tone="accent">{g.kind}</Chip> },
      { key: 'category', label: 'Category' },
      { key: 'language', label: 'Language', render: (g) => g.language ?? <span className="text-ink-3">prose</span> },
      { key: 'difficulty', label: 'Difficulty' },
      { key: 'word_count', label: 'Words', align: 'right', mono: true },
      { key: 'serve_count', label: 'Served', align: 'right', mono: true },
      {
        key: 'completion_count',
        label: 'Completed',
        align: 'right',
        mono: true,
        // Never served is not a zero percent completion rate.
        render: (g) =>
          g.serve_count ? `${Math.round((g.completion_count / g.serve_count) * 100)}%` : <span className="text-ink-3">—</span>,
      },
      {
        key: 'quality_score',
        label: 'Quality',
        align: 'right',
        mono: true,
        render: (g) => (g.quality_score == null ? '—' : g.quality_score.toFixed(2)),
      },
      {
        key: 'flagged',
        label: 'State',
        sortable: false,
        render: (g) =>
          g.flagged ? (
            <Chip tone="bad" title={g.flag_reason ?? undefined}>flagged</Chip>
          ) : g.published ? (
            <Chip tone="good">live</Chip>
          ) : (
            <Chip tone="warn">archived</Chip>
          ),
      },
      {
        key: 'created_at',
        label: 'Created',
        align: 'right',
        render: (g) => <span className="text-ink-3">{relativeTime(g.created_at)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="space-y-2">
      <ViewHeader
        title="Content"
        description="Every reusable generation in the shared library. Search runs against titles, topics and body text on the server."
      />

      <MetricRack cols={4}>
        <MetricTile
          icon={Library}
          label="Generations"
          value={t.all}
          loading={tallies.status === 'loading'}
          source="forge_generations"
          active={filters.status === 'all'}
          onClick={() => setFilter('status', 'all')}
        />
        <MetricTile
          icon={Flag}
          label="Flagged"
          value={t.flagged}
          invert
          source="forge_generations.flagged"
          active={filters.status === 'flagged'}
          onClick={() => setFilter('status', 'flagged')}
        />
        <MetricTile
          icon={Archive}
          label="Archived"
          value={t.archived}
          source="published = false"
          active={filters.status === 'archived'}
          onClick={() => setFilter('status', 'archived')}
        />
        <MetricTile
          icon={Eye}
          label="Matching now"
          value={count}
          hint={`page ${page + 1} of ${Math.max(1, Math.ceil(count / PAGE_SIZE))}`}
          source="current query"
        />
      </MetricRack>

      <Panel
        title="Library"
        hint={`${count.toLocaleString()} generations match`}
        source="forge_generations · server-paged"
        refreshing={results.isRefreshing}
      >
        <div className="space-y-1.5">
          <FilterBar
            query={query}
            onQueryChange={setQuery}
            placeholder="Search title, topic or body…"
            filters={[
              { key: 'kind', label: 'Kind', value: filters.kind, defaultValue: '', options: KINDS },
              { key: 'difficulty', label: 'Difficulty', value: filters.difficulty, defaultValue: '', options: DIFFICULTY_FILTER },
              { key: 'language', label: 'Language', value: filters.language, defaultValue: '', options: languages },
              { key: 'status', label: 'State', value: filters.status, defaultValue: 'all', options: STATUSES },
            ]}
            onFilterChange={setFilter}
          />

          <StateBlock status={results.status} error={results.error} onRetry={results.reload} rows={8}>
            <ConsoleTable
              columns={columns}
              rows={rows}
              rowKey={(g) => g.id}
              onRowClick={(g) => setOpenId(g.id)}
              selectable={can('content.moderate')}
              selected={selected}
              onSelectionChange={setSelected}
              sort={sort}
              onSortChange={setSort}
              page={page}
              count={count}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              csvName="typeforge-generations"
              minWidth={1120}
              bulkActions={
                <>
                  <Button variant="secondary" onClick={() => setBulk('flag')}>
                    <Flag size={13} aria-hidden />
                    Flag
                  </Button>
                  <Button variant="secondary" onClick={() => setBulk('unpublish')}>
                    <Archive size={13} aria-hidden />
                    Archive
                  </Button>
                </>
              }
              empty={
                <p className="px-2 text-center text-sm text-ink-3">
                  No generation matches. Try a broader search or clear a filter.
                </p>
              }
            />
          </StateBlock>
        </div>
      </Panel>

      <GenerationSheet id={openId} onClose={() => setOpenId(null)} onMutated={refresh} />

      <ConfirmAction
        open={Boolean(bulk)}
        onClose={() => setBulk(null)}
        title={`${bulk === 'flag' ? 'Flag' : 'Archive'} ${selected.length} generations`}
        description="Each record is moderated separately and each gets its own audit entry."
        confirmLabel={bulk === 'flag' ? 'Flag all' : 'Archive all'}
        tone="danger"
        requireReason
        onConfirm={async (reason) => {
          const results2 = await Promise.allSettled(selected.map((id) => moderateGeneration(id, bulk, reason)));
          const failed = results2.filter((r) => r.status === 'rejected');
          setSelected([]);
          refresh();
          if (failed.length) {
            throw new Error(
              `${results2.length - failed.length} updated, ${failed.length} failed: ${failed[0].reason?.message ?? 'unknown error'}`,
            );
          }
        }}
      />
    </div>
  );
}

function GenerationSheet({ id, onClose, onMutated }) {
  const { can } = useConsole();
  const [action, setAction] = useState(null);

  const record = useConsoleQuery(
    () => (id ? fetchGenerationBody(id) : Promise.resolve(null)),
    [id],
    { enabled: Boolean(id) },
  );

  const g = record.data ?? {};

  const act = (kind) => async (reason) => {
    await moderateGeneration(id, kind, reason);
    onMutated?.();
    if (kind === 'delete') onClose();
  };

  return (
    <>
      <Drilldown
        open={Boolean(id)}
        onClose={onClose}
        width="lg"
        eyebrow="forge_generations"
        title={g.title || g.kind || 'Generation'}
        subtitle={g.source_model}
        footer={
          <ScopeGate can={can('content.moderate')} scope="content.moderate">
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Button variant="secondary" onClick={() => setAction('flag')}>
                <Flag size={13} aria-hidden />
                Flag
              </Button>
              <Button variant="secondary" onClick={() => setAction('unflag')}>
                <ShieldCheck size={13} aria-hidden />
                Clear flag
              </Button>
              <Button variant="secondary" onClick={() => setAction('unpublish')}>
                <Archive size={13} aria-hidden />
                Archive
              </Button>
              <Button variant="secondary" onClick={() => setAction('publish')}>
                Republish
              </Button>
              <Button variant="danger" onClick={() => setAction('delete')}>
                <Trash2 size={13} aria-hidden />
                Delete
              </Button>
            </div>
          </ScopeGate>
        }
      >
        <StateBlock status={record.status} error={record.error} onRetry={record.reload} rows={6}>
          <div className="space-y-2">
            <FieldGrid cols={3}>
              <Field label="Kind">{g.kind}</Field>
              <Field label="Category">{g.category}</Field>
              <Field label="Language">{g.language ?? 'prose'}</Field>
              <Field label="Difficulty">{g.difficulty}</Field>
              <Field label="Provider" mono>{g.source_provider}</Field>
              <Field label="Created">{g.created_at ? relativeTime(g.created_at) : null}</Field>
            </FieldGrid>

            <div>
              <p className="mb-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Body</p>
              {/* Model output rendered as text, never as markup. It is
                  untrusted content by definition, and an admin console is the
                  last place that should interpret it. */}
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-line bg-raised/40 p-1.5 font-mono text-xs leading-5 text-ink-2">
                {g.body ?? ''}
              </pre>
            </div>

            {g.meta && Object.keys(g.meta).length ? (
              <div>
                <p className="mb-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">Metadata</p>
                <pre className="max-h-[200px] overflow-auto rounded-sm border border-line bg-raised/40 p-1.5 font-mono text-xs text-ink-3">
                  {JSON.stringify(g.meta, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </StateBlock>
      </Drilldown>

      <ConfirmAction
        open={action === 'flag'}
        onClose={() => setAction(null)}
        title="Flag this generation"
        description="A flagged generation stops being served and the reason is stored on the record."
        confirmLabel="Flag"
        tone="danger"
        requireReason
        onConfirm={act('flag')}
      />
      <ConfirmAction
        open={action === 'unflag'}
        onClose={() => setAction(null)}
        title="Clear the flag"
        confirmLabel="Clear flag"
        onConfirm={act('unflag')}
      />
      <ConfirmAction
        open={action === 'unpublish'}
        onClose={() => setAction(null)}
        title="Archive this generation"
        description="It stays in the library and stops being served."
        confirmLabel="Archive"
        requireReason
        onConfirm={act('unpublish')}
      />
      <ConfirmAction
        open={action === 'publish'}
        onClose={() => setAction(null)}
        title="Republish this generation"
        confirmLabel="Republish"
        onConfirm={act('publish')}
      />
      <ConfirmAction
        open={action === 'delete'}
        onClose={() => setAction(null)}
        title="Delete this generation"
        description="Removes the row and its embedding. Users who already typed it keep their session records."
        confirmLabel="Delete permanently"
        tone="danger"
        requireReason
        confirmPhrase={id ?? ''}
        onConfirm={act('delete')}
      />
    </>
  );
}
