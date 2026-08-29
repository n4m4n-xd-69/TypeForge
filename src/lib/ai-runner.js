import { AI_ENABLED } from './config.js';
import { ForgeError, forgeConfigured, streamChat as forgeStream } from './forge/client.js';

/**
 * The client's view of Forge AI.
 *
 * This file used to be the transport: a provider table, a hedged failover
 * runner, an SSE parser, and — inlined into the bundle — two API keys. All of
 * that now lives in `supabase/functions/_shared/`, where a key can exist
 * without being readable by anyone who opens devtools.
 *
 * What is left is an adapter. It keeps the exact surface the rest of the app
 * already imports (`complete`, `chat`, `aiConfigured`, `providerSummary`,
 * `AIUnavailable`, `AI_REASON_COPY`) so `ai.js`, `useStreamingChat.js` and the
 * admin panel needed no changes at all — the transport was swapped underneath
 * them.
 *
 * One thing deliberately does *not* survive the move: the client can no longer
 * learn which provider or model answered. The Forge wire protocol has no field
 * for it. That is the layer of the identity clamp that actually holds, and
 * giving this module a way to report it back would quietly undo it.
 */

export { ForgeError };

/**
 * Kept as an alias rather than renamed.
 *
 * Every catch site in the app tests `err.reason` and several test files import
 * this name. `ForgeError` carries the same `reason` vocabulary, so the alias is
 * accurate rather than merely compatible.
 */
export const AIUnavailable = ForgeError;

/** Unchanged: the copy is what users see, and the reasons still mean the same. */
export const AI_REASON_COPY = {
  'rate-limit': {
    label: 'Limit reached',
    detail: 'Forge is rate limited right now. Try again in a minute.',
  },
  auth: {
    label: 'Sign-in needed',
    detail: 'Forge needs you signed in. Reload the page, or sign in again.',
  },
  network: {
    label: 'Unreachable',
    detail: 'Forge did not respond. Showing a locally computed reading instead.',
  },
  timeout: {
    label: 'Timed out',
    detail: 'Forge took too long to answer. Try again — the next attempt is usually faster.',
  },
  'no-key': {
    label: 'AI unavailable',
    detail: 'Forge is not configured on this deploy. Everything else still works offline.',
  },
  'bad-response': {
    label: 'Unreadable reply',
    detail: 'Forge answered with something this app could not parse.',
  },
  'bad-request': {
    label: 'Request rejected',
    detail: 'Forge refused the request itself. Check the console for the reason.',
  },
};

export function aiConfigured() {
  return AI_ENABLED && forgeConfigured();
}

/**
 * What the UI may say about what is answering.
 *
 * Forge names, never vendor names. The real ladder is server-side config and
 * is not fetched here — `forge-models` serves the picker catalogue when a
 * surface needs one.
 */
export function providerSummary() {
  return aiConfigured() ? [{ id: 'forge', label: 'Forge AI' }] : [];
}

/**
 * Splits the system turns out of a message list.
 *
 * `ai.js` builds prompts as `[{role:'system'},{role:'user'}]`, which is the
 * OpenAI shape. The Forge endpoint takes the system prompt as its own field so
 * it can prepend the identity block to it server-side, where a client cannot
 * strip it.
 */
function splitSystem(messages = []) {
  const system = messages
    .filter((m) => m?.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m?.role && m.role !== 'system')
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  return { system: system || undefined, rest };
}

/**
 * One completion.
 *
 * `temperature` and `thinking` are accepted and ignored: both are lane
 * properties now, chosen server-side. Callers still pass them, and silently
 * accepting them is what let this swap happen without touching six call sites.
 */
export async function complete({
  messages,
  maxTokens,
  signal,
  onThinking,
  onToken,
  onAttempt,
  surface = 'unknown',
  lane,
} = {}) {
  if (!aiConfigured()) throw new ForgeError('Forge is not configured', 'no-key');

  const { system, rest } = splitSystem(messages);

  // The old runner reported each failover attempt so the chat panel could show
  // a trace. Attempts are now invisible by design, so this fires once with a
  // Forge-shaped placeholder rather than being dropped — callers that render it
  // keep working.
  onAttempt?.({ provider: 'forge', model: 'forge', index: 0 });

  const res = await forgeStream({
    messages: rest,
    system,
    lane,
    maxTokens,
    surface,
    signal,
    onToken,
    onThinking,
  });

  return {
    text: res.text,
    reasoning: res.reasoning,
    // Present so destructuring call sites do not break; never a vendor name.
    provider: 'forge',
    model: 'forge',
    usage: undefined,
    cache: res.cache,
  };
}

/** Convenience wrapper returning just the text. */
export async function chat(messages, opts = {}) {
  const { text } = await complete({ messages, ...opts });
  return text;
}
