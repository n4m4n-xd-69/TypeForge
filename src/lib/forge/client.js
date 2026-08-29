import { supabase, signInAnonymously } from '../supabase.js';
import { AI_TIMING, SUPABASE } from '../config.js';

/**
 * The browser end of the Forge wire protocol.
 *
 * Replaces the direct provider `fetch` that used to live in `ai-runner.js`.
 * Everything a provider key touched now happens inside an Edge Function; this
 * file only knows how to talk to that function.
 *
 * Two deliberate choices:
 *
 *  1. Raw `fetch`, never `supabase.functions.invoke()`. `invoke` parses the
 *     whole response before it returns, which turns a token stream into one
 *     burst at the end. Streaming needs `response.body.getReader()`.
 *
 *  2. `onToken` and `onThinking` receive the *accumulated* text, not the
 *     delta. That is the shape `useStreamingChat.js` already consumes, and
 *     keeping it means the rAF coalescing, the partial/settled split and the
 *     scroll anchor all keep working with no change to that file.
 */

/**
 * Wraps a caller's signal with a deadline.
 *
 * Without this the browser waits forever on a function that never answers.
 * The Edge Runtime's own ceilings (150s wall clock, 150s idle) are the outer
 * bound, but a client that only gives up when the platform does leaves a
 * spinner on screen for two and a half minutes.
 *
 * The caller's own abort still propagates — navigating away or switching
 * snippet cancels the request, which is what stops an abandoned tab spending
 * quota.
 */
