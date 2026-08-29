/**
 * POST /functions/v1/forge-embed-drain — fills in missing embeddings.
 *
 * Called by pg_cron through pg_net, not by a browser. It authenticates on the
 * project's secret key in the `apikey` header rather than a user JWT, which is
 * why `verify_jwt` is off for this function and why it never reads a user id.
 *
 * This exists because embedding cannot happen inside a generation request. An
 * Edge Function gets 2s of actual CPU; an embedding round trip plus parsing a
 * 2048-float array would spend a large part of it on work the user is not
 * waiting for. So the request enqueues an id and returns, and this drains the
 * queue on a schedule — Supabase's own documented pgmq + pg_net + pg_cron
 * pattern for exactly this.
 */
import { createForgeDb, serviceClient } from '../_shared/db.supabase.ts';
import { embed, toVectorLiteral } from '../_shared/embeddings.ts';
import { embedTextFor } from '../_shared/facets.ts';
import { primeSecrets } from '../_shared/secrets.ts';
import { isServiceCaller, CORS_HEADERS } from '../_shared/auth.ts';
import { env } from '../_shared/env.ts';

/** One batch. Small enough to stay well inside the CPU and wall-clock budget. */
const BATCH = 16;
/** Visibility timeout: long enough to embed a batch, short enough to retry. */
const VT_SECONDS = 60;

/**
 * Every key that may legitimately be presented on `apikey`.
 *
 * Both forms are returned rather than one, because the project is mid-migration
 * from the legacy `service_role` JWT to `sb_secret_` keys and the platform
 * injects both. See the note in `isServiceCaller`.
 */
function secretKeys(): string[] {
  const keys: string[] = [];

  // The scheduled caller's own secret, checked first because it is the one the
  // cron job actually sends. It exists so that header does not have to carry
  // the service_role key: pg_net persists request headers in
  // `net.http_request_queue`, so anything sent there is stored in a table, and
  // a scoped secret that only opens this endpoint is a far smaller thing to
  // leave lying in one. It rotates independently of every other credential.
  const cron = env('FORGE_CRON_SECRET');
  if (cron) keys.push(cron);

  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.push(legacy);
  try {
    const dict = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    for (const v of Object.values(dict)) {
      if (typeof v === 'string' && v) keys.push(v);
    }
  } catch {
    /* not json — the legacy key alone still works */
  }
  return keys;
}

interface QueueRow {
  msg_id: number;
  generation_id: string;
  body: string;
  kind: string;
  language: string | null;
  topic: string;
  difficulty: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  // verify_jwt is off here, so the check is explicit and must not be skipped.
  if (!isServiceCaller(req, ...secretKeys())) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = serviceClient();
  const db = createForgeDb();
  if (!sb || !db) {
    return new Response(JSON.stringify({ error: 'no service client' }), { status: 503 });
  }

  await primeSecrets(() => db.loadSecrets());

  const { data, error } = await sb.rpc('forge_read_embed_queue', {
    p_limit: BATCH,
    p_vt: VT_SECONDS,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (data ?? []) as QueueRow[];
  let embedded = 0;
  let dropped = 0;
  let deferred = 0;

  for (const row of rows) {
    // The body alone, deliberately.
    //
    // The first version embedded facet tags plus the body here while the query
    // side embedded only the tags. Measured against real rows that scored 0.49
    // — under the serve threshold, so the semantic stage would have quietly
    // never fired. Facets are handled by the SQL prefilter; the vector carries
    // topical meaning and nothing else. Thresholds live in `orchestrator.ts`
    // and are reproducible via `npm run forge:calibrate`.
    const vector = await embed(embedTextFor(row.body), 'passage');

    if (!vector) {
      // Leave the message on the queue: its visibility timeout expires and the
      // next run retries. A provider outage should not cost the row its
      // embedding permanently.
      deferred += 1;
      continue;
    }

    const { error: storeError } = await sb.rpc('forge_store_embedding', {
      p_generation: row.generation_id,
      p_msg_id: row.msg_id,
      p_embedding: toVectorLiteral(vector),
    });

    if (storeError) {
      // The row is gone, or the vector is the wrong shape — neither will fix
      // itself on a retry, so archive rather than let it block the queue.
      await sb.rpc('forge_drop_embed_message', { p_msg_id: row.msg_id });
      dropped += 1;
      continue;
    }
    embedded += 1;
  }

  return new Response(
    JSON.stringify({ read: rows.length, embedded, deferred, dropped }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
