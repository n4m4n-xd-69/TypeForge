import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cx } from '../../../lib/format.js';
import Select from '../../../components/ui/Select.jsx';

/**
 * Search and filters for a list view.
 *
 * The search box debounces internally and reports upward, because half the
 * views behind it query the server per keystroke otherwise. `/` focuses it
 * from anywhere in the view — the shortcut every operator already expects —
 * and Escape clears it.
 *
 * Active filters render as removable chips below the controls rather than only
 * as select values. A filter an operator has forgotten they set is the usual
 * cause of "the data is wrong", and a chip row makes the current query
 * legible at a glance.
 */
export default function FilterBar({
  query,
  onQueryChange,
  placeholder = 'Search…',
  filters = [],
  onFilterChange,
  actions,
  debounceMs = 250,
  className,
}) {
  const [draft, setDraft] = useState(query ?? '');
  const inputRef = useRef(null);
  const emitted = useRef(query ?? '');

  // Keep in step when the parent resets the query (a chip cleared, say).
  useEffect(() => {
    if (query !== emitted.current) {
      setDraft(query ?? '');
      emitted.current = query ?? '';
    }
  }, [query]);

  useEffect(() => {
    if (draft === emitted.current) return undefined;
    const t = window.setTimeout(() => {
      emitted.current = draft;
      onQueryChange?.(draft);
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [draft, debounceMs, onQueryChange]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = filters.filter((f) => f.value != null && f.value !== '' && f.value !== f.defaultValue);

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <div className="flex flex-wrap items-center gap-1">
        {onQueryChange ? (
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden
            />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraft('');
                  e.currentTarget.blur();
                }
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              className="h-[34px] w-full rounded-sm border border-line bg-raised/50 pl-4 pr-4 text-sm outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong focus:bg-raised"
              style={{ paddingLeft: 30 }}
            />
            {draft ? (
              <button
                onClick={() => setDraft('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 grid h-[20px] w-[20px] -translate-y-1/2 place-items-center rounded-xs text-ink-3 hover:bg-line hover:text-ink"
              >
                <X size={12} aria-hidden />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] text-ink-3 sm:block">
                /
              </kbd>
            )}
          </div>
        ) : null}

        {filters.map((f) => (
          <Select
            key={f.key}
            value={f.value ?? f.defaultValue ?? ''}
            onChange={(v) => onFilterChange?.(f.key, v)}
            options={f.options}
            label={f.label}
            minWidth={f.minWidth ?? 140}
          />
        ))}

        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>

      {active.length ? (
        <ul className="flex flex-wrap items-center gap-0.5">
          {active.map((f) => (
            <li key={f.key}>
              <button
                onClick={() => onFilterChange?.(f.key, f.defaultValue ?? '')}
                className="inline-flex items-center gap-0.5 rounded-full border border-line bg-raised px-1 py-px text-2xs font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                <span className="text-ink-3">{f.label}:</span>
                {f.options.find((o) => o.value === f.value)?.label ?? f.value}
                <X size={10} aria-hidden />
                <span className="sr-only">Remove filter</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
