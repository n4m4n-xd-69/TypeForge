/**
 * The generation pipeline.
 *
 * Deliberately a fixed sequence, not an agent loop. An Edge Function has 2s of
 * CPU and a 150s wall clock; a loop that decides its own next step has no
 * bound on either, and this product's entire premise is latency. What makes it
 * extensible is that each stage is a plain function — a tool-calling excursion
 * or a re-rank slots in as another stage without changing the shape.
 *
 *   ① key      normalise facets -> request hash
 *   ② race     lookup vs. speculative generation, 120ms budget
 *   ③ stream   whichever won, through the identity filter
 *   ④ learn    validate -> save -> enqueue embedding   (after the response)
 *
 * ── Why stage ② is a race and not a sequence ─────────────────────────────
 *
 * The obvious design looks up first and generates on a miss. That adds the
 * full lookup latency to every miss, and misses are the common case until the
 * library fills — so the feature is slowest exactly when it is newest.
 *
 * Instead both start in the same tick. If the lookup wins inside its budget
 * the generation is aborted and the cached body is replayed. If it does not,
 * generation is already hundreds of milliseconds along. The cost of a losing
 * speculative generation is a few dozen tokens; the cost of a serialised
 * lookup is ~130ms on every miss, forever.
 *
 * Speculation is skipped when the bucket is known to be dense, because there a
 * hit is likely and the tokens would usually be wasted.
 */
import { complete, ForgeUnavailable, type Message } from './runner.ts';
import { laneById, type LaneId } from './lanes.ts';
import type { ForgeDb, LibraryRow } from './db.ts';
import {
  contentHash, normaliseFacets, queryText, requestHash, type Facets,
} from './facets.ts';
import { checkByKind } from './contracts.ts';
import { embed } from './embeddings.ts';

/** How long the lookup gets before generation is allowed to win by default. */
const LOOKUP_BUDGET_MS = 120;

/** At or above this many rows in a bucket, skip speculation and just look up. */
const DENSE_BUCKET = 8;

/* ── Similarity thresholds, measured rather than assumed ──────────────────
 *
 * ARCHITECTURE.md specified 0.86 to serve and 0.78 to anchor. Those numbers
 * were never calibrated against `nemotron-3-embed-1b`, and they are not
 * reachable with it: on a four-topic calibration set of real passages, a
 * *correct* query/passage pair scored between 0.19 and 0.46.
 *
 * Worse, the relevant and irrelevant ranges overlap. Top-1 ranking was 4/4 —
 * the model does know which passage is on-topic — but the best irrelevant pair
 * (0.239) scored higher than the worst relevant one (0.193). No single global
 * cutoff separates them, so a threshold tuned to fire often would sometimes
 * serve a passage about the sea to someone who asked about cooking.
 *
 * So the two thresholds are given different jobs:
 *
 *   SERVE  is set above everything observed, relevant or not. It is expected
 *          to fire rarely, and that is the correct behaviour: serving the
 *          wrong text is a visible product failure, while missing a reuse
 *          opportunity only costs tokens. Exact-facet lookup — which is
 *          precise by construction — remains the path that actually carries
 *          reuse.
 *
 *   ANCHOR is set low, because a wrong match there costs nothing at all: it
 *          only steers a fresh generation away from text that already exists.
 *          This is where semantic retrieval earns its keep today.
 *
 * Both are re-derivable: `scripts/forge-calibrate.mjs` prints the table these
 * came from. Re-run it if the embedding model ever changes.
 */
const SERVE_THRESHOLD = 0.55;
const ANCHOR_THRESHOLD = 0.20;

export type CacheOutcome = 'exact' | 'semantic' | 'miss';

export interface GenerateRequest {
  facets: Partial<Record<keyof Facets, unknown>>;
  /** Built by the caller from prompts.ts. */
  messages: Message[];
  lane: LaneId;
  db: ForgeDb;
  userId: string | null;
  requestId: string;
  surface: string;
  signal?: AbortSignal;
  /** Deltas as they arrive. Only ever called for a generated answer. */
  onToken?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  /** Called once the outcome is known, before any body is emitted. */
  onOutcome?: (outcome: CacheOutcome) => void;
}

export interface GenerateResult {
  cache: CacheOutcome;
  body: string;
  title: string | null;
  meta: Record<string, unknown>;
  generationId: string | null;
  /** Set when the answer came from the library and must still be replayed. */
  replay: boolean;
}

/** Bucket density, per isolate. Cheap and allowed to be slightly stale. */
const density = new Map<string, number>();

export function resetOrchestratorCache(): void {
  density.clear();
}

function toRow(r: LibraryRow, cache: CacheOutcome): GenerateResult {
  return {
    cache,
    body: r.body,
    title: r.title,
    meta: r.meta ?? {},
    generationId: r.id,
    replay: true,
  };
}

/**
 * Stage ②'s lookup half. Exact first, then semantic; both are allowed to fail
 * without taking the request down, because a lookup failure only costs tokens.
 */
