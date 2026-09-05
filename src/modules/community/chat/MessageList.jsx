import { useEffect, useRef } from 'react';
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
  const lastIdRef = useRef(null);
  const prevScrollHeightRef = useRef(null);

  /* Auto-scroll to the newest message, but only when the *last* message
     actually changed. Comparing array length can't tell "a new message
     arrived at the bottom" from "an older page was prepended at the top" —
     both grow the array by the same amount. Comparing the tail id can:
     prepending never changes what the last element is. */
  useEffect(() => {
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    if (lastId !== null && lastId !== lastIdRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    lastIdRef.current = lastId;
  }, [messages]);

  /* Loading an older page prepends content above whatever the user is
     currently reading. A scroll container's scrollTop is a fixed pixel
     offset from the top, not anchored to content, so without this the
     newly prepended messages push the reader's place down the page.
     Capturing the scroll height right before the fetch and restoring the
     same offset after the DOM updates keeps their position pixel-stable. */
  const handleLoadMore = () => {
    if (scrollerRef.current) prevScrollHeightRef.current = scrollerRef.current.scrollHeight;
    onLoadMore();
  };

  useEffect(() => {
    if (prevScrollHeightRef.current == null || !scrollerRef.current) return;
    const delta = scrollerRef.current.scrollHeight - prevScrollHeightRef.current;
    scrollerRef.current.scrollTop += delta;
    prevScrollHeightRef.current = null;
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
          onClick={handleLoadMore}
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
