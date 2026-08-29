import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Inbox } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import { EmptyState, Skeleton } from '../../../components/ui/Primitives.jsx';
import { useDensityClasses } from './ConsoleContext.jsx';

/**
 * The console's table.
 *
 * Every module in the brief is a list of something, so this is the component
 * that decides whether the whole thing feels like an instrument or like a CRUD
 * screen. What it takes on so that eight views do not each solve it again:
 * sorting, selection with bulk actions, keyboard row navigation, sticky header,
 * CSV export, pagination (client or server), and the three non-happy states.
 *
 * Column contract:
 *   key       unique; also the sort key unless `sortKey` overrides it
 *   label     header text
 *   align     'left' | 'right'  — numerals go right, always
 *   width     CSS width for the column
 *   render    (row) => node        display
 *   value     (row) => primitive   sorting and CSV; defaults to row[key]
 *   mono      render in the numeral face
 *   sortable  default true
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function cellValue(col, row) {
  if (col.value) return col.value(row);
  return row[col.key];
}

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls sort last in both directions — an absent
  if (b == null) return -1; // value is not "smallest", it is unknown
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

function toCsv(columns, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(cellValue(c, r))).join(',')).join('\n');
  return `${head}\n${body}`;
}

export default function ConsoleTable({
  columns,
  rows,
  rowKey = (r) => r.id,
  loading = false,
  error = null,
  onRetry,
  /** Row click — the drill-down path. Makes rows focusable and keyboard-navigable. */
  onRowClick,
  selectable = false,
  selected = [],
  onSelectionChange,
  bulkActions = null,
  /** Client-side sort by default; pass `sort`/`onSortChange` for server-side. */
  sort: controlledSort,
  onSortChange,
  defaultSort,
  /** Client-side paging by default; pass `page`/`count` for server-side. */
  page: controlledPage,
  pageSize = 25,
  count,
  onPageChange,
  paginate = true,
  csvName,
  empty,
  stickyHeader = true,
  minWidth = 720,
  className,
}) {
  const d = useDensityClasses();
  const [innerSort, setInnerSort] = useState(defaultSort ?? null);
  const [innerPage, setInnerPage] = useState(0);
  const [focusIndex, setFocusIndex] = useState(-1);
  const bodyRef = useRef(null);

  const serverSorted = Boolean(onSortChange);
  const serverPaged = Boolean(onPageChange);
  const sort = controlledSort ?? innerSort;
  const page = controlledPage ?? innerPage;

  const setSort = useCallback(
    (key) => {
      const col = columns.find((c) => c.key === key);
      if (col?.sortable === false) return;
      const sortKey = col?.sortKey ?? key;
      const next =
        sort?.key === sortKey
          ? { key: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key: sortKey, dir: 'desc' };
      if (onSortChange) onSortChange(next);
      else {
        setInnerSort(next);
        setInnerPage(0);
      }
    },
    [columns, sort, onSortChange],
  );

  const setPage = useCallback(
    (p) => (onPageChange ? onPageChange(p) : setInnerPage(p)),
    [onPageChange],
  );

  const sorted = useMemo(() => {
    if (serverSorted || !sort) return rows;
    const col = columns.find((c) => (c.sortKey ?? c.key) === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(cellValue(col, a), cellValue(col, b)) * dir);
  }, [rows, sort, columns, serverSorted]);

  const total = count ?? sorted.length;
  const pageCount = paginate ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const visible = useMemo(() => {
    if (!paginate || serverPaged) return sorted;
    return sorted.slice(page * pageSize, page * pageSize + pageSize);
  }, [sorted, page, pageSize, paginate, serverPaged]);

  // A filter that shrinks the result set below the current page leaves an
  // operator staring at an empty table that is not actually empty.
  useEffect(() => {
    if (!serverPaged && page > 0 && page >= pageCount) setInnerPage(pageCount - 1);
  }, [page, pageCount, serverPaged]);

  const allSelected = visible.length > 0 && visible.every((r) => selected.includes(rowKey(r)));
  const toggleAll = () => {
    if (!onSelectionChange) return;
    const ids = visible.map(rowKey);
    onSelectionChange(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };
  const toggleOne = (id) => {
    if (!onSelectionChange) return;
    onSelectionChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  /* Arrow keys move between rows, Enter opens one. A table an operator lives
     in all day should not require the mouse for its primary action. */
  const onKeyDown = (e) => {
    if (!onRowClick) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(visible.length - 1, focusIndex + (e.key === 'ArrowDown' ? 1 : -1)));
      setFocusIndex(next);
      bodyRef.current?.querySelectorAll('tr[data-row]')?.[next]?.focus();
    }
  };

  const exportCsv = () => {
    const csv = toCsv(columns.filter((c) => c.csv !== false), serverPaged ? visible : sorted);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csvName || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="rounded-md border border-bad/30 bg-bad/[0.04] py-4">
        <EmptyState
          icon={Inbox}
          title="This table could not load"
          description={error.message || 'The query failed.'}
          action={
            onRetry ? (
              <button
                onClick={onRetry}
                className="h-[32px] rounded-sm border border-line px-1.5 text-sm font-semibold hover:border-line-strong"
              >
                Try again
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {selectable && selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 rounded-sm border border-brand/40 bg-brand-wash/50 px-1.5 py-1">
          <span className="text-sm font-semibold tnum">{selected.length} selected</span>
          <span className="flex-1" />
          {bulkActions}
          <button
            onClick={() => onSelectionChange?.([])}
            className="text-xs font-semibold text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-line">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <table className="w-full border-collapse text-left" style={{ minWidth }} onKeyDown={onKeyDown}>
          <thead className={cx(stickyHeader && 'sticky top-0 z-10')}>
            <tr className="border-b border-line bg-raised">
              {selectable ? (
                <th scope="col" className={cx(d.head, 'w-[36px]')}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                    className="h-[14px] w-[14px] accent-[rgb(var(--brand-solid))]"
                  />
                </th>
              ) : null}
              {columns.map((c) => {
                const key = c.sortKey ?? c.key;
                const isSorted = sort?.key === key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    className={cx(d.head, c.align === 'right' && 'text-right')}
                    aria-sort={isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.sortable === false ? (
                      <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{c.label}</span>
                    ) : (
                      <button
                        onClick={() => setSort(c.key)}
                        className={cx(
                          'inline-flex items-center gap-px text-2xs font-bold uppercase tracking-[0.08em] transition-colors',
                          c.align === 'right' && 'flex-row-reverse',
                          isSorted ? 'text-ink' : 'text-ink-3 hover:text-ink',
                        )}
                      >
                        {c.label}
                        {isSorted ? (
                          sort.dir === 'asc' ? (
                            <ArrowUp size={11} aria-hidden />
                          ) : (
                            <ArrowDown size={11} aria-hidden />
                          )
                        ) : null}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody ref={bodyRef}>
            {loading && rows.length === 0
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {selectable ? <td className={d.cell} /> : null}
                    {columns.map((c) => (
                      <td key={c.key} className={d.cell}>
                        <Skeleton className="h-1.5 w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : visible.map((row, i) => {
                  const id = rowKey(row);
                  const isSelected = selected.includes(id);
                  return (
                    <tr
                      key={id}
                      data-row
                      tabIndex={onRowClick ? 0 : undefined}
                      onFocus={() => setFocusIndex(i)}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                      className={cx(
                        'border-b border-line last:border-0 transition-colors duration-fast',
                        isSelected && 'bg-brand-wash/30',
                        onRowClick &&
                          'cursor-pointer hover:bg-raised/70 focus:bg-raised focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_rgb(var(--brand)/0.5)]',
                      )}
                    >
                      {selectable ? (
                        <td className={d.cell} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(id)}
                            aria-label="Select row"
                            className="h-[14px] w-[14px] accent-[rgb(var(--brand-solid))]"
                          />
                        </td>
                      ) : null}
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cx(
                            d.cell,
                            d.text,
                            c.align === 'right' && 'text-right',
                            c.mono && 'font-mono tnum',
                            c.className,
                          )}
                        >
                          {c.render ? c.render(row) : (cellValue(c, row) ?? <span className="text-ink-3">—</span>)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {!loading && visible.length === 0 ? (
          <div className="py-5">
            {empty ?? <EmptyState icon={Inbox} title="Nothing here yet" description="No rows match the current filters." />}
          </div>
        ) : null}
      </div>

      {(paginate && total > pageSize) || csvName ? (
        <div className="flex flex-wrap items-center justify-between gap-1 px-px">
          <p className="text-xs text-ink-3 tnum">
            {total === 0
              ? 'No rows'
              : `${(page * pageSize + 1).toLocaleString()}–${Math.min((page + 1) * pageSize, total).toLocaleString()} of ${total.toLocaleString()}`}
          </p>
          <div className="flex items-center gap-1">
            {csvName ? (
              <button
                onClick={exportCsv}
                className="inline-flex h-[28px] items-center gap-0.5 rounded-xs border border-line px-1 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
              >
                <Download size={12} aria-hidden />
                CSV
              </button>
            ) : null}
            {paginate && total > pageSize ? (
              <div className="flex items-center gap-px">
                <PagerButton onClick={() => setPage(page - 1)} disabled={page === 0} label="Previous page">
                  <ChevronLeft size={14} aria-hidden />
                </PagerButton>
                <span className="px-1 text-xs text-ink-3 tnum">
                  {page + 1} / {pageCount}
                </span>
                <PagerButton onClick={() => setPage(page + 1)} disabled={page + 1 >= pageCount} label="Next page">
                  <ChevronRight size={14} aria-hidden />
                </PagerButton>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PagerButton({ onClick, disabled, label, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-[28px] w-[28px] place-items-center rounded-xs border border-line text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
