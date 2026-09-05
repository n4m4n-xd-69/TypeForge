import { supabase } from '../supabase.js';

/**
 * Chat's data layer. Same shape as `lib/community/api.js` and
 * `lib/battle/api.js`: reads return empty on failure, writes throw, and every
 * RPC error carries a code this file already has copy for.
 */

export const CHAT_ERROR_COPY = {
  CH000: 'Sign in to chat.',
  CH001: 'Slow down a moment — twenty messages a minute is the limit.',
  CH002: 'Slow down on /ai — five questions per ten minutes is the limit.',
  CH003: 'You are muted here right now.',
  CH004: 'A message needs text or an image.',
  CH005: 'You can only delete your own messages.',
  CH006: 'That image could not be used. Check the type and size.',
  CH007: 'That channel does not exist.',
};

/** Maps an RPC error to the sentence a person can act on. Mirrors `battleErrorMessage`. */
export function chatErrorMessage(err) {
  if (!err) return null;
  if (CHAT_ERROR_COPY[err.code]) return CHAT_ERROR_COPY[err.code];
  return err.message ?? 'Something went wrong.';
}

function decorate(error) {
  const message = chatErrorMessage(error);
  const err = new Error(message);
  err.code = error?.code;
  return err;
}

const PAGE = 50;

export async function fetchChannels() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    if (import.meta.env.DEV) console.warn('[chat] channel read failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * One page of a channel's history. Keyset-paginated on `created_at`, same
 * reasoning `fetchFeed` documents: the head of a live table grows, so an
 * offset would shift under a reader mid-page.
 *
 * Rows come back oldest-first — the shape a message list actually renders in,
 * top to bottom — even though the underlying query orders newest-first to
 * make `before` cursoring natural.
 */
export async function fetchMessages(channelId, { before = null, limit = PAGE } = {}) {
  if (!supabase || !channelId) return [];
  let q = supabase
    .from('chat_channel_messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) {
    if (import.meta.env.DEV) console.warn('[chat] message read failed', error);
    return [];
  }
  return (data ?? []).reverse();
}

export async function sendMessage(channelId, body, imageUrl = null) {
  if (!supabase) throw new Error('Cloud sync is not configured, so chat is unavailable.');
  const { data, error } = await supabase.rpc('chat_send_message', {
    p_channel: channelId,
    p_body: body || null,
    p_image_url: imageUrl,
  });
  if (error) throw decorate(error);
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function deleteMessage(id) {
  if (!supabase) return;
  const { error } = await supabase.rpc('chat_delete_message', { p_id: id });
  if (error) throw decorate(error);
}

/**
 * Live inserts for one channel. Returns an unsubscribe function
 * unconditionally, including when Supabase is unconfigured.
 */
export function subscribeToChannel(channelId, onInsert) {
  if (!supabase || !channelId) return () => {};
  const channel = supabase
    .channel(`chat:${channelId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_channel_messages', filter: `channel_id=eq.${channelId}` },
      (payload) => onInsert(payload.new))
    .subscribe();
  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* already torn down */
    }
  };
}
