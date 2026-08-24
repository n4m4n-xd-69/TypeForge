import { getMode } from './registry.js';

/**
 * The one shape every mode hands to `recordSession`. `meta` carries anything
 * mode-specific (Battlefield's rank, Shadow Battle's combat outcome) through
 * untouched — the store's `'session'` reducer already spreads the whole
 * object, so new fields never require a schema or reducer change.
 * See docs/01-PRD.md §30.2 and
 * docs/superpowers/plans/2026-08-24-mode-registry.md Task 8.
 */
export function buildSessionPayload({ modeId, difficulty, run, lang = null, meta = {} }) {
  const mode = getMode(modeId);
  if (!mode) throw new Error(`buildSessionPayload: unknown mode id "${modeId}"`);

  return {
    ts: new Date().toISOString(),
    kind: mode.kind,
    mode: modeId,
    difficulty,
    lang,
    wpm: run.wpm,
    accuracy: run.accuracy,
    consistency: run.consistency,
    durationSec: run.durationSec,
    chars: run.chars,
    errors: run.errors,
    keyStats: run.keyStats,
    ...meta,
  };
}
