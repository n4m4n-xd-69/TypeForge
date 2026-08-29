import { createClient } from '@supabase/supabase-js';
import { SUPABASE, SUPABASE_ENABLED } from './config.js';

/**
 * Supabase client, or null.
 *
 * Null is the normal case until keys are configured, and every consumer must
 * handle it. That is what keeps PRD 04's G3 honest: signed-out, offline, and
 * unconfigured all behave identically to the app as it exists today, because
 * nothing here is on the critical path for anything.
 *
 * The anon key is public by design — it is inlined into the bundle. Security
 * comes from row-level security in supabase/migrations/0001_init.sql, not from
 * the key being secret.
 */
export const supabase = SUPABASE_ENABLED
  ? createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Needed for the Google OAuth redirect to complete on return.
        detectSessionInUrl: true,
      },
    })
  : null;

export const cloudEnabled = () => Boolean(supabase);

/* ── auth telemetry ──────────────────────────────────────────────────────
   Best-effort and silently swallows its own failures — a logging write must
   never be the reason a sign-in fails.

   The AI-usage counterpart that used to live here is gone. It was written by
   the browser and needed a module-scope mirror of the signed-in user id, kept
   current by a second `onAuthStateChange` subscription that ran on every page
   load. Both became dead weight when generation moved behind the forge Edge
   Functions: `ai_usage` rows are now written server-side, by the tier that can
   actually see which model answered, which is also what makes them
   trustworthy enough for the console to bill against. */

export async function logAuthEvent(userId, event, provider) {
  if (!supabase) return;
  try {
    await supabase.from('auth_events').insert({ user_id: userId ?? null, event, provider: provider ?? null });
  } catch {
    /* advisory only */
  }
}

/* ── auth ─────────────────────────────────────────────────────────────── */

/**
 * A guest account, created from nothing but a name.
 *
 * The point is that progress reaches the database without demanding an email
 * first: someone who types a name in onboarding gets a real `auth.users` row,
 * so every RLS policy keyed on `auth.uid()` works unchanged and no table needs
 * a nullable-owner special case.
 *
 * Returns null rather than throwing when anonymous sign-in is disabled in the
 * project — the app is local-first, and a guest who cannot be created should
 * simply keep working offline rather than see an error about a setting they
 * do not control.
 */
export async function signInAnonymously(displayName) {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { full_name: displayName ?? '' } },
  });
  if (error) {
    console.warn('[auth] anonymous sign-in unavailable:', error.message);
    return null;
  }
  if (data.user) logAuthEvent(data.user.id, 'signup', 'anonymous');
  return data.user;
}

/** True for a guest account — no identity has been attached to it yet. */
export function isGuest(user) {
  return Boolean(user) && (user.is_anonymous === true || (!user.email && !user.phone));
}

/**
 * Attaches a real identity to the guest account already in hand.
 *
 * `updateUser` keeps the same user id, which is the whole point: every session,
 * key stat and achievement already written under the guest id stays owned by
 * the same row, so signing up converts an account rather than starting a
 * second one and stranding the first.
 */
export async function upgradeGuestWithEmail(email, password, displayName) {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const { data, error } = await supabase.auth.updateUser({
    email,
    password,
    ...(displayName ? { data: { full_name: displayName } } : {}),
  });
  if (error) throw error;
  logAuthEvent(data.user?.id, 'signup', 'email-upgrade');
  return data.user;
}

export async function signUpWithEmail(email, password, displayName) {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName ?? '' } },
  });
  if (error) throw error;
  if (data.user) logAuthEvent(data.user.id, 'signup', 'email');
  return data.user;
}

export async function signInWithEmail(email, password) {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    logAuthEvent(null, 'failed', 'email');
    throw error;
  }
  logAuthEvent(data.user.id, 'login', 'email');
  return data.user;
}

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  // No user yet — this redirects away. The eventual SIGNED_IN is logged from
  // the onAuthChange listener in auth.jsx, the only place that can see it.
}

export async function sendPasswordReset(email) {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  if (data?.user) logAuthEvent(data.user.id, 'logout', null);
  await supabase.auth.signOut();
}

export async function getUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/** Returns an unsubscribe function, or a no-op when unconfigured. Passes the
 * raw Supabase event name through so a caller can tell a fresh sign-in
 * (`SIGNED_IN`) apart from the initial session restore (`INITIAL_SESSION`)
 * or a silent token refresh (`TOKEN_REFRESHED`). */
export function onAuthChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null, event);
  });
  return () => data.subscription.unsubscribe();
}
