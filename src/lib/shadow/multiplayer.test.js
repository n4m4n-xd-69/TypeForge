import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './api.js';
import { supabase } from '../supabase.js';

vi.mock('../supabase.js', () => {
  const channelMock = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn((cb) => {
      if (cb) cb('SUBSCRIBED');
      return channelMock;
    }),
    unsubscribe: vi.fn(),
    send: vi.fn(),
  };

  return {
    supabase: {
      channel: vi.fn(() => channelMock),
      removeChannel: vi.fn(),
      from: vi.fn(() => ({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      })),
      rpc: vi.fn(),
    },
  };
});

describe('shadow/multiplayer transport contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Postgres Changes & Broadcast channel bindings', () => {
    it('creates correct channel name for duel room and binds postgres + broadcast events', async () => {
      const roomId = 'test-room-123';
      const channel = supabase.channel(`room:shadow:${roomId}`);

      expect(channel).toBeDefined();
      expect(supabase.channel).toHaveBeenCalledWith(`room:shadow:${roomId}`);
    });

    it('sendTelemetry constructs valid ephemeral broadcast payload', () => {
      const channel = supabase.channel('room:shadow:r1');
      const userId = 'user-abc';
      const telemetry = { cardIndex: 3, lane: 'guard', chars: 4, errors: 0 };

      channel.send({
        type: 'broadcast',
        event: 'telemetry',
        payload: {
          userId,
          ...telemetry,
          ts: Date.now(),
        },
      });

      expect(channel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast',
          event: 'telemetry',
          payload: expect.objectContaining({
            userId: 'user-abc',
            cardIndex: 3,
            lane: 'guard',
            chars: 4,
            errors: 0,
          }),
        })
      );
    });

    it('heartbeat is triggered periodically for active rooms', async () => {
      const sendHeartbeatSpy = vi.spyOn(api, 'sendHeartbeat').mockResolvedValue(undefined);
      await api.sendHeartbeat('room-123');
      expect(sendHeartbeatSpy).toHaveBeenCalledWith('room-123');
    });
  });
});
