import { serverTime } from './api.js';

/**
 * Clock offset synchronization for Shadow Battle duels.
 *
 * Implements high-precision NTP-style clock offset measurement against Postgres
 * clock_timestamp() via arena_server_time().
 *
 * Monotonic endpoints (performance.timeOrigin + performance.now()) prevent local
 * clock adjustments during the handshake from corrupting the measurement.
 */

export async function measureClockOffset(samples = 5) {
  const readings = [];

  for (let i = 0; i < samples; i++) {
    const t0 = performance.timeOrigin + performance.now();
    let res;
    try {
      res = await serverTime();
    } catch {
      break; // Offline or unauthenticated — fallback to 0
    }
    const t1 = performance.timeOrigin + performance.now();
    const serverIso = typeof res === 'string' ? res : res?.server_time;
    const serverMs = typeof res?.epoch_ms === 'number' ? res.epoch_ms : Date.parse(serverIso);
    if (Number.isNaN(serverMs)) continue;

    const rtt = t1 - t0;
    const offset = serverMs + rtt / 2 - t1;
    readings.push({ rtt, offset });
  }

  if (!readings.length) return 0;

  // Filter for lowest latency samples to eliminate asymmetric routing jitter
  readings.sort((a, b) => a.rtt - b.rtt);
  const best = readings.slice(0, Math.min(3, readings.length)).map((r) => r.offset).sort((a, b) => a - b);
  return Math.round(best[Math.floor(best.length / 2)]);
}

/** Server time in epoch ms, as estimated by this client */
export const serverNow = (offset = 0) => Date.now() + offset;

/** Milliseconds remaining until an ISO timestamp arrives on server clock */
export function msUntil(iso, offset = 0) {
  if (!iso) return null;
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return at - serverNow(offset);
}

/** Check whether a server deadline has elapsed */
export function isDeadlinePassed(iso, offset = 0) {
  const remaining = msUntil(iso, offset);
  return remaining !== null && remaining <= 0;
}
