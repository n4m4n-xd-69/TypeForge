import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import {
  isGuest, sendPasswordReset, signInWithEmail, signInWithGoogle, signUpWithEmail,
  upgradeGuestWithEmail,
} from '../../lib/supabase.js';

const TITLES = { 'sign-in': 'Sign in', 'sign-up': 'Create your account', reset: 'Reset your password' };
const SUBMIT_LABEL = { 'sign-in': 'Sign in', 'sign-up': 'Create account', reset: 'Send reset link' };

const inputClass =
  'mt-1 h-[44px] w-full rounded-md border border-line bg-subtle/50 px-1.5 text-base outline-none focus:border-brand';

/** Email/password + Google, per PRD 04 §Step 5. A modal, not a route, so
 * signing in never loses whatever page the user was on. */
export default function AuthModal() {
  const { modalOpen, authView, closeAuthModal, user } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState(authView ?? 'sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-open on whatever tab the caller asked for (e.g. a "Sign up" link
  // elsewhere in the app), and never carry a typed password across opens.
  useEffect(() => {
    if (modalOpen) {
      setView(authView ?? 'sign-in');
      setPassword('');
    }
  }, [modalOpen, authView]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (view === 'sign-in') {
        await signInWithEmail(email.trim(), password);
        toast('Signed in.', { tone: 'success' });
        closeAuthModal();
      } else if (view === 'sign-up') {
        // Upgrade in place when a guest account is already holding this
        // progress. `signUpWithEmail` would mint a *second* user id and strand
        // everything written under the first — every session, key stat and
        // achievement is owned by the guest id.
        if (isGuest(user)) {
          await upgradeGuestWithEmail(email.trim(), password, name.trim());
          toast('Progress saved to your account.', { tone: 'success' });
        } else {
          await signUpWithEmail(email.trim(), password, name.trim());
          toast('Account created.', { tone: 'success' });
        }
        closeAuthModal();
      } else {
        await sendPasswordReset(email.trim());
        toast('Check your email for a reset link.', { tone: 'success' });
        setView('sign-in');
      }
    } catch (err) {
      toast(err?.message || 'Something went wrong.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    try {
      await signInWithGoogle();
    } catch (err) {
      toast(err?.message || 'Google sign-in failed.', { tone: 'error' });
    }
  }

  return (
    <Modal open={modalOpen} onClose={closeAuthModal} title={TITLES[view]} size="sm">
      <form onSubmit={handleSubmit} className="px-3 py-2.5">
        {view === 'sign-up' ? (
          <div>
            <label htmlFor="auth-name" className="text-sm font-bold">
              Name
            </label>
            <input
              id="auth-name"
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className={inputClass}
            />
          </div>
        ) : null}

        <div className={view === 'sign-up' ? 'mt-2' : ''}>
          <label htmlFor="auth-email" className="text-sm font-bold">
            Email
          </label>
          <input
            id="auth-email"
            data-autofocus={view !== 'sign-up' ? true : undefined}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={inputClass}
          />
        </div>

        {view !== 'reset' ? (
          <div className="mt-2">
            <label htmlFor="auth-password" className="text-sm font-bold">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={view === 'sign-up' ? 'At least 6 characters' : '••••••••'}
              autoComplete={view === 'sign-up' ? 'new-password' : 'current-password'}
              className={inputClass}
            />
          </div>
        ) : null}

        {view === 'sign-in' ? (
          <button type="button" onClick={() => setView('reset')} className="mt-1 text-xs font-bold text-brand hover:underline">
            Forgot password?
          </button>
        ) : null}

        <Button type="submit" variant="primary" className="mt-3 w-full" disabled={busy}>
          {busy ? 'Please wait…' : SUBMIT_LABEL[view]}
        </Button>

        {view !== 'reset' ? (
          <>
            <div className="my-2 flex items-center gap-1 text-2xs font-bold uppercase tracking-[0.08em] text-ink-3">
              <span className="h-px flex-1 bg-line" aria-hidden />
              or
              <span className="h-px flex-1 bg-line" aria-hidden />
            </div>
            <Button type="button" variant="secondary" className="w-full" onClick={handleGoogle}>
              <GoogleG /> Continue with Google
            </Button>
          </>
        ) : null}

        <p className="mt-2.5 text-center text-xs text-ink-3">
          {view === 'sign-in' ? (
            <>
              New here?{' '}
              <button type="button" onClick={() => setView('sign-up')} className="font-bold text-brand hover:underline">
                Create an account
              </button>
            </>
          ) : view === 'sign-up' ? (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => setView('sign-in')} className="font-bold text-brand hover:underline">
                Sign in
              </button>
            </>
          ) : (
            <>
              Remembered it?{' '}
              <button type="button" onClick={() => setView('sign-in')} className="font-bold text-brand hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </Modal>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.5 34.8 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.6 39.6 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C39.9 37.5 44 31.8 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}
