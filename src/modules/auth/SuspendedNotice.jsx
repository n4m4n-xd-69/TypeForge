import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertOctagon, LogOut, Mail } from 'lucide-react';
import { cx } from '../../lib/format.js';
import Button from '../../components/ui/Button.jsx';
import GlassAlert from '../../components/ui/GlassAlert.jsx';
import { APPEAL_WINDOW_DAYS, appealDeadline, daysRemaining } from '../../lib/accountStatus.js';

/**
 * What a suspended account sees.
 *
 * Deliberately not dismissable and deliberately not a toast. This is the one
 * message in the product that must not be missed or scrolled past, and the
 * alternative — letting the app render while every write silently fails — is
 * the behaviour that generates "the site is broken" tickets instead of
 * appeals.
 *
 * Three things it always tells them, because an enforcement notice that
 * withholds any of them reads as arbitrary: that it happened, why, and what
 * they can do next. The reason is the operator's own words from the audit
 * trail, shown verbatim rather than mapped to a category.
 *
 * Signing out stays available. Locking someone out of the sign-out button
 * traps a shared device on their session.
 */

const SUPPORT_EMAIL = 'n4m4n.op69@gmail.com';

export default function SuspendedNotice({ status, onSignOut }) {
  const [now, setNow] = useState(() => Date.now());

  /* The countdown only needs to be right to the day, so it re-reads once a
     minute rather than once a second. */
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const deadline = appealDeadline(status?.status_changed_at);
  const left = daysRemaining(status?.status_changed_at, now);
  const expired = left === 0;

  const subject = encodeURIComponent('Account suspension appeal — TypeForge');
  const body = encodeURIComponent(
    `Hello,\n\nI would like to appeal the suspension of my TypeForge account.\n\n` +
      `Reason given: ${status?.status_reason || 'not stated'}\n` +
      `Suspended on: ${status?.status_changed_at ? new Date(status.status_changed_at).toLocaleString() : 'unknown'}\n\n` +
      `My side of it:\n`,
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-3">
      <GlassAlert
        role="alertdialog"
        labelledBy="suspended-title"
        describedBy="suspended-reason"
        edgeClass="via-bad"
        width="max-w-[520px]"
      >
        <div className="p-3">
          <div className="flex items-start gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[12px] bg-bad/14 text-bad ring-1 ring-inset ring-bad/25">
              <AlertOctagon size={22} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="eyebrow">Account status</p>
              <h2 id="suspended-title" className="mt-px font-display text-2xl font-bold tracking-[-0.02em]">
                Your account is suspended
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">
                You can still sign out. Typing, matches and AI features are unavailable while this stands.
              </p>
            </div>
          </div>

          {/* Inset panels rather than raised ones: nesting a second glass
              surface inside the first is the fastest way to make both read as
              mud, so these are cut *into* the card. */}
          <div className="mt-2.5 rounded-[12px] border border-line/70 bg-bg/35 p-2 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]">
            <p className="eyebrow">Reason given</p>
            <p id="suspended-reason" className="mt-0.5 text-base font-semibold text-ink">
              {status?.status_reason?.trim() || 'No reason was recorded.'}
            </p>
            {status?.status_changed_at ? (
              <p className="mt-1 font-mono text-xs text-ink-3 tnum">
                Applied {new Date(status.status_changed_at).toLocaleString()}
              </p>
            ) : null}
          </div>

          <div
            className={cx(
              'mt-1.5 rounded-[12px] border p-2 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)]',
              expired ? 'border-line/70 bg-bg/25' : 'border-warn/30 bg-warn/[0.09]',
            )}
          >
            <p className="eyebrow">Appeal window</p>
            {left == null ? (
              <p className="mt-0.5 text-sm text-ink-2">Contact support and we&apos;ll review it.</p>
            ) : expired ? (
              <p className="mt-0.5 text-sm text-ink-2">
                The {APPEAL_WINDOW_DAYS}-day window closed on {deadline.toLocaleDateString()}. You can still write in —
                late appeals are read, they just take longer.
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-ink-2">
                <strong className="font-semibold text-ink">
                  {left} {left === 1 ? 'day' : 'days'} left
                </strong>{' '}
                to appeal — until {deadline.toLocaleDateString()}. Tell us what happened and an operator will review the
                decision.
              </p>
            )}
          </div>

          <div className="mt-2.5 flex flex-col gap-1 sm:flex-row-reverse">
            <Button
              as="a"
              href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}
              variant="primary"
              className="lgx-glow w-full sm:w-auto"
            >
              <Mail size={15} aria-hidden />
              Appeal this decision
            </Button>
            <Button variant="secondary" onClick={onSignOut} className="lgx-glow-quiet w-full sm:w-auto">
              <LogOut size={15} aria-hidden />
              Sign out
            </Button>
          </div>

          <p className="mt-2 text-center text-xs text-ink-3">
            Your practice history and stats are kept. Nothing is deleted while an account is suspended.
          </p>
        </div>
      </GlassAlert>
    </div>,
    document.body,
  );
}
