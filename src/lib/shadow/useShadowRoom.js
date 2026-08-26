import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase.js';
import { measureClockOffset } from './clock.js';
import {
  fetchRoom,
  fetchRoster,
  fetchRounds,
  fetchResults,
  sendHeartbeat,
} from './api.js';

/**
 * useShadowRoom — Live 2-player Shadow Battle room hook.
 *
 * Implements dual-transport architecture (PRD §15.2):
 * 1. Durable Postgres Changes: Realtime table subscriptions to `shadow_rooms`,
 *    `shadow_players`, `shadow_rounds`, and `shadow_events` (all RLS-filtered).
 * 2. Ephemeral Broadcast Channel (`room:shadow:${roomId}`): Sub-millisecond
 *    keystroke & lane telemetry for opponent stickman animation without database writes.
 */

const HEARTBEAT_INTERVAL_MS = 5000;

export function useShadowRoom(roomId, userId) {
  const [room, setRoom] = useState(null);
  const [roster, setRoster] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [events, setEvents] = useState([]);
  const [results, setResults] = useState(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const channelRef = useRef(null);
  const telemetryListenersRef = useRef(new Set());
  const roomRef = useRef(null);
  roomRef.current = room;

  /* ── 1. Clock synchronization handshake ──────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    measureClockOffset().then((offset) => {
      if (!cancelled) setClockOffset(offset);
    });
    return () => { cancelled = true; };
  }, []);

  /* ── 2. Initial state hydration ──────────────────────────────────────── */
  const hydrate = useCallback(async () => {
    if (!roomId || !supabase || !userId) {
      setLoading(false);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const [roomData, rosterData, roundsData, resultsData] = await Promise.all([
        fetchRoom(roomId),
        fetchRoster(roomId),
        fetchRounds(roomId),
        fetchResults(roomId),
      ]);
      setRoom(roomData);
      setRoster(rosterData);
      setRounds(roundsData);
      setResults(resultsData.length > 0 ? resultsData : null);
      return roomData;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [roomId, userId]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /* ── 3. Realtime subscription (Postgres Changes + Broadcast) ─────────── */
  useEffect(() => {
    if (!roomId || !supabase || !userId) return undefined;

    const channelName = `room:shadow:${roomId}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    // Postgres Changes: Room record
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shadow_rooms', filter: `id=eq.${roomId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          setRoom(null);
        } else if (payload.new) {
          setRoom(payload.new);
        }
      }
    );

    // Postgres Changes: Players / Roster
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shadow_players', filter: `room_id=eq.${roomId}` },
      () => {
        fetchRoster(roomId).then(setRoster).catch(() => {});
      }
    );

    // Postgres Changes: Settled Rounds
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shadow_rounds', filter: `room_id=eq.${roomId}` },
      (payload) => {
        if (payload.new) {
          setRounds((prev) => [...prev.filter((r) => r.round !== payload.new.round), payload.new]);
        }
      }
    );

    // Postgres Changes: Match Results
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shadow_results', filter: `room_id=eq.${roomId}` },
      () => {
        fetchResults(roomId).then(setResults).catch(() => {});
      }
    );

    // Realtime Broadcast: Ephemeral live telemetry (typing progress & combat pops)
    channel.on('broadcast', { event: 'telemetry' }, ({ payload }) => {
      telemetryListenersRef.current.forEach((listener) => {
        try {
          listener(payload);
        } catch (e) {
          console.error('[ShadowRoom] telemetry listener error:', e);
        }
      });
    });

    channel.subscribe((status) => {
      setIsConnected(status === 'SUBSCRIBED');
    });

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [roomId, userId]);

  /* ── 4. Periodic heartbeat ───────────────────────────────────────────── */
  useEffect(() => {
    if (!roomId || !userId || !room) return undefined;
    if (['finished', 'abandoned', 'cancelled', 'expired'].includes(room.status)) return undefined;

    const interval = setInterval(() => {
      sendHeartbeat(roomId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [roomId, userId, room?.status]);

  /* ── 5. Telemetry broadcast methods ──────────────────────────────────── */
  const sendTelemetry = useCallback((telemetry) => {
    if (!channelRef.current || !isConnected) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'telemetry',
      payload: {
        userId,
        ...telemetry,
        ts: Date.now(),
      },
    });
  }, [userId, isConnected]);

  const subscribeTelemetry = useCallback((listener) => {
    telemetryListenersRef.current.add(listener);
    return () => {
      telemetryListenersRef.current.delete(listener);
    };
  }, []);

  /* ── 6. Derived seat & player properties ──────────────────────────────── */
  const selfPlayer = useMemo(() => {
    return roster.find((p) => p.user_id === userId) ?? null;
  }, [roster, userId]);

  const selfSeat = selfPlayer ? selfPlayer.seat : null;
  const isHost = selfPlayer ? selfPlayer.is_host : false;

  const opponent = useMemo(() => {
    return roster.find((p) => p.user_id !== userId) ?? null;
  }, [roster, userId]);

  return {
    room,
    roster,
    selfPlayer,
    selfSeat,
    isHost,
    opponent,
    rounds,
    events,
    results,
    clockOffset,
    loading,
    error,
    isConnected,
    sendTelemetry,
    subscribeTelemetry,
    refresh: hydrate,
  };
}

export default useShadowRoom;
