/**
 * POST /functions/v1/forge-generate — practice text, streamed.
 *
 * Serves /practice passages, /code snippets, drills and quotes.
 *
 * Two things differ from forge-chat:
 *
 *  1. The answer may come from the library rather than a provider. A hit is
 *     replayed as `token` frames rather than returned as JSON, so the client
 *     has exactly one rendering path and a hit still *feels* generated — which
 *     matters when most requests will eventually be hits.
 *
 *  2. There is a stage after the response: validate, save, queue for
 *     embedding. It runs inside `EdgeRuntime.waitUntil()` so it cannot delay
 *     a single token, and every failure in it is swallowed — the user already
 *     has their text, and a library that failed to grow is not an outage.
 */
import { generate, learn } from '../_shared/orchestrator.ts';
import { promptFor, laneFor } from '../_shared/prompts.ts';
import { normaliseFacets } from '../_shared/facets.ts';
import { checkByKind, salvageBody } from '../_shared/contracts.ts';
import { bodyFieldFor, JsonFieldStreamer } from '../_shared/jsonStream.ts';
import { IdentityFilter } from '../_shared/identity.ts';
import { SseWriter, SSE_HEADERS, chunkBody } from '../_shared/sse.ts';
import { callerFrom, CORS_HEADERS } from '../_shared/auth.ts';
import { checkLocal, record as recordRequest } from '../_shared/ratelimit.ts';
import { createForgeDb } from '../_shared/db.supabase.ts';
import { NULL_DB } from '../_shared/db.ts';
import { aiEnabled } from '../_shared/env.ts';
import { primeSecrets } from '../_shared/secrets.ts';
import type { ForgeUnavailable } from '../_shared/runner.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function keepAlive(p: Promise<unknown>): void {
  try {
    EdgeRuntime?.waitUntil(p);
  } catch {
    /* Local deno serve has no EdgeRuntime; the promise still runs. */
  }
}

interface GenerateBody {
  kind?: string;
  category?: string;
  level?: number;
  difficulty?: string;
  language?: string | null;
  topic?: string;
  words?: number;
  hint?: string;
  surface?: string;
}

const MAX_BODY_BYTES = 8 * 1024;
/** A steer, not a prompt. Long enough to be useful, short enough to contain. */
const MAX_HINT = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

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

  const caller = callerFrom(req);
  if (!caller) return json({ error: 'unauthenticated', reason: 'auth' }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413);

  let body: GenerateBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const facets = normaliseFacets(body);
  // The lane follows from the kind, never from the caller: otherwise a snippet
  // request could be routed into the 6000-token `deep` budget.
  const lane = laneFor(facets.kind);

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
  await primeSecrets(() => db.loadSecrets());
  recordRequest(db, caller.userId, lane);

  const requestId = crypto.randomUUID();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const sse = new SseWriter(writable);

  const pump = (async () => {
    const filter = new IdentityFilter();
    // The model replies with a JSON envelope. Pulling the body field out as it
    // streams is what stops a passage arriving with `{"text": "` on the front
    // of it; the identity filter then scrubs prose rather than punctuation.
    const field = new JsonFieldStreamer(bodyFieldFor(facets.kind));
    let rawText = '';

    try {
      const result = await generate({
        facets: body,
        messages: promptFor({
          facets,
          words: Math.max(20, Math.min(200, Number(body.words) || 60)),
          hint: typeof body.hint === 'string' ? body.hint.slice(0, MAX_HINT) : undefined,
        }),
        lane,
        db,
        userId: caller.userId,
        requestId,
        surface: body.surface ?? 'practice',
        signal: req.signal,
        onOutcome: (cache) => {
          void sse.send('meta', { requestId, lane, cache });
        },
        onToken: (delta) => {
          // Raw is kept for the quality gate; the filtered copy is what ships.
          rawText += delta;
          const inner = field.push(delta);
          if (!inner) return;
          const out = filter.push(inner);
          if (out) void sse.send('token', { delta: out });
        },
      });

      if (result.replay) {
        // A library hit. Chunked and paced so hit and miss share one client
        // path — about 16ms for a 400-character passage.
        for (const piece of chunkBody(result.body)) {
          await sse.send('token', { delta: piece });
        }
        if (caller.userId && result.generationId) {
          keepAlive(db.recordServe(result.generationId, caller.userId).catch(() => {}));
        }
        await sse.send('done', {
          cache: result.cache,
          generationId: result.generationId,
          title: result.title,
          meta: result.meta,
        });
        return;
      }

      const tail = filter.push(field.flush()) + filter.flush();
      if (tail) await sse.send('token', { delta: tail });

      // The client needs the parsed shape, not the raw JSON envelope the model
      // replied with. Validating here too means a bad generation still reaches
      // the user as text rather than as an error.
      const checked = checkByKind(facets.kind, result.body);
      await sse.send('done', {
        cache: 'miss',
        generationId: null,
        title: checked.ok ? checked.value.title : null,
        meta: checked.ok ? checked.value.meta : {},
        // A failed check still sends text. Omitting it makes the client fall
        // back to the raw stream, which is how an imperfect generation reached
        // the typing surface as a JSON envelope.
        body: checked.ok ? checked.value.body : (salvageBody(facets.kind, result.body) ?? undefined),
        valid: checked.ok,
      });

      // ── after the response ────────────────────────────────────────────
      keepAlive(
        learn({
          db,
          facets: body,
          raw: rawText || result.body,
          userId: caller.userId,
          provider: String(result.meta?.provider ?? ''),
          model: String(result.meta?.model ?? ''),
          lane,
        }).catch(() => ({ saved: false })),
      );
    } catch (err) {
      const e = err as ForgeUnavailable;
      const reason = e?.reason ?? 'network';
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
