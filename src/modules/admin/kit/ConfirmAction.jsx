import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal.jsx';
import Button from '../../../components/ui/Button.jsx';
import { cx } from '../../../lib/format.js';

/**
 * The gate in front of every mutation in the console.
 *
 * Three things it insists on, each because the database insists on the same
 * thing and a dialog that can be satisfied where the RPC cannot is a dialog
 * that only produces errors:
 *
 * 1. **A reason, when the action is destructive.** `admin_set_user_status`,
 *    `admin_adjust_xp` and `admin_moderate_generation` all raise without one.
 *    Capturing it here means the audit row says *why*, not just *what*.
 *
 * 2. **Typed confirmation for the irreversible ones.** Deleting a generation
 *    or an account is not undoable, so it costs an operator the record's own
 *    name to do it. Reserved for exactly those — a confirmation everywhere
 *    trains people to type through it.
 *
 * 3. **The error stays in the dialog.** A failed mutation leaves the form
 *    filled in and the message beside the button that caused it, rather than
 *    closing and firing a toast the operator has to reconstruct.
 */
export default function ConfirmAction({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'default',
  /** Requires a non-empty reason before the confirm button enables. */
  requireReason = false,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Recorded in the audit log',
  /** Requires this exact string to be typed. Use for irreversible actions only. */
  confirmPhrase = null,
  children,
}) {
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setPhrase('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const reasonOk = !requireReason || reason.trim().length > 0;
  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase;
  const ready = reasonOk && phraseOk && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose?.();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      description={description}
      size="sm"
      dismissable={!busy}
      footer={
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit} disabled={!ready}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 p-2.5">
        {tone === 'danger' ? (
          <p className="flex items-start gap-1 rounded-sm border border-bad/30 bg-bad/[0.06] p-1.5 text-sm text-ink-2">
            <AlertTriangle size={15} className="mt-px shrink-0 text-bad" aria-hidden />
            This cannot be undone.
          </p>
        ) : null}

        {children}

        {requireReason ? (
          <label className="block">
            <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">{reasonLabel}</span>
            <textarea
              data-autofocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              className="mt-0.5 w-full resize-y rounded-sm border border-line bg-raised/50 px-1.5 py-1 text-sm outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong focus:bg-raised"
            />
          </label>
        ) : null}

        {confirmPhrase ? (
          <label className="block">
            <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
              Type <span className="font-mono text-ink">{confirmPhrase}</span> to confirm
            </span>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={cx(
                'mt-0.5 h-[34px] w-full rounded-sm border bg-raised/50 px-1.5 font-mono text-sm outline-none transition-colors focus:bg-raised',
                phrase && !phraseOk ? 'border-bad/50' : 'border-line focus:border-line-strong',
              )}
            />
          </label>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-sm border border-bad/30 bg-bad/[0.06] p-1.5 text-sm text-bad">
            {error.message || 'The action failed.'}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
