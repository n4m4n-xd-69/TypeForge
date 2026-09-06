/**
 * What we already know about the person signed in.
 *
 * TypeForge asks for a name in three different places — first-run onboarding,
 * the profile screen, and the Battlefield invite gate — and until now none of
 * them looked at the identity provider first. Someone who signed in with
 * Google, having just handed over their name and photo, was asked for their
 * name on the very next screen. The information was there the whole time; it
 * was sitting in `user_metadata` and nothing read it.
 *
 * This module is the one place that reads it. Every surface that needs a name
 * resolves it through `identityFromUser` so they cannot disagree about whether
 * one is already known, and so "do we need to ask?" is a question with a single
 * answer.
 *
 * Nothing here touches the network or React — it is a pure read of a user
 * object, which is what makes it testable without a session.
 */

/** Google, GitHub and friends all populate these, in roughly this order. */
const NAME_KEYS = ['full_name', 'name', 'display_name', 'preferred_username', 'user_name'];
const AVATAR_KEYS = ['avatar_url', 'picture'];

function firstString(source, keys) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Builds a display name from separate given/family fields.
 *
 * Some providers send no combined name at all — only the parts — and dropping
 * back to "Player" because `full_name` happened to be absent is exactly the
 * kind of gap that makes an app ask a question it already has the answer to.
 */
function composeName(meta) {
  if (!meta) return null;
  const given = typeof meta.given_name === 'string' ? meta.given_name.trim() : '';
  const family = typeof meta.family_name === 'string' ? meta.family_name.trim() : '';
  const joined = `${given} ${family}`.trim();
  return joined || null;
}

/** The local part of an email, tidied — a last resort, never a first choice. */
function nameFromEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const local = email.slice(0, email.indexOf('@')).replace(/[._-]+/g, ' ').trim();
  if (!local) return null;
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Reads a Supabase user into the shape the app's profile actually uses.
 *
 * Returns nulls rather than defaults. A caller that wants "Player" can say so;
 * this function's job is to report what is known, and inventing a placeholder
 * here would make "we have a name" indistinguishable from "we gave up".
 */
export function identityFromUser(user) {
  if (!user) {
    return { name: null, avatarUrl: null, email: null, provider: null, isGuest: false };
  }

  const meta = user.user_metadata ?? {};
  const provider = user.app_metadata?.provider ?? (user.is_anonymous ? 'anonymous' : null);

  return {
    name: firstString(meta, NAME_KEYS) ?? composeName(meta) ?? nameFromEmail(user.email),
    avatarUrl: firstString(meta, AVATAR_KEYS),
    email: typeof user.email === 'string' && user.email ? user.email : null,
    provider,
    isGuest: user.is_anonymous === true || (!user.email && !user.phone),
  };
}

/**
 * The name to show, given everything we hold.
 *
 * Local profile first: it is the only one the person chose deliberately, and a
 * later Google sign-in must not overwrite a name they set by hand. That is the
 * "preserve their existing profile data unless they explicitly edit it" rule,
 * enforced by ordering rather than by a special case.
 */
export function resolveDisplayName(profile, user) {
  const local = typeof profile?.name === 'string' ? profile.name.trim() : '';
  if (local) return local;
  return identityFromUser(user).name ?? '';
}

/**
 * Whether we still have to ask this person who they are.
 *
 * This replaces reading `profile.onboarded` on its own. That flag records that
 * *this browser* has shown the wizard, which is a genuinely different question
 * from whether a name is known — and conflating the two is what made a Google
 * user on a second device sit through a form asking for information Google had
 * already supplied.
 */
export function needsIdentity(profile, user) {
  return !resolveDisplayName(profile, user);
}
