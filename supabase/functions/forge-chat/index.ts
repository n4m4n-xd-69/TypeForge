/**
 * POST /functions/v1/forge-chat — one conversational turn, streamed.
 *
 * Serves the chat page, the floating panel, the code sidebar and the coach.
 *
 * Two things here are mandatory rather than stylistic, and both come from the
 * Edge Runtime's supervisor:
 *
 *  1. `EdgeRuntime.waitUntil()` around the pump. An isolate is retired once the
 *     response has returned *and* every waitUntil promise has settled. A
 *     stream returned without it is cut mid-answer — this is the documented
 *     "SSE or AI streams end before completion" failure.
 *
 *  2. No buffering anywhere. 256MB of memory and 2s of *CPU* per request; the
 *     provider wait is free but per-frame work is not, so a delta is written
 *     out in the same tick it is parsed.
 */
import { complete, ForgeUnavailable } from '../_shared/runner.ts';
import { resolveLane } from '../_shared/lanes.ts';
import { IdentityFilter, withIdentity } from '../_shared/identity.ts';
import { SseWriter, SSE_HEADERS } from '../_shared/sse.ts';
import { callerFrom, CORS_HEADERS } from '../_shared/auth.ts';
import { checkLocal, record as recordRequest } from '../_shared/ratelimit.ts';
import { createForgeDb } from '../_shared/db.supabase.ts';
import { NULL_DB } from '../_shared/db.ts';
import { aiEnabled } from '../_shared/env.ts';
import { primeSecrets } from '../_shared/secrets.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Keeps the isolate alive for work that outlives the response object. */
function keepAlive(p: Promise<unknown>): void {
  try {
    EdgeRuntime?.waitUntil(p);
  } catch {
    /* Local `deno serve` has no EdgeRuntime; the promise still runs. */
  }
}

interface ChatRequest {
  messages?: Array<{ role: string; content: string }>;
  system?: string;
  lane?: string;
  surface?: string;
  maxTokens?: number;
}

const MAX_BODY_BYTES = 32 * 1024;
const MAX_TURNS = 24;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Reason -> the copy the client already has for it. */
const LABELS: Record<string, string> = {
  'rate-limit': 'Limit reached',
  auth: 'Key rejected',
  network: 'Unreachable',
  timeout: 'Timed out',
  'no-key': 'No API key',
  'bad-response': 'Unreadable reply',
  'bad-request': 'Request rejected',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!aiEnabled()) return json({ error: 'disabled', reason: 'no-key' }, 503);

  // The platform has already validated the signature (verify_jwt = true);
  // this only reads the claims out of it.
  const caller = callerFrom(req);
  if (!caller) return json({ error: 'unauthenticated', reason: 'auth' }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413);

  let body: ChatRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const messages = (body.messages ?? [])
    .filter((m) => m && typeof m.content === 'string' && m.content.length > 0)
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));

  if (messages.length === 0) return json({ error: 'no messages' }, 400);

  // `lane` arrives off the wire, so it goes through resolveLane — which admits
  // only the public lanes. A client must not be able to select `guard` or
  // `embed`.
  const lane = resolveLane(body.lane);

  const verdict = checkLocal(caller.userId, caller.isAnonymous);
  if (!verdict.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate limited', reason: 'rate-limit', scope: verdict.reason }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(verdict.retryAfterSec ?? 60),
          ...CORS_HEADERS,
        },
      },
    );
  }

  const db = createForgeDb() ?? NULL_DB;

  // Resolves provider keys before anything reads them. No-op after the first
  // request in this isolate, and a no-op entirely when the environment already
  // carries the keys — `secret()` prefers the environment and never asks.
  await primeSecrets(() => db.loadSecrets());

  recordRequest(db, caller.userId, lane.id);

  const requestId = crypto.randomUUID();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const sse = new SseWriter(writable);

  const pump = (async () => {
    // Separate filters: a leak in the visible answer and a leak in the
    // thinking trace are equally a leak, but they are two independent streams
    // and one carry buffer cannot serve both.
    const contentFilter = new IdentityFilter();
    const thinkingFilter = new IdentityFilter();
    let tokens = 0;

    try {
      await sse.send('meta', { requestId, lane: lane.id, cache: 'miss' });

      const result = await complete({
        messages: [
          { role: 'system', content: withIdentity(body.system) },
          ...messages,
        ],
        lane,
        db,
        stream: true,
        maxTokens: body.maxTokens,
        signal: req.signal,
        surface: body.surface ?? 'chat',
        userId: caller.userId,
        requestId,
        onToken: (delta) => {
          const out = contentFilter.push(delta);
          if (out) {
            tokens += 1;
            void sse.send('token', { delta: out });
          }
        },
        onThinking: (delta) => {
          const out = thinkingFilter.push(delta);
          if (out) void sse.send('thinking', { delta: out });
        },
      });

      // Whatever the filters were still holding when the stream ended.
      const tail = contentFilter.flush();
      if (tail) await sse.send('token', { delta: tail });
      const thinkTail = thinkingFilter.flush();
      if (thinkTail) await sse.send('thinking', { delta: thinkTail });

      // No model, no provider, no upstream id: the wire has no field for them,
      // which is the layer of the clamp that actually holds.
      await sse.send('done', {
        tokens: result.usage?.completion_tokens ?? tokens,
        cache: 'miss',
        rewritten: contentFilter.didRewrite || thinkingFilter.didRewrite,
      });
    } catch (err) {
      const e = err as ForgeUnavailable;
      const reason = e?.reason ?? 'network';
      // A client that navigated away is not an error worth reporting to it.
      if (!req.signal.aborted) {
        await sse.send('error', { reason, label: LABELS[reason] ?? 'Unreachable' });
      }
    } finally {
      await sse.close();
    }
  })();

  keepAlive(pump);

  return new Response(readable, { headers: { ...SSE_HEADERS, ...CORS_HEADERS } });
});
