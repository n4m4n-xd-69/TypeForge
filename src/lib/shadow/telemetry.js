/**
 * Shadow Battle Telemetry & Performance Profiling (PRD §30, §31).
 *
 * Tracks input-to-render latency samples and matches performance budgets:
 * Budget: p95 <= 16ms (1 frame at 60fps), p99 <= 33ms.
 */

let latencySamples = [];

/** Record a single keystroke input-to-render latency sample in milliseconds */
export function recordInputLatency(latencyMs) {
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
    latencySamples.push(latencyMs);
    // Keep bounded in memory (last 500 keystrokes)
    if (latencySamples.length > 500) {
      latencySamples.shift();
    }
  }
}

/** Get all current latency samples */
export function getLatencySamples() {
  return [...latencySamples];
}

/** Reset latency samples */
export function resetLatencySamples() {
  latencySamples = [];
}

/** Compute p50, p95, p99, mean, max latency quantiles */
export function computeLatencyQuantiles(samples = latencySamples) {
  if (!samples || samples.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, mean: 0, max: 0, passesBudget: true };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;

  const quantile = (q) => {
    const pos = (count - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };

  const p50 = Math.round(quantile(0.5) * 10) / 10;
  const p95 = Math.round(quantile(0.95) * 10) / 10;
  const p99 = Math.round(quantile(0.99) * 10) / 10;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round((sum / count) * 10) / 10;
  const max = Math.round(sorted[count - 1] * 10) / 10;

  // PRD §30: p95 <= 16ms, p99 <= 33ms
  const passesBudget = p95 <= 16 && p99 <= 33;

  return {
    count,
    p50,
    p95,
    p99,
    mean,
    max,
    passesBudget,
  };
}

/** Event log sink for analytics */
let eventSink = [];

export function emitShadowTelemetry(eventName, properties = {}) {
  const event = {
    event: eventName,
    properties: {
      ...properties,
      ts: Date.now(),
    },
  };
  eventSink.push(event);
  if (eventSink.length > 200) eventSink.shift();
  return event;
}

export function getTelemetryEvents() {
  return [...eventSink];
}

export function clearTelemetryEvents() {
  eventSink = [];
}
