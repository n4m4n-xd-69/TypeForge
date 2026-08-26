import { describe, it, expect } from 'vitest';
import {
  minPlausibleMs,
  checkEventPlausibility,
  isIkiSynthetic,
  validateEventBatch,
} from './antiCheat.js';

describe('shadow/antiCheat.js (PRD §21)', () => {
  describe('minPlausibleMs', () => {
    it('computes 55 + 18 * chars per PRD §21.2 #1', () => {
      expect(minPlausibleMs(0)).toBe(55);
      expect(minPlausibleMs(5)).toBe(55 + 18 * 5); // 145ms
      expect(minPlausibleMs(10)).toBe(55 + 18 * 10); // 235ms
    });
  });

  describe('checkEventPlausibility', () => {
    it('accepts legitimate human typing speeds', () => {
      // 5 chars in 800ms (~75 WPM)
      const event = { t_start: 1000, t_end: 1800, keystrokes: 5 };
      const res = checkEventPlausibility(event);
      expect(res.plausible).toBe(true);
      expect(res.flags).toEqual([]);
      expect(res.wpm).toBe(75);
    });

    it('flags superhuman bursts exceeding 300 WPM', () => {
      // 5 chars in 100ms (600 WPM)
      const event = { t_start: 1000, t_end: 1100, keystrokes: 5 };
      const res = checkEventPlausibility(event);
      expect(res.plausible).toBe(false);
      expect(res.flags).toContain('SUB_HUMAN_FLOOR');
      expect(res.flags).toContain('SUPERHUMAN_BURST_300');
    });
  });

  describe('isIkiSynthetic', () => {
    it('flags unnatural uniform inter-keystroke intervals (σ/μ < 0.08)', () => {
      // Script sending key every 50ms +/- 2ms: mean=50, stdev=2 (ratio 0.04)
      expect(isIkiSynthetic(50, 2)).toBe(true);
      expect(isIkiSynthetic(100, 3)).toBe(true);
    });

    it('passes natural human irregular intervals (σ/μ >= 0.25)', () => {
      // Human typing mean=120ms, stdev=40ms (ratio 0.33)
      expect(isIkiSynthetic(120, 40)).toBe(false);
      expect(isIkiSynthetic(80, 20)).toBe(false);
    });
  });

  describe('validateEventBatch', () => {
    it('validates monotonic batch of events', () => {
      const events = [
        { seq: 0, t_start: 1000, t_end: 1800, keystrokes: 5, iki_mean: 120, iki_stdev: 35 },
        { seq: 1, t_start: 1850, t_end: 2600, keystrokes: 6, iki_mean: 110, iki_stdev: 30 },
      ];

      const res = validateEventBatch(events, 0, 90000);
      expect(res.valid).toBe(true);
      expect(res.flags).toEqual([]);
    });

    it('flags non-monotonic sequence gaps', () => {
      const events = [
        { seq: 0, t_start: 1000, t_end: 1800, keystrokes: 5 },
        { seq: 3, t_start: 1850, t_end: 2600, keystrokes: 6 }, // gap
      ];

      const res = validateEventBatch(events, 0, 90000);
      expect(res.valid).toBe(false);
      expect(res.flags).toContain('NON_MONOTONIC_SEQ');
    });

    it('flags synthetic IKI distributions in batch', () => {
      const events = [
        { seq: 0, t_start: 1000, t_end: 1800, keystrokes: 5, iki_mean: 80, iki_stdev: 2 }, // script
      ];

      const res = validateEventBatch(events, 0, 90000);
      expect(res.flags).toContain('SYNTHETIC_IKI_VARIANCE');
    });
  });
});