function withDeadline(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    /** Distinguishes "we gave up" from "the caller cancelled". */
    timedOut: () => controller.signal.aborted && !signal?.aborted,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

/** Carries the same `reason` vocabulary as `AI_REASON_COPY`. */
export class ForgeError extends Error {
  constructor(message, reason = 'network', meta = {}) {
    super(message);
    this.name = 'ForgeError';
    this.reason = reason;
    this.meta = meta;
  }
}

function functionsBase() {
  const url = SUPABASE.url;
  if (!url) return '';
  return `${url.replace(/\/$/, '')}/functions/v1`;
}

export function forgeConfigured() {
  return Boolean(functionsBase() && supabase);
}

/**
 * One guest sign-in, however many callers ask at once.
 *
 * The home page opens the coach read and the chat panel in the same tick, and
 * `signInAnonymously` is not idempotent — two concurrent calls mint two
 * `auth.users` rows and the second silently orphans the first one's history.
 * Sharing the in-flight promise makes the second caller wait for the first
 * rather than race it. Cleared afterwards so a later call can retry if this
 * one failed.
 */
let guestSignIn = null;

function ensureGuest() {
  guestSignIn ??= signInAnonymously().finally(() => {
    guestSignIn = null;
  });
  return guestSignIn;
}

/**
 * Headers for a Forge call.
 *
 * Both are required and they are not interchangeable: the publishable key goes
 * on `apikey` because it is not a JWT and the platform cannot validate it as
 * one, and the user's session token goes on `Authorization` so `verify_jwt`
 * admits the request and the function can read who is calling.
 *
 * A missing session mints a guest rather than refusing.
 *
 * This is the difference between the old transport and this one. When the
 * provider key lived in the bundle, the AI answered a first-time visitor who
 * had never signed in to anything, because the browser called the provider
 * itself. Routing through an Edge Function makes a session mandatory — so
 * without this, moving the key server-side would have quietly turned every AI
 * surface off for signed-out visitors, which is most of them on a first visit.
 *
 * `signInAnonymously` is the same mechanism Battlefield, Shadow Battle and
 * onboarding already use: it mints a real `auth.users` row from nothing, so
 * every RLS policy keyed on `auth.uid()` works unchanged. Signing in is not a
 * wall here either.
 *
 * It returns null when anonymous sign-in is disabled for the project. That is
 * the one case that genuinely cannot be served, and it surfaces as `auth` —
 * which every AI surface already renders as a fallback rather than an error.
 */
async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  let token = data?.session?.access_token;

  if (!token) {
    const guest = await ensureGuest();
    if (guest) {
      const { data: fresh } = await supabase.auth.getSession();
      token = fresh?.session?.access_token;
    }
  }

  if (!token) throw new ForgeError('Not signed in', 'auth');
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE.anonKey,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Reads the Forge SSE grammar off a response body.
 *
 * Frames are `event: <name>\ndata: <json>\n\n`. The buffer is scanned with
 * `indexOf` rather than split so a frame arriving in two network reads is
 * reassembled instead of dropped.
 */
async function readEvents(res, handlers, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
          // ':' comment frames (keepalives) fall through and are ignored.
        }
        if (!data) continue;

        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        handlers[event]?.(payload);
      }
    }
  } finally {
    // An aborted read leaves the reader locked; releasing it lets the
    // connection actually close rather than lingering until GC.
    try {
      if (!signal?.aborted) await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Streams one turn.
 *
 * Returns `{ text, reasoning }`, matching the old `streamChat` contract so
 * `useStreamingChat` is a drop-in consumer.
 */
export async function streamChat({
  messages,
  system,
  lane,
  onThinking,
  onToken,
  signal,
  maxTokens,
  surface = 'chat',
} = {}) {
  if (!forgeConfigured()) throw new ForgeError('Forge is not configured', 'no-key');

  const headers = await authHeaders();
  const deadline = withDeadline(signal, AI_TIMING.requestTimeoutMs);

  let res;
  try {
    res = await fetch(`${functionsBase()}/forge-chat`, {
      method: 'POST',
      headers,
      signal: deadline.signal,
      body: JSON.stringify({ messages, system, lane, maxTokens, surface }),
    });
  } catch (err) {
    if (deadline.timedOut()) {
      deadline.done();
      throw new ForgeError('Forge did not answer in time', 'timeout');
    }
    deadline.done();
    if (signal?.aborted) throw err;
    throw new ForgeError(err?.message ?? 'network error', 'network');
  }

  if (!res.ok || !res.body) {
    let reason = res.status === 429 ? 'rate-limit'
      : res.status === 401 ? 'auth'
        : res.status === 503 ? 'no-key'
          : 'network';
    let detail = '';
    try {
      const body = await res.json();
      if (body?.reason) reason = body.reason;
      detail = body?.error ?? '';
    } catch {
      /* not json */
    }
    throw new ForgeError(detail || `HTTP ${res.status}`, reason);
  }

  let text = '';
  let reasoning = '';
  let failure = null;
  let meta = null;

  await readEvents(res, {
    meta: (p) => { meta = p; },
    token: (p) => {
      text += p.delta ?? '';
      // Accumulated, not the delta — see the note at the top of this file.
      onToken?.(text);
    },
    thinking: (p) => {
      reasoning += p.delta ?? '';
      onThinking?.(reasoning);
    },
    error: (p) => { failure = p; },
  }, deadline.signal).finally(deadline.done);

  if (failure) throw new ForgeError(failure.label ?? 'Forge failed', failure.reason ?? 'network');
  if (!text.trim()) {
    // A stream that ended empty because we hit the deadline is a timeout, not
    // an unreadable reply — the distinction is what the user is told.
    throw new ForgeError(
      'Empty response',
      deadline.timedOut() ? 'timeout' : 'bad-response',
    );
  }

  return { text: text.trim(), reasoning, cache: meta?.cache ?? 'miss' };
}

/** Non-streaming convenience for JSON-contract calls. */
export async function forgeChat(messages, opts = {}) {
  const { text } = await streamChat({ messages, ...opts });
  return text;
}

/**
 * Practice text: passages, snippets, drills, quotes.
 *
 * Distinct from `streamChat` because this endpoint may answer from the shared
 * library instead of a model. The caller cannot tell from the token stream —
 * a hit is replayed as the same `token` frames — which is the point: one
 * rendering path, and a hit that still feels generated.
 *
 * The `done` frame carries the parsed shape (`body`, `title`, `meta`), because
 * the raw stream is a JSON envelope the model wrote and the UI wants the text
 * inside it. `valid` says whether it passed the server's quality gate; an
 * invalid generation is still returned rather than thrown, so the user gets
 * text rather than an error.
 */
export async function generateContent({
  kind = 'passage',
  category,
  level,
  difficulty,
  language,
  topic,
  words,
  hint,
  surface = 'practice',
  onToken,
  signal,
} = {}) {
  if (!forgeConfigured()) throw new ForgeError('Forge is not configured', 'no-key');

  const headers = await authHeaders();
  const deadline = withDeadline(signal, AI_TIMING.quickTimeoutMs);

  let res;
  try {
    res = await fetch(`${functionsBase()}/forge-generate`, {
      method: 'POST',
      headers,
      signal: deadline.signal,
      body: JSON.stringify({
        kind, category, level, difficulty, language, topic, words, hint, surface,
      }),
    });
  } catch (err) {
    if (deadline.timedOut()) {
      deadline.done();
      throw new ForgeError('Forge did not answer in time', 'timeout');
    }
    deadline.done();
    if (signal?.aborted) throw err;
    throw new ForgeError(err?.message ?? 'network error', 'network');
  }

  if (!res.ok || !res.body) {
    let reason = res.status === 429 ? 'rate-limit'
      : res.status === 401 ? 'auth'
        : res.status === 503 ? 'no-key'
          : 'network';
    try {
      const body = await res.json();
      if (body?.reason) reason = body.reason;
    } catch {
      /* not json */
    }
    throw new ForgeError(`HTTP ${res.status}`, reason);
  }

  let streamed = '';
  let meta = null;
  let done = null;
  let failure = null;

  await readEvents(res, {
    meta: (p) => { meta = p; },
    token: (p) => {
      streamed += p.delta ?? '';
      onToken?.(streamed);
    },
    done: (p) => { done = p; },
    error: (p) => { failure = p; },
  }, deadline.signal).finally(deadline.done);

  if (failure) throw new ForgeError(failure.label ?? 'Forge failed', failure.reason ?? 'network');

  // `done.body` is the parsed text; `streamed` is the raw envelope on a miss
  // and the finished text on a hit. Prefer the parsed form when it exists.
  const body = done?.body ?? streamed;
  if (!body.trim()) throw new ForgeError('Empty generation', 'bad-response');

  return {
    body: body.trim(),
    title: done?.title ?? null,
    meta: done?.meta ?? {},
    cache: done?.cache ?? meta?.cache ?? 'miss',
    generationId: done?.generationId ?? null,
    valid: done?.valid !== false,
  };
}
