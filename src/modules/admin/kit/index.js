/**
 * The console kit.
 *
 * Everything the eight views are built from. One entry point so a view imports
 * from `../kit` and gets a coherent set, rather than reaching into individual
 * files and slowly growing its own dialect.
 */
export { ConsoleProvider, useConsole, useConsoleQuery, useDensityClasses, usePolling, RANGE_PRESETS } from './ConsoleContext.jsx';
export { default as MetricTile, MetricRack } from './MetricTile.jsx';
export { default as ConsoleTable } from './ConsoleTable.jsx';
export { default as FilterBar } from './FilterBar.jsx';
export { default as Drilldown, Field, FieldGrid } from './Drilldown.jsx';
export { default as ConfirmAction } from './ConfirmAction.jsx';
export { default as LiveRail } from './LiveRail.jsx';
export { Panel, StateBlock, ViewHeader, ScopeGate } from './Panel.jsx';
