import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './api.js';
import { supabase } from '../supabase.js';

vi.mock('../supabase.js', () => {
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(),
    },
  };
});

describe('shadow/api.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shadowErrorMessage', () => {
    it('translates known SB error codes to human friendly copy', () => {
      expect(api.shadowErrorMessage({ code: 'SB000' })).toContain('Sign in first');
      expect(api.shadowErrorMessage({ code: 'SB001' })).toContain('No duel found with that code');
      expect(api.shadowErrorMessage({ code: 'SB005' })).toContain('Only the host can start');
      expect(api.shadowErrorMessage({ code: '42501' })).toContain('Sign in first');
    });

    it('falls back to error message or generic string', () => {
      expect(api.shadowErrorMessage({ message: 'Custom error' })).toBe('Custom error');
      expect(api.shadowErrorMessage({})).toBe('Something went wrong.');
      expect(api.shadowErrorMessage(null)).toBeNull();
    });
  });

  describe('RPC calls', () => {
    it('createRoom calls shadow_create RPC with params', async () => {
      supabase.rpc.mockResolvedValueOnce({ data: { room: { id: 'room-1' }, pin: 'A1B2' }, error: null });

      const res = await api.createRoom({ visibility: 'public', fighterId: 'ronin', rated: true, band: 'damascus' });
      expect(supabase.rpc).toHaveBeenCalledWith('shadow_create', {
        p_visibility: 'public',
        p_fighter_id: 'ronin',
        p_rated: true,
        p_band: 'damascus',
      });
      expect(res.pin).toBe('A1B2');
    });

    it('joinRoom normalizes pin and calls shadow_join', async () => {
      supabase.rpc.mockResolvedValueOnce({ data: { room_id: 'room-1', seat: 1 }, error: null });

      const res = await api.joinRoom(' a1b2 ', 'adept');
      expect(supabase.rpc).toHaveBeenCalledWith('shadow_join', {
        p_pin: 'A1B2',
        p_fighter_id: 'adept',
      });
      expect(res.seat).toBe(1);
    });

    it('appendEvents early exits on empty array and passes array on non-empty', async () => {
      expect(await api.appendEvents('r1', [])).toBe(0);
      expect(supabase.rpc).not.toHaveBeenCalled();

      supabase.rpc.mockResolvedValueOnce({ data: 2, error: null });
      const count = await api.appendEvents('r1', [{ seq: 1 }, { seq: 2 }]);
      expect(supabase.rpc).toHaveBeenCalledWith('shadow_event_append', {
        p_room_id: 'r1',
        p_events: [{ seq: 1 }, { seq: 2 }],
      });
      expect(count).toBe(2);
    });

    it('settleRound calls shadow_settle_round RPC', async () => {
      supabase.rpc.mockResolvedValueOnce({ data: { round: 1, winner_seat: 0 }, error: null });

      const res = await api.settleRound('r1', {
        round: 1,
        winnerSeat: 0,
        hpP0: 600,
        hpP1: 0,
        reason: 'knockout',
        durationMs: 45000,
      });

      expect(supabase.rpc).toHaveBeenCalledWith('shadow_settle_round', {
        p_room_id: 'r1',
        p_round: 1,
        p_winner_seat: 0,
        p_hp_p0: 600,
        p_hp_p1: 0,
        p_reason: 'knockout',
        p_duration_ms: 45000,
      });
      expect(res.winner_seat).toBe(0);
    });

    it('throws formatted error if RPC returns error', async () => {
      supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'SB003', message: 'Room full' } });

      await expect(api.joinRoom('FULL')).rejects.toThrow('That duel is already full.');
    });
  });
});
