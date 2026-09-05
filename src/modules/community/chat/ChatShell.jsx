// src/modules/community/chat/ChatShell.jsx
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users, X } from 'lucide-react';
import { EmptyState } from '../../../components/ui/Primitives.jsx';
import { useAuth } from '../../../lib/auth.jsx';
import { fetchChannels } from '../../../lib/chat/api.js';
import { useChatChannel } from '../../../lib/chat/useChatChannel.js';
import ChannelSidebar from './ChannelSidebar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import IntroModal from '../IntroModal.jsx';

/**
 * The full-screen chat takeover — same escape `ShadowArena.jsx` already uses
 * to get out of AppShell's padded content area: a `fixed inset-0` overlay
 * with its own header, a body that fills the rest, and (here) a composer
 * pinned to the true bottom of the viewport rather than the bottom of a card.
 */
export default function ChatShell() {
  const navigate = useNavigate();
  const { channelSlug } = useParams();
  const { user, cloudEnabled } = useAuth();
  const [channels, setChannels] = useState(null);

  useEffect(() => {
    if (!cloudEnabled) return;
    fetchChannels().then(setChannels);
  }, [cloudEnabled]);

  if (!cloudEnabled || !user) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-bg">
        <EmptyState icon={Users} title="Join the Community" description="Sign in to chat." />
      </div>
    );
  }

  if (channels === null) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-bg">
        <Loader2 size={20} className="animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  if (channels.length === 0) return null;

  const active = channels.find((c) => c.slug === channelSlug) ?? channels[0];
  if (!channelSlug) return <Navigate to={`/community/chat/${active.slug}`} replace />;
  if (active.slug !== channelSlug) return <Navigate to={`/community/chat/${active.slug}`} replace />;

  return <ActiveChannel channel={active} channels={channels} onExit={() => navigate('/community')} />;
}

function ActiveChannel({ channel, channels, onExit }) {
  const { user } = useAuth();
  const {
    messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage,
  } = useChatChannel(channel.id);
  const [pendingAi, setPendingAi] = useState(null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-ink">
      <IntroModal />
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          onClick={onExit}
          title="Leave chat (Esc)"
          aria-label="Leave chat"
          className="grid h-[32px] w-[32px] place-items-center rounded-sm border border-line bg-surface text-ink-3 hover:text-ink"
        >
          <X size={15} strokeWidth={2.2} aria-hidden />
        </button>
        <span className="text-sm font-bold">{channel.name}</span>
        <Link to="/community" className="ml-auto text-2xs text-ink-3 underline hover:text-ink-2">
          Back to Feed
        </Link>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ChannelSidebar channels={channels} activeSlug={channel.slug} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={messages}
            loading={loading}
            loadingMore={loadingMore}
            exhausted={exhausted}
            onLoadMore={loadMore}
            currentUserId={user?.id}
            onDelete={deleteMessage}
          />
          <Composer onSend={send} onAiCommand={setPendingAi} />
        </div>
      </div>
    </div>
  );
}
