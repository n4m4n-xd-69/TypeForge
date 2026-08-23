import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, LogOut, Pencil, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { useStore } from '../../lib/store.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { supabase } from '../../lib/supabase.js';
import { isGuest } from '../../lib/supabase.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { cx } from '../../lib/format.js';
import { fetchMyRole } from '../admin/adminApi.js';

/**
 * Header identity control. Absent entirely when Supabase isn't configured —
 * PRD 04 G3 means a keyless deploy has no cloud UI at all, not a disabled one.
 *
 * The rail's bottom avatar already means something else here (level/XP), so
 * this lives in the top bar instead of overloading it, per PRD 04 §Step 5's
 * "signed-out: show Sign in, signed-in: name/email/sign out."
 *
 * `/admin` is reached from this menu rather than from NAV_GROUPS because that
 * array also drives the mobile tab bar, which is already at seven tabs — and
 * an operator entry that only one account can use has no business taking a
 * permanent slot in primary navigation anyway.
 */
export default function AccountMenu({ level }) {
  const { user, cloudEnabled, openAuthModal, signOut } = useAuth();
  const { state } = useStore();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [role, setRole] = useState('user');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Hiding the entry for non-admins is presentation only — `/admin` stays
  // routable and every query behind it is gated by `is_admin()` in the
  // database (0002_admin.sql), so this deciding wrongly costs nothing.
  // It defaults to 'user', which means a failed or in-flight lookup hides
  // the link rather than flashing one that leads to "No access".
  useEffect(() => {
    if (!user) {
      setRole('user');
      return undefined;
    }
    let cancelled = false;
    fetchMyRole(user.id).then((r) => {
      if (!cancelled) setRole(r);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  /* Renders even with no cloud configured. It used to return null, which meant
     a local-only build had no way to change the name you typed at onboarding
     and no account surface at all — the name was effectively write-once. */
  if (!cloudEnabled && !user) {
    return (
      <>
        <button
          onClick={() => setRenaming(true)}
          title="Your name and avatar"
          className="hidden h-[36px] shrink-0 items-center gap-0.5 rounded-full border border-line px-1.5 text-xs font-bold text-ink-2 transition-colors hover:bg-subtle hover:text-ink sm:flex"
        >
          <Avatar value={state.profile.avatar} name={state.profile.name} size={26} />
          {state.profile.name || 'Set your name'}
          {level != null ? <span className="text-ink-3">· Lv {level}</span> : null}
        </button>
        <RenameModal open={renaming} onClose={() => setRenaming(false)} />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <button
          onClick={() => setRenaming(true)}
          title="Change your name"
          aria-label="Change your name"
          className="hidden h-[36px] shrink-0 items-center gap-0.5 rounded-full border border-line px-1.5 text-xs font-bold text-ink-2 transition-colors hover:bg-subtle hover:text-ink sm:flex"
        >
          <Avatar value={state.profile.avatar} name={state.profile.name} size={26} />
          {state.profile.name || 'Name'}
          {level != null ? <span className="text-ink-3">· Lv {level}</span> : null}
        </button>
        <button
          onClick={() => openAuthModal('sign-in')}
          className="hidden h-[36px] shrink-0 items-center gap-0.5 rounded-full border border-line px-1.5 text-xs font-bold text-ink-2 transition-colors hover:bg-subtle hover:text-ink sm:flex"
        >
          <LogIn size={14} strokeWidth={2.2} aria-hidden /> Sign in
        </button>
        <RenameModal open={renaming} onClose={() => setRenaming(false)} />
      </>
    );
  }

  const displayName = user.user_metadata?.full_name?.trim() || state.profile.name;
  const guest = isGuest(user);
  const label = displayName || user.email || (guest ? 'Guest' : 'Account');

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className={cx(
          'flex items-center gap-1 rounded-full border py-px pl-px transition-colors active:scale-95',
          level == null ? 'pr-px' : 'pr-1.5',
          open ? 'border-brand bg-brand-wash' : 'border-line hover:border-line-strong hover:bg-subtle',
        )}
      >
        <Avatar value={state.profile.avatar} name={label} size={30} />
        {level != null ? <span className="hidden text-xs font-bold sm:block">Lv {level}</span> : null}
      </button>
      {open ? (
        <div
          role="menu"
          className={cx(
            'glass absolute right-0 top-[calc(100%+8px)] z-50 w-[220px] overflow-hidden rounded-md',
            'border border-line shadow-lg',
          )}
        >
          <div className="border-b border-line px-2 py-1.5">
            <p className="truncate text-sm font-bold">{displayName || (guest ? 'Guest' : 'Signed in')}</p>
            <p className="truncate text-xs text-ink-3">
              {guest ? 'Progress is syncing to a guest account' : user.email}
            </p>
          </div>

          {/* A guest account is real and already owns this progress, but it
              lives and dies with this browser: clear site data, or open the app
              anywhere else, and there is no way back to it. Saying so is the
              honest version of "sign up", and the upgrade keeps the same id. */}
          {guest ? (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openAuthModal('sign-up');
              }}
              className="flex w-full items-start gap-1 border-b border-line px-2 py-1.5 text-left transition-colors hover:bg-subtle"
            >
              <ShieldCheck size={14} strokeWidth={2.2} className="mt-px shrink-0 text-brand" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">Save this progress</span>
                <span className="block text-2xs leading-relaxed text-ink-3">
                  Add an email so it survives this browser.
                </span>
              </span>
            </button>
          ) : null}
          <Link
            role="menuitem"
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-1 border-b border-line px-2 py-1.5 text-left text-sm font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
          >
            <User size={14} strokeWidth={2.2} aria-hidden /> My profile
          </Link>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setRenaming(true);
            }}
            className="flex w-full items-center gap-1 border-b border-line px-2 py-1.5 text-left text-sm font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
          >
            <Pencil size={14} strokeWidth={2.2} aria-hidden /> Change name
          </button>

          {role === 'admin' ? (
            <Link
              role="menuitem"
              to="/admin"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-1 border-b border-line px-2 py-1.5 text-left text-sm font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
            >
              <ShieldCheck size={14} strokeWidth={2.2} aria-hidden /> Admin
            </Link>
          ) : null}
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              // A guest account exists only in this browser's session. Signing
              // out of one is not reversible — there is no email to sign back
              // in with — so it needs saying before, not after.
              if (guest && !window.confirm(
                'This is a guest account. Signing out leaves no way back to it, '
                  + 'and the progress synced under it cannot be recovered.\n\n'
                  + 'Add an email first to keep it. Sign out anyway?',
              )) return;
              await signOut();
              toast(guest ? 'Guest session ended.' : 'Signed out.', { tone: 'info' });
            }}
            className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-sm font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
          >
            <LogOut size={14} strokeWidth={2.2} aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
      <RenameModal open={renaming} onClose={() => setRenaming(false)} />
    </div>
  );
}

