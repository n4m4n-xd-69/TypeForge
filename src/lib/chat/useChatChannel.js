import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteMessage as deleteMessageApi, fetchMessages, PAGE, sendMessage as sendMessageApi, subscribeToChannel,
} from './api.js';

/** A live INSERT, appended if its id isn't already present (see api.test.js's "own message" case). */
export function mergeIncoming(messages, incoming) {
  if (messages.some((m) => m.id === incoming.id)) return [...messages];
  return [...messages, incoming];
}

/** An older page, prepended, with anything the current list already has dropped. */
export function mergeOlderPage(messages, olderPage) {
  const known = new Set(messages.map((m) => m.id));
  return [...olderPage.filter((m) => !known.has(m.id)), ...messages];
}

/**
 * One channel's messages: loaded, paginated backward, and kept live.
 *
 * Shaped like `useBattleRoom.js` rather than Community's coalesced-refetch
 * feed — a chat has to stream messages in one at a time, not flash and
 * re-sort on every change. See the design spec §2 for why.
 */
export function useChatChannel(channelId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Reentrancy/staleness guards live in refs, not state — a `useCallback`
  // closure only sees state as of the render that created it, so two
  // synchronous calls to the same `loadMore` reference (a double-click, or
  // an IntersectionObserver firing twice in one tick) would both read
  // `loadingMore === false` and both fire. Same reasoning `useBattleRoom.js`
  // already applies to its own reentrancy guards.
  const loadingMoreRef = useRef(false);
  const exhaustedRef = useRef(false);
  // The channel this hook is *currently* showing, read at async-resolution
  // time so a slow `send`/`deleteMessage` from a channel the user has since
  // left doesn't splice its result into whatever channel is now on screen.
  const activeChannelRef = useRef(channelId);

  useEffect(() => {
    activeChannelRef.current = channelId;
  }, [channelId]);

  useEffect(() => {
    if (!channelId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setExhausted(false);
    exhaustedRef.current = false;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    fetchMessages(channelId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      const done = rows.length < PAGE;
      setExhausted(done);
      exhaustedRef.current = done;
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return undefined;
    return subscribeToChannel(channelId, (row) => {
      setMessages((prev) => mergeIncoming(prev, row));
    });
  }, [channelId]);

  const loadMore = useCallback(async () => {
    const current = messagesRef.current;
    if (!current.length || loadingMoreRef.current || exhaustedRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const older = await fetchMessages(channelId, { before: current[0].created_at });
      if (activeChannelRef.current !== channelId) return;
      setMessages((prev) => mergeOlderPage(prev, older));
      if (older.length < PAGE) {
        exhaustedRef.current = true;
        setExhausted(true);
      }
    } finally {
      if (activeChannelRef.current === channelId) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [channelId]);

  const send = useCallback((body, imageUrl) => sendMessageApi(channelId, body, imageUrl)
    .then((row) => {
      if (row && activeChannelRef.current === channelId) {
        setMessages((prev) => mergeIncoming(prev, row));
      }
      return row;
    }), [channelId]);

  const remove = useCallback((id) => deleteMessageApi(id).then(() => {
    if (activeChannelRef.current === channelId) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }
  }), [channelId]);

  return { messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage: remove };
}
