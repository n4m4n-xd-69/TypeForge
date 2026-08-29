/**
 * The Forge wire protocol.
 *
 * Deliberately *not* a pass-through of the provider's own SSE. Forwarding the
 * upstream frames would carry `model`, `provider` and the upstream request id
 * straight to the browser, and that is the layer of the identity clamp that
 * actually holds — the other two are defence in depth against a model that
 * volunteers the information.
 *
 * Events:
 *   meta      once, first     { requestId, cache, lane }
 *   thinking  0..n            { delta }
 *   token     0..n            { delta }
 *   tool      0..n            { name, status }
 *   done      once, last      { tokens, cache, generationId? }
 *   error     terminal        { reason, label }
 *
 * `reason` values match the client's existing AI_REASON_COPY keys exactly, so
 * error handling in the UI needs no change.
 */

export type ForgeEvent = 'meta' | 'thinking' | 'token' | 'tool' | 'done' | 'error';

export type CacheOutcome = 'exact' | 'semantic' | 'miss';

const encoder = new TextEncoder();

/** One SSE frame. */
export function frame(event: ForgeEvent, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Comment frame. Intermediaries close a connection that looks idle, and a
 *  reasoning model can stream nothing but thinking for many seconds. */
export function keepalive(): Uint8Array {
  return encoder.encode(': keepalive\n\n');
}

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Nginx and friends buffer text/event-stream by default, which turns a
  // token-by-token stream into one burst at the end.
  'X-Accel-Buffering': 'no',
};

/**
 * A writer over a WritableStream, with the keepalive timer built in.
 *
 * `close()` is idempotent: a stream can end from the happy path, from a client
 * disconnect, and from an error handler, and a double close would throw inside
 * a `waitUntil` where nothing is watching.
 */
export class SseWriter {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(writable: WritableStream<Uint8Array>, keepaliveMs = 10_000) {
    this.writer = writable.getWriter();
    if (keepaliveMs > 0) {
      this.timer = setInterval(() => {
        void this.raw(keepalive());
      }, keepaliveMs);
    }
  }

  private async raw(bytes: Uint8Array): Promise<void> {
    if (this.closed) return;
    try {
      await this.writer.write(bytes);
    } catch {
      // The client went away mid-write. Not an error worth propagating — the
      // request's abort signal is the channel that actually matters.
      this.closed = true;
    }
  }

  send(event: ForgeEvent, data: unknown): Promise<void> {
    return this.raw(frame(event, data));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    try {
      await this.writer.close();
    } catch {
      /* already closed by the runtime */
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Chunks a stored body into token frames.
 *
 * A cache hit is replayed rather than returned as JSON so hit and miss share
 * exactly one rendering path in the client: the partial/settled split, the
 * rAF coalescing and the scroll anchor all keep working unchanged. A 400
 * character passage replays in about 16ms, well inside the lookup budget.
 */
export function* chunkBody(body: string, size = 200): Generator<string> {
  for (let i = 0; i < body.length; i += size) {
    yield body.slice(i, i + size);
  }
}