/**
 * Editing the name after onboarding.
 *
 * There was no way to do this at all: `updateProfile` was called from exactly
 * one place — the onboarding wizard — so whatever you typed on your first visit
 * was permanent. It writes to three places because three of them are read:
 * local state (what the app shows), `profiles.display_name` (what sync and the
 * admin panel read) and `user_metadata.full_name` (what the header shows before
 * the first sync completes). Updating one and not the others is how a rename
 * appears to work and then reverts.
 */
function RenameModal({ open, onClose }) {
  const { state, updateProfile } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const [value, setValue] = useState(state.profile.name ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValue(state.profile.name ?? '');
  }, [open, state.profile.name]);

  const save = async (e) => {
    e.preventDefault();
    const name = value.trim();
    if (busy) return;
    setBusy(true);
    try {
      updateProfile({ name });
      if (user && supabase) {
        // Metadata first: it is what the header reads immediately. The profiles
        // row is also written by the next sync push, but doing it here means the
        // change is durable even if the user closes the tab straight away.
        await supabase.auth.updateUser({ data: { full_name: name } });
        await supabase.from('profiles').upsert(
          { id: user.id, display_name: name || null, updated_at: new Date().toISOString() },
          { onConflict: 'id' },
        );
      }
      toast(name ? `You are ${name} now.` : 'Name cleared.', { tone: 'success' });
      onClose();
    } catch (err) {
      toast(err?.message || 'Could not save that name.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Your name" size="sm">
      <form onSubmit={save} className="px-3 py-2.5">
        <label htmlFor="profile-name" className="text-sm font-bold">
          What should we call you?
        </label>
        <input
          id="profile-name"
          data-autofocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          autoComplete="name"
          className="mt-1 h-[44px] w-full rounded-md border border-line bg-subtle/50 px-1.5 text-base outline-none focus:border-brand"
        />
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          Shown in the header and on the leaderboard. Leave it blank to stay anonymous.
        </p>
        <div className="mt-3 flex justify-end gap-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
