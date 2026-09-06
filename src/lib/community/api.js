import { supabase } from '../supabase.js';

/**
 * Community's data layer.
 *
 * The rule that shapes this file is §24: a community member sees a *narrower*
 * object than an account holder. That narrowing is done in Postgres — the
 * `community_feed` and `community_profiles` views select exactly the public
 * columns — and this module never reads `profiles` directly. So a column added
 * to `profiles` tomorrow is private by default rather than leaking the moment
 * somebody writes `select *`.
 *
 * Reads return empty rather than throwing, the way the admin console's reads
 * do: an unreachable feed should render an empty state, not a stack trace.
 * Writes throw, because a post that silently failed to send is worse than an
 * error message.
 */

export const COMMUNITY_ERROR_COPY = {
  CM001: 'Slow down a moment — five posts a minute is the limit.',
  BF001: 'That Battlefield code is not open any more.',
  BF000: 'Sign in to post.',
};

function decorate(error) {
  const message = COMMUNITY_ERROR_COPY[error?.code] ?? error?.message ?? 'Something went wrong.';
  const err = new Error(message);
  err.code = error?.code;
  return err;
}

const PAGE = 30;

/**
 * The feed, newest first, paged by timestamp rather than by offset.
 *
 * Keyset pagination because the feed grows at the head: with `range(n, n+30)`
 * a post arriving between two page fetches shifts every later row down one and
 * the reader sees a duplicate. Cursoring on `created_at` cannot do that.
 */
export async function fetchFeed({ before = null, limit = PAGE } = {}) {
  if (!supabase) return [];
  let q = supabase
    .from('community_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) {
    if (import.meta.env.DEV) console.warn('[community] feed read failed', error);
    return [];
  }
  return data ?? [];
}

/** Posts, optionally carrying a Battlefield code the server validates is live. */
export async function createPost(body, battlePin = null) {
  if (!supabase) throw new Error('Cloud sync is not configured, so Community is unavailable.');
  const { data, error } = await supabase.rpc('community_post', {
    p_body: body,
    p_pin: battlePin || null,
  });
  if (error) throw decorate(error);
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function deletePost(id) {
  if (!supabase) return;
  const { error } = await supabase.rpc('community_delete_post', { p_id: id });
  if (error) throw decorate(error);
}

/** One member's public card. Never the account row. */
export async function fetchMember(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('community_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data;
}

/**
 * The community-facing half of one's own profile.
 *
 * A plain table update rather than an RPC: these are the caller's own columns
 * on their own row, and `profiles`' existing own-row policy is already the
 * right gate. Adding a definer function would move the authorisation somewhere
 * less obvious without changing what it permits.
 */
export async function saveCommunityProfile(userId, fields) {
  if (!supabase || !userId) throw new Error('Sign in first.');
  const { error } = await supabase
    .from('profiles')
    .update({
      course: fields.course?.trim() || null,
      branch: fields.branch?.trim() || null,
      study_year: fields.studyYear ? Number(fields.studyYear) : null,
      bio: fields.bio?.trim() || null,
      photo_url: fields.photoUrl ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw decorate(error);
}

/**
 * Pulls a Battlefield code out of what someone typed.
 *
 * Sharing a room is the feature people will actually use this for, and asking
 * them to paste a link into a separate field is a step they will skip. Matching
 * both the full invite URL and a bare six-character code means the natural
 * thing to type is the thing that works.
 *
 * The extracted code is stored in its own column and validated server-side
 * against a room that is genuinely open — the client never turns arbitrary
 * user text into a link.
 */
export function extractBattlePin(text) {
  if (typeof text !== 'string') return null;
  const fromUrl = text.match(/\/battle\/([A-Za-z0-9]{6})\b/);
  if (fromUrl) return fromUrl[1].toUpperCase();
  // A bare code, on its own word boundary, with at least one digit — enough to
  // avoid catching an ordinary six-letter word like "typing" or "battle".
  const bare = text.match(/\b([A-Z0-9]{6})\b/);
  if (bare && /\d/.test(bare[1])) return bare[1].toUpperCase();
  return null;
}

/**
 * Live feed updates.
 *
 * Returns an unsubscribe function unconditionally, including when Supabase is
 * unconfigured, so callers never have to guard their cleanup.
 */
export function subscribeToFeed(onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('community:feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'community_posts' }, onChange)
    .subscribe();
  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* already torn down */
    }
  };
}
