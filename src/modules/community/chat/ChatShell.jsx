// src/modules/community/chat/ChatShell.jsx
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, MessagesSquare, Users, X } from 'lucide-react';
import { EmptyState } from '../../../components/ui/Primitives.jsx';
import Button from '../../../components/ui/Button.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { useAuth } from '../../../lib/auth.jsx';
import { supabase } from '../../../lib/supabase.js';
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
  const { user, cloudEnabled, openAuthModal } = useAuth();
  const [channels, setChannels] = useState(null);

  useEffect(() => {
    if (!cloudEnabled) return;
    fetchChannels().then(setChannels);
  }, [cloudEnabled]);

  if (!cloudEnabled) {
    return (
      <ChatOverlay>
        <EmptyState
          icon={Users}
          title="Chat needs the cloud"
          description="This build has no Supabase keys configured, so there is nobody to talk to."
        />
      </ChatOverlay>
    );
  }

  if (!user) {
    return (
      <ChatOverlay>
        <EmptyState
          icon={Users}
          title="Join the Community"
          description="Sign in to chat. A name is enough — no email needed."
          action={(
            <Button variant="primary" onClick={() => openAuthModal('sign-up')}>
              Get started
            </Button>
          )}
        />
      </ChatOverlay>
    );
  }

  if (channels === null) {
    return (
      <ChatOverlay>
        <Loader2 size={20} className="animate-spin text-ink-3" aria-hidden />
      </ChatOverlay>
    );
  }

  /* An empty list is not nothing to say. `fetchChannels` degrades to [] for
     both "no channels seeded" and "the read failed" (migration 0029 not
     applied yet, say), and rendering null for either left a blank white
     screen with no way back — this overlay covers the nav rail, so there was
     no exit but the browser's back button. */
  if (channels.length === 0) {
    return (
      <ChatOverlay>
        <EmptyState
          icon={MessagesSquare}
          title="Chat isn't ready yet"
          description="No channels are set up on this project. If you're the operator, the chat migrations may not have been applied."
        />
      </ChatOverlay>
    );
  }

  const active = channels.find((c) => c.slug === channelSlug) ?? channels[0];
  if (!channelSlug) return <Navigate to={`/community/chat/${active.slug}`} replace />;
  if (active.slug !== channelSlug) return <Navigate to={`/community/chat/${active.slug}`} replace />;

  return <ActiveChannel channel={active} channels={channels} onExit={() => navigate('/community')} />;
}

/**
 * Every full-screen state that is not a live channel needs its own way out:
 * this overlay sits above the nav rail, so without a link here the only exit
 * is the browser's back button.
 */
function ChatOverlay({ children }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-bg p-3">
      {children}
      <Button as={Link} to="/community" size="sm" variant="ghost" icon={ArrowLeft}>
        Back to Community
      </Button>
    </div>
  );
}

function ActiveChannel({ channel, channels, onExit }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    messages, loading, loadingMore, exhausted, loadMore, send, deleteMessage,
  } = useChatChannel(channel.id);
  const [pendingAi, setPendingAi] = useState(null);

  useEffect(() => {
    if (!pendingAi) return;
    const messageId = pendingAi;
    setPendingAi(null);
    supabase.functions.invoke('chat-ai-reply', { body: { messageId } }).then(({ error }) => {
      if (error) toast('The AI could not answer that.', { tone: 'error' });
      // A success needs no handling here — the reply arrives through the
      // same postgres_changes subscription useChatChannel already holds.
    });
  }, [pendingAi, toast]);

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
