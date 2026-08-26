import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.js';

/**
 * useMatchmaking — Automated ranked/casual duel queue hook (PRD §16).
 *
 * Enqueues the player into `shadow_queue` and listens for server-side matchmaking
 * resolution populating `matched_room_id`.
 */

export function useMatchmaking(userId) {
  const [isQueuing, setIsQueuing] = useState(false);
  const [matchedRoomId, setMatchedRoomId] = useState(null);
  const [queueTimeSec, setQueueTimeSec] = useState(0);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const channelRef = useRef(null);

  const dequeue = useCallback(async () => {
    if (!supabase || !userId) return;
    try {
      await supabase.from('shadow_queue').delete().eq('user_id', userId);
    } catch {
      // Best-effort dequeue
    } finally {
      setIsQueuing(false);
      setQueueTimeSec(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [userId]);

  const enqueue = useCallback(async ({ fighterId = 'standard', band = 'steel', fr = 1200 } = {}) => {
    if (!supabase || !userId) {
      setError(new Error('Sign in required for matchmaking'));
      return;
    }

    setError(null);
    setMatchedRoomId(null);
    setQueueTimeSec(0);

    try {
      const { error: insertError } = await supabase.from('shadow_queue').upsert({
        user_id: userId,
        fighter_id: fighterId,
        band,
        fr,
        enqueued_at: new Date().toISOString(),
        matched_room_id: null,
      });

      if (insertError) throw insertError;

      setIsQueuing(true);
      timerRef.current = setInterval(() => {
        setQueueTimeSec((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError(err);
      setIsQueuing(false);
    }
  }, [userId]);

  // Realtime listener for match notification
  useEffect(() => {
    if (!supabase || !userId || !isQueuing) return undefined;

    const channel = supabase
      .channel(`queue:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shadow_queue',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new?.matched_room_id) {
            setMatchedRoomId(payload.new.matched_room_id);
            setIsQueuing(false);
            if (timerRef.current) clearInterval(timerRef.current);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, isQueuing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    isQueuing,
    matchedRoomId,
    queueTimeSec,
    error,
    enqueue,
    dequeue,
  };
}

export default useMatchmaking;
