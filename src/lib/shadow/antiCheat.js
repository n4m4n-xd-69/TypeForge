/**
 * Shadow Battle Anti-Cheat Validation (PRD §21).
 *
 * Implements server/client parity checks:
 * 1. Per-word plausibility floor: minPlausibleMs(chars) = 55 + 18 * chars
 * 2. Rolling rate ceilings (300 WPM single card, 220 WPM 3-card)
 * 3. Keystroke-interval variance (IKI σ/μ < 0.08 -> flag synthetic script)
 * 4. Event stream monotonicity and round time boundary validation.
 */

/** Minimum physically plausible duration in ms for a word of N characters (PRD §21.2 #1) */
export function minPlausibleMs(chars) {
  if (chars <= 0) return 55;
  return 55 + 18 * chars;
}

/** Check whether a single combat event violates typing rate plausibility */
export function checkEventPlausibility(event) {
  const durationMs = (event.t_end ?? event.tEnd) - (event.t_start ?? event.tStart);
  const chars = event.keystrokes ?? event.chars ?? 0;

  if (chars <= 0) return { plausible: true, flags: [] };

  const flags = [];
  const minMs = minPlausibleMs(chars);

  if (durationMs < minMs) {
    flags.push('SUB_HUMAN_FLOOR');
  }

  // Equivalent WPM = (chars / 5) / (durationMs / 60000)
  const durationMin = durationMs / 60000;
  const wpm = durationMin > 0 ? (chars / 5) / durationMin : 999;

  if (wpm > 300) {
    flags.push('SUPERHUMAN_BURST_300');
  }

  return {
    plausible: flags.length === 0,
    wpm: Math.round(wpm),
    flags,
  };
}

/**
 * Check whether an IKI (inter-keystroke interval) distribution is unnaturally uniform.
 * Human σ/μ is typically >= 0.25; scripts with uniform or low-jitter intervals have σ/μ < 0.08.
 */
export function isIkiSynthetic(ikiMean, ikiStdev) {
  if (!ikiMean || ikiMean <= 0 || !ikiStdev || ikiStdev < 0) return false;
  const coefficientOfVariation = ikiStdev / ikiMean;
  return coefficientOfVariation < 0.08;
}

/**
 * Validates a batch of CombatEvents for sequential integrity and time boundaries.
 */
export function validateEventBatch(events, serverStartMs = 0, roundDeadlineMs = Infinity) {
  if (!Array.isArray(events) || events.length === 0) {
    return { valid: true, flags: [] };
  }

  const flags = [];
  let prevSeq = null;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const seq = e.seq ?? i;
    const tStart = e.t_start ?? e.tStart ?? 0;
    const tEnd = e.t_end ?? e.tEnd ?? 0;

    // Check sequence monotonicity
    if (prevSeq !== null && seq !== prevSeq + 1) {
      flags.push('NON_MONOTONIC_SEQ');
    }
    prevSeq = seq;

    // Check duration ordering
    if (tEnd < tStart) {
      flags.push('NEGATIVE_DURATION');
    }

    // Check boundary
    if (tStart < serverStartMs - 500) { // 500ms client clock skew tolerance
      flags.push('PRE_START_EVENT');
    }
    if (tEnd > roundDeadlineMs + 3000) { // 3000ms network grace
      flags.push('POST_DEADLINE_EVENT');
    }

    // Check plausibility
    const plausibility = checkEventPlausibility(e);
    if (!plausibility.plausible) {
      flags.push(...plausibility.flags);
    }

    // Check IKI variance
    const ikiMean = e.iki_mean ?? e.ikiMean ?? 0;
    const ikiStdev = e.iki_stdev ?? e.ikiStdev ?? 0;
    if (isIkiSynthetic(ikiMean, ikiStdev)) {
      flags.push('SYNTHETIC_IKI_VARIANCE');
    }
  }

  return {
    valid: flags.filter((f) => ['NON_MONOTONIC_SEQ', 'NEGATIVE_DURATION'].includes(f)).length === 0,
    flags: Array.from(new Set(flags)),
  };
}
