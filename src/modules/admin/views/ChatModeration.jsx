import { useEffect, useState } from 'react';
import { Trash2, VolumeX } from 'lucide-react';
import { Card } from '../../../components/ui/Primitives.jsx';
import Button, { IconButton } from '../../../components/ui/Button.jsx';
import { useToast } from '../../../components/ui/Toast.jsx';
import { relativeTime } from '../../../lib/format.js';
import {
  adminDeleteChatMessage, adminMuteChatUser, fetchRecentChatMessages,
} from '../api/console.js';

export default function ChatModeration() {
  const { toast } = useToast();
  const [messages, setMessages] = useState(null);

  const load = () => fetchRecentChatMessages().then(setMessages);
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
    } catch (err) {
      toast(err.message ?? 'Could not mute that user.', { tone: 'error' });
    }
  };

  if (messages === null) return <Card className="p-3"><p className="text-sm text-ink-3">Loading…</p></Card>;

  return (
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
  );
}
