import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Megaphone, ShieldAlert, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import GlassAlert from '../../components/ui/GlassAlert.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { dismissNotice, fetchMyNotices, markNoticeSeen } from '../../lib/notices.js';

/**
 * Operator notices, as a glass dialog.
 *
 * Queued rather than stacked: several live notices show one at a time, most
 * severe first, because two overlapping modals is a worse experience than a
 * short sequence and the ordering already comes from the query.
 *
 * A `once` notice is only spent when the person actually closes it — seeing it
 * and reloading is not consent to never see it again. `every_time` notices are
 * always dismissible; the database refuses the combination that would trap
 * someone in a dialog they cannot clear.
 */

const TONES = {
  info: { icon: Info, ring: 'text-info', wash: 'bg-info/14 ring-info/25', edge: 'via-info' },
  success: { icon: CheckCircle2, ring: 'text-good', wash: 'bg-good/14 ring-good/25', edge: 'via-good' },
  warn: { icon: AlertTriangle, ring: 'text-warn', wash: 'bg-warn/14 ring-warn/25', edge: 'via-warn' },
  critical: { icon: ShieldAlert, ring: 'text-bad', wash: 'bg-bad/14 ring-bad/25', edge: 'via-bad' },
};

export default function NoticeDialog() {
  const { user, cloudEnabled, suspended } = useAuth();
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set());

  useEffect(() => {
    if (!cloudEnabled || !user) {
      setQueue([]);
      return undefined;
    }
    let cancelled = false;
    fetchMyNotices().then((rows) => {
      if (!cancelled) setQueue(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [cloudEnabled, user]);

  const current = queue[0] ?? null;

  /* Recorded once per notice per mount, in an effect rather than during
     render — a stats write is a side effect and belongs after commit. */
  useEffect(() => {
    if (!current || seen.current.has(current.id)) return;
    seen.current.add(current.id);
    markNoticeSeen(current.id);
  }, [current]);

  const close = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    // `every_time` notices are not dismissed server-side: doing so would make
    // them show once, which is the other setting.
    if (current.frequency === 'once') await dismissNotice(current.id);
    setQueue((q) => q.slice(1));
    setBusy(false);
  }, [current, busy]);

  useEffect(() => {
    if (!current) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && current.dismissible) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey, true);
    };
  }, [current, close]);

  // The suspension notice is the more urgent message and owns the screen.
  if (suspended || !current) return null;

  const tone = TONES[current.tone] ?? TONES.info;
  const Icon = tone.icon;

  return createPortal(
    <NoticeCard
      notice={current}
      tone={tone}
      Icon={Icon}
      busy={busy}
      remaining={queue.length - 1}
      onClose={close}
    />,
    document.body,
  );
}

function NoticeCard({ notice, tone, Icon, busy, remaining, onClose }) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[65] flex items-center justify-center p-2 sm:p-3">
        <GlassAlert
          labelledBy="notice-title"
          edgeClass={tone.edge}
          width="max-w-[480px]"
          onBackdropClick={notice.dismissible ? onClose : undefined}
        >
          {notice.dismissible ? (
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-1.5 top-1.5 z-[4] grid h-[28px] w-[28px] place-items-center rounded-[9px] text-ink-3 transition-colors hover:bg-ink/10 hover:text-ink"
            >
              <X size={15} aria-hidden />
            </button>
          ) : null}

          <div className="p-3">
            <div className="flex items-start gap-2">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-[11px] ring-1 ring-inset ${tone.wash} ${tone.ring}`}
              >
                <Icon size={20} strokeWidth={2} aria-hidden />
              </span>
              <div className="min-w-0 pr-3">
                <p className="eyebrow flex items-center gap-0.5">
                  <Megaphone size={11} aria-hidden />
                  {notice.targeted ? 'A message for you' : 'Announcement'}
                </p>
                <h2 id="notice-title" className="mt-px font-display text-xl font-bold tracking-[-0.02em]">
                  {notice.title}
                </h2>
              </div>
            </div>

            {/* Operator-authored text, rendered as text. It is not markup and
                must never be treated as any. */}
            <div className="mt-2 rounded-[12px] border border-line/70 bg-bg/30 p-2 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink-2">{notice.body}</p>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-1">
              <span className="text-2xs text-ink-3">
                {remaining > 0
                  ? `${remaining} more to read`
                  : notice.frequency === 'every_time'
                    ? 'Shown each visit'
                    : null}
              </span>
              {notice.dismissible ? (
                <Button variant="primary" onClick={onClose} disabled={busy} className="lgx-glow">
                  {busy ? 'Saving…' : notice.frequency === 'once' ? 'Got it' : 'Close'}
                </Button>
              ) : (
                <span className="text-2xs text-ink-3">This notice cannot be dismissed.</span>
              )}
            </div>
          </div>
        </GlassAlert>
      </div>
    </AnimatePresence>
  );
}