async function lookup(
  db: ForgeDb,
  facets: Facets,
  reqHash: string,
  userId: string | null,
): Promise<GenerateResult | { anchor: string } | null> {
  try {
    const exact = await db.lookupExact(reqHash, userId);
    if (exact.length > 0) return toRow(exact[0], 'exact');
  } catch {
    return null;
  }

  try {
    const vector = await embed(queryText(facets), 'query');
    if (!vector) return null;

    const matches = await db.matchSemantic(
      vector,
      {
        kind: facets.kind,
        category: facets.category,
        difficulty: facets.difficulty,
        language: facets.language,
        level: facets.level,
      },
      userId,
      ANCHOR_THRESHOLD,
    );
    if (matches.length === 0) return null;

    const best = matches[0];
    if (best.similarity >= SERVE_THRESHOLD) return toRow(best, 'semantic');

    // A near hit is not served — it is handed to the prompt as something to
    // steer away from. This is a better version of the `avoid: []` list the
    // client used to carry, because it is retrieved rather than remembered.
    return { anchor: best.body.slice(0, 240) };
  } catch {
    return null;
  }
}

/**
 * Runs the pipeline. Returns as soon as an answer exists; the caller is
 * responsible for stage ④, which must not block the response.
 */
export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  const facets = normaliseFacets(req.facets);
  const reqHash = await requestHash(facets);
  const lane = laneById(req.lane);

  const bucketIsDense = (density.get(reqHash) ?? 0) >= DENSE_BUCKET;

  /* ── ② race ─────────────────────────────────────────────────────────── */

  const lookupPromise = lookup(req.db, facets, reqHash, req.userId);

  if (bucketIsDense) {
    // A hit is likely; spending tokens on a speculative generation that will
    // almost certainly be thrown away is the wrong trade here.
    const hit = await lookupPromise;
    if (hit && 'body' in hit) {
      req.onOutcome?.(hit.cache);
      density.set(reqHash, (density.get(reqHash) ?? 0) + 1);
      return hit;
    }
  } else {
    // Give the lookup a head start it can actually win with, then commit.
    const quick = await Promise.race([
      lookupPromise,
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), LOOKUP_BUDGET_MS)),
    ]);
    if (quick !== 'timeout' && quick && 'body' in quick) {
      req.onOutcome?.(quick.cache);
      density.set(reqHash, (density.get(reqHash) ?? 0) + 1);
      return quick;
    }
  }

  /* ── ③ generate ─────────────────────────────────────────────────────── */

  req.onOutcome?.('miss');

  // The near-hit anchor, if the lookup produced one in time. Not awaited a
  // second time — if it is still running, we generate without it rather than
  // pay for it twice.
  const settled = await Promise.race([
    lookupPromise,
    Promise.resolve<null>(null),
  ]);
  const anchor = settled && 'anchor' in settled ? settled.anchor : null;

  const messages: Message[] = anchor
    ? [
        ...req.messages.slice(0, -1),
        {
          role: 'user',
          content:
            `${req.messages[req.messages.length - 1].content}\n\n` +
            'Write something clearly different in subject and opening words ' +
            `from this, which already exists:\n"""${anchor}"""`,
        },
      ]
    : req.messages;

  const result = await complete({
    messages,
    lane,
    db: req.db,
    stream: true,
    signal: req.signal,
    surface: req.surface,
    userId: req.userId,
    requestId: req.requestId,
    onToken: (delta) => req.onToken?.(delta),
    onThinking: (delta) => req.onThinking?.(delta),
  });

  return {
    cache: 'miss',
    body: result.text,
    title: null,
    meta: { provider: result.provider, model: result.model },
    generationId: null,
    replay: false,
  };
}

/**
 * Stage ④. Validate, store, queue for embedding.
 *
 * Runs after the response has been handed to the client, inside the caller's
 * `EdgeRuntime.waitUntil()`. Every failure here is swallowed: the user already
 * has their answer, and a library that failed to grow is not an outage.
 */
export async function learn(opts: {
  db: ForgeDb;
  facets: Partial<Record<keyof Facets, unknown>>;
  raw: string;
  userId: string | null;
  provider?: string;
  model?: string;
  lane?: string;
}): Promise<{ saved: boolean; reason?: string; generationId?: string }> {
  try {
    const facets = normaliseFacets(opts.facets);
    const checked = checkByKind(facets.kind, opts.raw);
    if (!checked.ok) return { saved: false, reason: checked.reason };

    const [reqHash, bodyHash] = await Promise.all([
      requestHash(facets),
      contentHash(checked.value.body),
    ]);

    const id = await opts.db.saveGeneration({
      ...facets,
      title: checked.value.title,
      body: checked.value.body,
      meta: checked.value.meta,
      wordCount: checked.value.wordCount,
      contentHash: bodyHash,
      requestHash: reqHash,
      provider: opts.provider,
      model: opts.model,
      lane: opts.lane,
      createdBy: opts.userId,
    });
    if (!id) return { saved: false, reason: 'save returned no id' };

    density.set(reqHash, (density.get(reqHash) ?? 0) + 1);

    if (opts.userId) await opts.db.recordServe(id, opts.userId);
    await opts.db.enqueueEmbed(id);

    return { saved: true, generationId: id };
  } catch (err) {
    return { saved: false, reason: (err as Error)?.message ?? 'unknown' };
  }
}

export { ForgeUnavailable };
