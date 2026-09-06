import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquare, Send, ShieldAlert } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Primitives.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { supabase } from '../../lib/supabase.js';
import { appealRemoval, fetchRemovalNotice } from '../../lib/battle/api.js';
import { relativeTime } from '../../lib/format.js';

/**
 * What a player sees when an operator has closed the room they were in.
 *
 * The premise is that a room disappearing is, from inside, indistinguishable
 * from the product breaking — and of the two explanations available to
 * somebody staring at a dead screen, "this app is broken" is the one they will
 * reach for. So this page is not an error state. It says what happened, who did
 * it, and why, and then it gives them somewhere to put the question they are
 * about to have, rather than leaving that question with nowhere to go.
 *
 * The reply arrives here in realtime. Somebody who asks and then waits on this
 * screen sees the answer land without reloading, which is the difference
 * between a message and a form submission.
 */
export default function RoomRemoved({ roomId, pin }) {
  const { toast } = useToast();
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    if (!roomId) return Promise.resolve();
    return fetchRemovalNotice(roomId)
      .then((n) => setNotice(n ?? null))
      .catch(() => setNotice(null))
      .finally(() => setLoading(false));
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  /* An operator's reply is a row update on the appeal. Scoped to this room's
     thread; the table's own policy is what stops it carrying anyone else's. */
  useEffect(() => {
    if (!supabase || !roomId) return undefined;
    const channel = supabase
      .channel(`appeal:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'battle_room_appeals', filter: `room_id=eq.${roomId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, load]);

  const appeal = notice?.appeal ?? null;

  const send = async (event) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setSending(true);
    try {
      await appealRemoval(roomId, text);
      setMessage('');
      await load();
      toast('Sent to the moderators', { tone: 'success' });
    } catch (err) {
      toast(err.message ?? 'Could not send that.', { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-1">
        <Button as={Link} to="/battle" size="sm" variant="ghost" icon={ArrowLeft}>Battlefield</Button>
      </header>

      <Card className="mx-auto max-w-[560px] p-3">
        <div className="flex items-start gap-1.5">
          <span className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[13px] bg-warn/15 text-warn">
            <ShieldAlert size={20} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Room removed by administrator</h1>
            <p className="mt-0.5 text-sm text-ink-3">
              Battlefield <span className="font-mono font-bold tracking-[0.12em] text-ink">{pin?.toUpperCase()}</span>
              {notice?.removed_at ? <> · {relativeTime(notice.removed_at)}</> : null}
            </p>
          </div>
        </div>

        {loading ? (
          <p className="mt-2 flex items-center gap-1 text-sm text-ink-3">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Loading the reason…
          </p>
        ) : (
          <>
            <div className="mt-2 rounded-md border border-line bg-subtle/50 p-2">
              <p className="eyebrow">Reason</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink">
                {/* An operator cannot remove a room without giving a reason —
                    the RPC rejects a blank one — so this only falls back when
                    the notice itself could not be read. */}
                {notice?.reason || 'No reason was recorded for this removal.'}
              </p>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Your results from this match, if it had started, were kept.
            </p>

            {/* ── the thread ─────────────────────────────────────────── */}
            <section className="mt-2.5 border-t border-line pt-2.5">
              <h2 className="flex items-center gap-1 text-sm font-bold">
                <MessageSquare size={14} className="text-ink-3" aria-hidden />
                Have a question about this?
              </h2>

              {appeal ? (
                <div className="mt-1.5 space-y-1.5">
                  <div className="rounded-md border border-line bg-surface p-2">
                    <p className="eyebrow">You asked · {relativeTime(appeal.created_at)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{appeal.message}</p>
                  </div>

                  {appeal.admin_reply ? (
                    <div className="rounded-md border border-brand/40 bg-brand-wash/50 p-2">
                      <p className="eyebrow text-brand">Moderator replied · {relativeTime(appeal.replied_at)}</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{appeal.admin_reply}</p>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1 text-xs text-ink-3">
                      <Loader2 size={12} className="animate-spin" aria-hidden />
                      Waiting for a reply. It will appear here — you can close this page.
                    </p>
                  )}
                </div>
              ) : (
                <form className="mt-1.5" onSubmit={send}>
                  <label htmlFor="appeal-body" className="sr-only">Your message</label>
                  <textarea
                    id="appeal-body"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="Why was this room removed?"
                    className="w-full resize-y rounded-md border border-line bg-subtle/50 px-1.5 py-1 text-sm outline-none focus:border-brand"
                  />
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="text-2xs text-ink-3">{message.length}/1000</span>
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      icon={sending ? Loader2 : Send}
                      disabled={sending || !message.trim()}
                    >
                      {sending ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}

        <Button as={Link} to="/battle" variant="secondary" className="mt-2.5 w-full">
          Open a new Battlefield
        </Button>
      </Card>
    </div>
  );
}
