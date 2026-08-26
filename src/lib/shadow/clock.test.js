import { describe, it, expect, vi, beforeEach } from 'vitest';
import { measureClockOffset, serverNow, msUntil, isDeadlinePassed } from './clock.js';
import * as api from './api.js';

describe('shadow/clock.js', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('measureClockOffset', () => {
    it('calculates median offset from server readings', async () => {
      // Mock serverTime returning a server time 2000ms ahead of local
      vi.spyOn(api, 'serverTime').mockImplementation(async () => {
        const now = performance.timeOrigin + performance.now();
        return {
          server_time: new Date(now + 2000).toISOString(),
          epoch_ms: Math.round(now + 2000),
        };
      });

      const offset = await measureClockOffset(3);
      // Offset should be approximately +2000ms (+/- 50ms)
      expect(offset).toBeGreaterThanOrEqual(1950);
      expect(offset).toBeLessThanOrEqual(2050);
    });

    it('returns 0 if serverTime fails or is unavailable', async () => {
      vi.spyOn(api, 'serverTime').mockRejectedValue(new Error('Network error'));
      const offset = await measureClockOffset(3);
      expect(offset).toBe(0);
    });
  });

  describe('serverNow & msUntil & isDeadlinePassed', () => {
    it('serverNow applies offset to Date.now()', () => {
      const now = Date.now();
      const calculated = serverNow(500);
      expect(calculated).toBeGreaterThanOrEqual(now + 490);
      expect(calculated).toBeLessThanOrEqual(now + 510);
    });

    it('msUntil returns remaining milliseconds until ISO time', () => {
      const futureIso = new Date(Date.now() + 10000).toISOString();
      const remaining = msUntil(futureIso, 0);
      expect(remaining).toBeGreaterThan(9500);
      expect(remaining).toBeLessThanOrEqual(10000);
    });

    it('isDeadlinePassed returns true when deadline in past', () => {
      const pastIso = new Date(Date.now() - 5000).toISOString();
      expect(isDeadlinePassed(pastIso, 0)).toBe(true);

      const futureIso = new Date(Date.now() + 5000).toISOString();
      expect(isDeadlinePassed(futureIso, 0)).toBe(false);
    });
  });
});
