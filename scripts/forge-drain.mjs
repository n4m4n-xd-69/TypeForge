/**
 * Drains the embedding queue from a workstation.
 *
 * The same logic the `forge-embed-drain` Edge Function runs on a schedule, in a
 * form you can point at the database by hand. Two real uses:
 *
 *   - backfill, after importing rows or changing the embedding model;
 *   - diagnosis, when `forge_generations.embedding` is not emptying and you
 *     need to see which row is failing and why.
 *
 *     SUPABASE_DB_PASSWORD=... FORGE_NVIDIA_KEY=... node scripts/forge-drain.mjs
 *
 * Reads the queue through the same `forge_*` RPCs the function uses, so a bug
 * in the SQL surfaces here identically rather than only in production.
 */
import pg from 'pg';
import { embed, toVectorLiteral } from '../supabase/functions/_shared/embeddings.ts';
import { embedTextFor } from '../supabase/functions/_shared/facets.ts';

const BATCH = Number(process.env.FORGE_DRAIN_BATCH ?? 16);
const VT_SECONDS = 60;

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: Number(process.env.SUPABASE_DB_PORT) || 5432,
  user: process.env.SUPABASE_DB_USER || 'postgres.kavfjyvsvgvcjiuwwfbw',
  password: process.env.SUPABASE_DB_PASSWORD || '',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  if (!process.env.FORGE_NVIDIA_KEY) {
    console.error('FORGE_NVIDIA_KEY is required — it is the only embedding provider.');
    process.exit(1);
  }

  await client.connect();

  const { rows } = await client.query(
    'select * from public.forge_read_embed_queue($1, $2)',
    [BATCH, VT_SECONDS],
  );
  console.log(`read ${rows.length} queued row(s)`);

  let embedded = 0;
  let deferred = 0;
  let dropped = 0;

  for (const row of rows) {
    // The body alone — matching the query side, which embeds a natural-language
    // description of what is wanted. Mixing facet tags in here put the two
    // vectors ~0.49 apart and stopped the semantic stage ever firing.
    const vector = await embed(embedTextFor(row.body), 'passage');

    if (!vector) {
      // Left on the queue on purpose: the visibility timeout expires and the
      // next run retries. A provider blip must not cost the row its embedding.
      console.warn(`  defer  ${row.generation_id} (embedding unavailable)`);
      deferred += 1;
      continue;
    }

    try {
      await client.query(
        'select public.forge_store_embedding($1, $2, $3::extensions.halfvec)',
        [row.generation_id, row.msg_id, toVectorLiteral(vector)],
      );
      console.log(`  ok     ${row.generation_id} (${vector.length} dims)`);
      embedded += 1;
    } catch (err) {
      // Neither a missing row nor a wrong-shaped vector fixes itself on retry,
      // so archive rather than let one message block the queue forever.
      console.error(`  drop   ${row.generation_id}: ${err.message}`);
      await client.query('select public.forge_drop_embed_message($1)', [row.msg_id]);
      dropped += 1;
    }
  }

  const { rows: [state] } = await client.query(`
    select
      (select count(*) from public.forge_generations where embedding is null) as awaiting,
      (select count(*) from pgmq.q_forge_embed) as queued
  `);

  console.log(`\nembedded ${embedded}, deferred ${deferred}, dropped ${dropped}`);
  console.log(`awaiting embedding: ${state.awaiting} · still queued: ${state.queued}`);

  await client.end();
}

main().catch(async (err) => {
  console.error('drain failed:', err);
  try { await client.end(); } catch { /* already closed */ }
  process.exit(1);
});
