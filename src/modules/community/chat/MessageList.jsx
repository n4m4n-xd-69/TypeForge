// src/modules/community/chat/MessageList.jsx
import { useLayoutEffect, useRef } from 'react';
import { Bot, Loader2, Trash2 } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button.jsx';
import { Chip } from '../../../components/ui/Primitives.jsx';
import Avatar from '../../../components/ui/Avatar.jsx';
import { relativeTime } from '../../../lib/format.js';

export default function MessageList({
  messages, loading, loadingMore, exhausted, onLoadMore, currentUserId, onDelete,
}) {
  const bottomRef = useRef(null);
  const scrollerRef = useRef(null);
  const prevFirstIdRef = useRef(null);
  const prevLastIdRef = useRef(null);
  const prevScrollHeightRef = useRef(null);

  /*
   * Classifies every `messages` change from the data itself, rather than a
   * flag armed by whichever handler triggered it. A load-more click, a
   * live realtime insert, and the user's own send/delete can all update
   * `messages` while another one of them is still in flight — a
   * manually-armed "this is the update I'm waiting for" ref gets stolen by
   * whichever change lands first. Comparing this render's first/last
   * message id against the previous render's has no such race: it only
   * ever looks at the data that's actually here right now.
   *
   *   - first id changed, last id unchanged -> older messages were
   *     prepended (pagination). Keep the reader's visual position by
   *     shifting scrollTop by exactly how much taller the content got.
   *   - last id changed -> a message arrived at the tail (a live append,
   *     or this is the channel's first load). Jump to the bottom.
   *
   * useLayoutEffect, not useEffect: this has to run before the browser
   * paints, or the prepended content flashes into view for one frame
   * before scrollTop catches up.
   */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const firstId = messages.length ? messages[0].id : null;
    const lastId = messages.length ? messages[messages.length - 1].id : null;

    if (el) {
      const prependedAtTop = firstId !== null
        && prevFirstIdRef.current !== null
        && firstId !== prevFirstIdRef.current
        && lastId === prevLastIdRef.current;

      if (prependedAtTop && prevScrollHeightRef.current !== null) {
        el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      } else if (lastId !== null && lastId !== prevLastIdRef.current) {
        bottomRef.current?.scrollIntoView({ block: 'end' });
      }
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevScrollHeightRef.current = el ? el.scrollHeight : null;
  }, [messages]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  return (
    <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto p-2">
      {exhausted ? (
        <p className="py-1 text-center text-2xs text-ink-3">That's the start of the channel.</p>
      ) : (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mx-auto block text-2xs text-ink-3 underline hover:text-ink-2"
        >
          {loadingMore ? 'Loading…' : 'Load earlier messages'}
        </button>
      )}

      {messages.map((m) => (
        <div key={m.id} className="group flex gap-1.5">
          <Avatar value={m.photo_url ?? m.avatar} name={m.display_name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold">{m.display_name || 'Someone'}</span>
              {m.is_bot ? <Chip tone="brand"><Bot size={10} aria-hidden /> Bot</Chip> : null}
              <span className="text-2xs text-ink-3">{relativeTime(m.created_at)}</span>
              {m.user_id === currentUserId ? (
                <IconButton
                  size="sm"
                  label="Delete this message"
                  icon={Trash2}
                  onClick={() => onDelete(m.id)}
                  className="ml-auto opacity-0 group-hover:opacity-100"
                />
              ) : null}
            </div>
            {m.body ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p> : null}
            {m.image_url ? (
              <img src={m.image_url} alt="" loading="lazy" className="mt-1 max-h-72 rounded-md border border-line" />
            ) : null}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
