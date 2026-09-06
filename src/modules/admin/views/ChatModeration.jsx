import { useEffect, useState } from 'react';
import { Trash2, Volume2, VolumeX } from 'lucide-react';
import { Card } from '../../../components/ui/Primitives.jsx';
import Button, { IconButton } from '../../../components/ui/Button.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { relativeTime } from '../../../lib/format.js';
import {
  adminDeleteChatMessage, adminMuteChatUser, adminUnmuteChatUser,
  fetchActiveChatMutes, fetchRecentChatMessages,
} from '../api/console.js';

/**
 * Time left on a mute.
 *
 * `relativeTime` is past-only — it computes `now - then`, so any future
 * timestamp lands under a minute and reports "just now", which is exactly
 * backwards for an expiry. A mute expiring in 59 minutes must not read as
 * one that already lapsed.
 */
function expiresIn(iso) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins < 1) return 'expiring now';
  if (mins < 60) return `${mins}m left`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

export default function ChatModeration() {
  const { toast } = useToast();
  const [messages, setMessages] = useState(null);
  const [mutes, setMutes] = useState([]);

  /* Both lists reload together: muting from the message list has to make the
     mute appear in the list that can lift it, or this panel can put someone
     in a state it offers no way out of. */
  const load = () => Promise.all([
    fetchRecentChatMessages().then(setMessages),
    fetchActiveChatMutes().then(setMutes),
  ]);
  useEffect(() => { load(); }, []);

  const onDelete = async (id) => {
    try {
      await adminDeleteChatMessage(id);
      toast('Message removed', { tone: 'success' });
      load();
    } catch (err) {
      toast(err.message ?? 'Could not remove that.', { tone: 'error' });
    }
  };

  const onMute = async (userId, channelId) => {
    try {
      await adminMuteChatUser(userId, channelId, 60, 'Muted from the moderation console');
      toast('Muted for 60 minutes', { tone: 'success' });
      load();
    } catch (err) {
      toast(err.message ?? 'Could not mute that user.', { tone: 'error' });
    }
  };

  const onUnmute = async (userId, channelId) => {
    try {
      await adminUnmuteChatUser(userId, channelId);
      toast('Mute lifted', { tone: 'success' });
      load();
    } catch (err) {
      toast(err.message ?? 'Could not lift that mute.', { tone: 'error' });
    }
  };

  if (messages === null) return <Card className="p-3"><p className="text-sm text-ink-3">Loading…</p></Card>;

  return (
    <div className="space-y-2.5">
      {/* Active mutes lead: a mute nobody can see is a mute nobody can lift. */}
      {mutes.length > 0 ? (
        <Card className="p-2.5">
          <h2 className="text-sm font-bold">Active mutes</h2>
          <ul className="mt-1.5 space-y-1">
            {mutes.map((m) => (
              <li key={m.id} className="flex items-center gap-1.5 border-b border-line/60 py-1 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-2xs text-ink-2">{m.user_id.slice(0, 8)}</span>{' '}
                  <span className="text-2xs text-ink-3">
                    {m.channel_id ? 'one channel' : 'all channels'} · {expiresIn(m.muted_until)}
                  </span>
                  {m.reason ? <p className="truncate text-2xs text-ink-3">{m.reason}</p> : null}
                </div>
                <Button size="sm" variant="ghost" icon={Volume2} onClick={() => onUnmute(m.user_id, m.channel_id)}>
                  Unmute
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-2.5">
        <h2 className="text-sm font-bold">Recent chat messages</h2>
        <ul className="mt-1.5 space-y-1">
          {messages.map((m) => (
            <li key={m.id} className="flex items-start gap-1.5 border-b border-line/60 py-1 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-bold">{m.display_name || 'Someone'}</span>{' '}
                <span className="text-2xs text-ink-3">{relativeTime(m.created_at)}</span>
                {m.deleted_at ? <span className="ml-1 text-2xs text-bad">removed</span> : null}
                <p className="truncate text-ink-2">{m.body}</p>
              </div>
              {!m.deleted_at ? (
                <>
                  <IconButton size="sm" label="Delete" icon={Trash2} onClick={() => onDelete(m.id)} />
                  <Button size="sm" variant="ghost" icon={VolumeX} onClick={() => onMute(m.user_id, m.channel_id)}>
                    Mute 60m
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
