# Admin console — build contract

The rules every view under `src/modules/admin/views/` follows. They exist so
eight modules built at different times read as one instrument rather than eight
dashboards that happen to share a route prefix.

## Stack facts

- **JSX, not TypeScript.** `.jsx`, ESM, explicit file extensions on every
  relative import (`../kit/index.js`, `../../../lib/format.js`).
- React 18, react-router-dom 6, recharts 2, framer-motion 11, lucide-react.
- **No new dependencies.** If something needs a library, it is out of scope.
- Tailwind with a **closed scale** (`tailwind.config.js`). Spacing steps are
  `0.5 1 1.5 2 2.5 3 …` where `1 = 8px`. There is no `p-4` meaning 16px — that
  is `p-2`. Arbitrary values (`p-[13px]`) are a last resort, not a shortcut.

## Colour and type

Use tokens, never hex:

| role | class |
|---|---|
| page / card / raised surface | `bg-bg` `bg-surface` `bg-raised` |
| hairline / stronger hairline | `border-line` `border-line-strong` |
| text primary / secondary / tertiary | `text-ink` `text-ink-2` `text-ink-3` |
| brand stroke / fill / wash | `text-brand` `bg-brand-solid` `bg-brand-wash` |
| data accent | `text-accent` `bg-accent-wash` |
| status | `text-good` `text-warn` `text-bad` `text-info` |

- **Every numeral is mono and tabular**: `font-mono tnum`. Operators read down
  columns; proportional digits make a column ragged.
- Display face (`font-display`) is for view titles only.
- Colour is never the only signal — pair a status colour with a word or glyph.
  `good` and `bad` collapse to 1.49:1 separation under deuteranopia.

## The kit

Import from `../kit/index.js`. Do not rebuild any of this locally.

```js
import {
  useConsole, useConsoleQuery, usePolling, useDensityClasses,
  MetricTile, MetricRack, ConsoleTable, FilterBar, Drilldown, Field, FieldGrid,
  ConfirmAction, LiveRail, Panel, StateBlock, ViewHeader, ScopeGate,
} from '../kit/index.js';
```

- `useConsole()` → `{ range: {from, to, days, label, id}, density, live, nonce,
  refresh, scopes, can(scope), tier, userId }`.
- `useConsoleQuery(fn, deps, { keepPrevious, enabled })` →
  `{ status: 'loading'|'ready'|'error', data, error, reload, isRefreshing }`.
  **Always include `nonce` and `range` in `deps`** so the strip's refresh and
  window controls actually reach the panel.
- `usePolling(cb, ms)` — only ticks while the tab is visible and live mode is
  on. Use for anything genuinely live; do not hand-roll `setInterval`.
- `ConsoleTable` — columns are
  `{ key, label, align, width, render(row), value(row), mono, sortable, csv }`.
  Give it `csvName` to get CSV export, `onRowClick` for drill-down,
  `selectable`+`selected`+`onSelectionChange`+`bulkActions` for bulk work.
- `Panel` takes a **`source`** prop. This is required and it is not decoration:
  it names the table or RPC the panel reads and its refresh cadence, e.g.
  `source="admin_timeseries · 30d"` or `source="forge_model_health · 15s"`.
- `StateBlock` **wraps** the real content and renders loading / error / empty in
  its place when one of those applies:
  ```jsx
  <Panel title="…" source="…">
    <StateBlock status={q.status} error={q.error} empty={!rows.length} onRetry={q.reload}>
      <RealContent rows={rows} />
    </StateBlock>
  </Panel>
  ```
  Do **not** write `{<StateBlock … /> ?? <RealContent />}`. A JSX element is an
  object, so `??` never falls through and the real content would never render.

## Data

All reads and writes go through `../api/console.js`. Never call `supabase`
directly from a view.

- **Reads never throw on permission** — they return empty. A thrown read error
  is a real failure and should surface.
- **Writes always throw** on a missing scope (Postgres 42501, decorated into
  "Your admin tier does not include this action.").
- Every mutation goes through `ConfirmAction`. Destructive ones pass
  `requireReason` (the RPC rejects an empty reason anyway); irreversible ones
  also pass `confirmPhrase`.
- Gate write controls with `can('users.write')` etc. and wrap them in
  `<ScopeGate can={…} scope="users.write">`, which shows a disabled affordance
  rather than hiding it.

## The rule that matters most

**Never invent a number.** `null` is rendered as "not instrumented" or "rate
not configured" — never coerced to `0`. `src/modules/admin/costs.js` already
holds this line for unrated model costs and `admin_kpis` returns `revenue` as
SQL `NULL` because TypeForge has no billing system. A fabricated figure in an
admin console is worse than a blank one, because someone will act on it.

## Charts

Use `ChartFrame` from `../../../components/charts/ChartFrame.jsx` and the
existing chart components in `Charts.jsx` (`TrendLine`, `WeeklyBars`,
`SkillRadar`, `Heatmap`, `Sparkline`) where they fit. Colours come from
`../../../components/charts/palette.js` via `chartTokens(isDark)`. Every chart
gets a `table={<DataTable …/>}` fallback — three light-mode series colours sit
below 3:1 and the table view is the required relief, not a nicety.

## Accessibility floor

Keyboard reachable, visible focus (`focus-visible:shadow-focus`), `aria-label`
on icon-only controls, `aria-pressed` on toggles, `aria-sort` on sortable
headers, motion suppressed under `prefers-reduced-motion` via
`useReducedMotionSafe()`. Responsive down to 360px — tables scroll inside
their own container, the page never scrolls sideways.

## Comments

Match the repo. Comments explain **why** a non-obvious decision was made, not
what the line does. If nothing is non-obvious, write no comment.
