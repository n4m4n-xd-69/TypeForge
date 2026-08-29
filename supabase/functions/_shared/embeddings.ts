/**
 * Embeddings, for the semantic stage of the library lookup.
 *
 * One model, one provider: `nvidia/nemotron-3-embed-1b` on NIM is the only
 * embedding model any of the four providers exposes to this account. It emits
 * exactly 2048 dimensions and rejects every other `dimensions` value — there
 * is no Matryoshka truncation to fall back on.
 *
 * That number is why `forge_generations.embedding` is `halfvec(2048)` rather
 * than `vector(2048)`: pgvector indexes `vector` only up to 2000 dimensions, so
 * the obvious column type could not carry an ANN index at all and every lookup
 * would sequentially scan the library.
 *
 * `input_type` is not optional for this model family. A passage embedded as a
 * query and a query embedded as a passage land in different regions of the
 * space, and the resulting similarities are quietly meaningless rather than
 * obviously broken.
 */
import { PROVIDERS } from './providers.ts';
import { headersFor, isActive } from './providers.ts';
import { EMBED_DIMS, EMBED_MODEL } from './lanes.ts';

const TIMEOUT_MS = 5_000;

export type InputType = 'query' | 'passage';

/**
 * Returns the vector, or null.
 *
 * Null rather than throwing: every caller treats a missing embedding as "skip
 * the semantic stage", which degrades to exact-match-only reuse. That is a
 * worse cache, not a broken request.
 */
export async function embed(
  text: string,
  inputType: InputType,
  signal?: AbortSignal,
): Promise<number[] | null> {
  const input = String(text ?? '').trim();
  if (!input) return null;
  if (!isActive('nim')) return null;

  const endpoint = PROVIDERS.nim.embedEndpoint;
  if (!endpoint) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: headersFor('nim'),
      signal: controller.signal,
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: [input.slice(0, 4000)],
        input_type: inputType,
        encoding_format: 'float',
      }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const vector = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) return null;

    // A wrong-length vector would be rejected by Postgres anyway, but failing
    // here keeps the error at the boundary that can explain it.
    if (vector.length !== EMBED_DIMS) return null;

    return vector as number[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Postgres literal for a halfvec column. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
