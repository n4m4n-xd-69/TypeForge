import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteMessage as deleteMessageApi, fetchMessages, sendMessage as sendMessageApi, subscribeToChannel,
} from './api.js';

const PAGE = 50;

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

  useEffect(() => {
    if (!channelId) return undefined;
    let cancelled = false;
    setLoading(true);
    setExhausted(false);
    fetchMessages(channelId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setExhausted(rows.length < PAGE);
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
    if (!current.length || loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const older = await fetchMessages(channelId, { before: current[0].created_at });
      setMessages((prev) => mergeOlderPage(prev, older));
      if (older.length < PAGE) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, loadingMore, exhausted]);

  const send = useCallback((body, imageUrl) => sendMessageApi(channelId, body, imageUrl)
    .then((row) => {
      if (row) setMessages((prev) => mergeIncoming(prev, row));
      return row;
    }), [channelId]);

  const remove = useCallback((id) => deleteMessageApi(id).then(() => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }), []);

  return { messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage: remove };
}
