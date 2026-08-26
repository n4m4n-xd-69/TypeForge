import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordInputLatency,
  computeLatencyQuantiles,
  resetLatencySamples,
  emitShadowTelemetry,
  getTelemetryEvents,
  clearTelemetryEvents,
} from './telemetry.js';

describe('Shadow Battle Polish & Telemetry (PRD §30, §31)', () => {
  beforeEach(() => {
    resetLatencySamples();
    clearTelemetryEvents();
  });

  describe('Input Latency Quantiles (PRD §30)', () => {
    it('computes accurate percentiles from recorded samples', () => {
      // 100 samples from 0.1ms to 10ms (fast frames well under budget)
      for (let i = 1; i <= 100; i++) {
        recordInputLatency(i * 0.1); // 0.1ms to 10.0ms
      }

      const q = computeLatencyQuantiles();
      expect(q.count).toBe(100);
      expect(q.p50).toBeCloseTo(5.05, 0.5);
      expect(q.p95).toBeCloseTo(9.5, 0.5);
      expect(q.passesBudget).toBe(true);
    });

    it('flags latency budget violations when p95 > 16ms or p99 > 33ms', () => {
      // Simulate slow frames
      for (let i = 0; i < 90; i++) recordInputLatency(10);
      for (let i = 0; i < 10; i++) recordInputLatency(45);

      const q = computeLatencyQuantiles();
      expect(q.p95).toBeGreaterThan(16);
      expect(q.passesBudget).toBe(false);
    });

    it('handles empty samples gracefully', () => {
      const q = computeLatencyQuantiles([]);
      expect(q.count).toBe(0);
      expect(q.p50).toBe(0);
      expect(q.passesBudget).toBe(true);
    });
  });

  describe('Telemetry & Analytics (PRD §31)', () => {
    it('emits match lifecycle and progression events', () => {
      emitShadowTelemetry('shadow_match_start', {
        mode: 'trial',
        botProfile: 'ronin',
        band: 'steel',
      });

      emitShadowTelemetry('shadow_match_complete', {
        mode: 'trial',
        botProfile: 'ronin',
        winner: 0,
        roundsPlayed: 3,
      });

      const events = getTelemetryEvents();
      expect(events.length).toBe(2);
      expect(events[0].event).toBe('shadow_match_start');
      expect(events[0].properties.botProfile).toBe('ronin');
      expect(events[1].event).toBe('shadow_match_complete');
      expect(events[1].properties.winner).toBe(0);
    });
  });
});
