import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { cloudEnabled, getUser, logAuthEvent, onAuthChange, signOut as supabaseSignOut } from './supabase.js';
import { fetchAccountStatus } from './accountStatus.js';

/**
 * Session state only — no UI. The modal that reads `modalOpen`/`authView`
 * lives in src/modules/auth/AuthModal.jsx, rendered once from AppShell, the
 * same split Toast uses (ToastProvider owns state, the portal renders it).
 *
 * When Supabase isn't configured, `ready` starts true and stays true: there
 * is no session to wait for, so nothing should ever show a loading state on
 * its account.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const enabled = cloudEnabled();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!enabled);
  const [modal, setModal] = useState({ open: false, view: 'sign-in' });
  /* An account's own standing. Null until known, and null forever when cloud
     sync is off — a locally-run app has nobody to suspend it. */
  const [accountStatus, setAccountStatus] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getUser().then((u) => {
      if (cancelled) return;
      setUser(u);
      setReady(true);
    });
    // The email path logs its own login/signup/failed events right where it
    // has that context (supabase.js). This only needs to catch the one path
    // that can't log itself: an OAuth redirect resolves here, not at the
    // `signInWithGoogle()` call that kicked it off.
    const unsubscribe = onAuthChange((u, event) => {
      setUser(u);
      if (event === 'SIGNED_IN' && u?.app_metadata?.provider === 'google') {
        logAuthEvent(u.id, 'login', 'google');
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  /* Re-read on every identity change rather than once at mount: a suspension
     applied while someone is signed in should reach them on their next
     navigation, not only after they clear storage. */
  useEffect(() => {
    if (!enabled || !user) {
      setAccountStatus(null);
      return undefined;
    }
    let cancelled = false;
    fetchAccountStatus(user.id).then((s) => {
      if (!cancelled) setAccountStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  const value = useMemo(
    () => ({
      user,
      ready,
      accountStatus,
      suspended: accountStatus?.status === 'suspended',
      cloudEnabled: enabled,
      modalOpen: modal.open,
      authView: modal.view,
      openAuthModal: (view = 'sign-in') => setModal({ open: true, view }),
      closeAuthModal: () => setModal((m) => ({ ...m, open: false })),
      signOut: () => supabaseSignOut(),
    }),
    [user, ready, enabled, modal, accountStatus],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
