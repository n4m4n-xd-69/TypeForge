// src/modules/community/chat/MessageList.jsx
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
  const prevLength = useRef(0);

  /* Auto-scroll to the newest message, but only when the list actually grew
     at the bottom — loading an older page must not yank the view down. */
  useEffect(() => {
    if (messages.length > prevLength.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    prevLength.current = messages.length;
  }, [messages.length]);

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
