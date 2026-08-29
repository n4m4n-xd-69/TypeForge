/**
 * The transport layer: provider selection, hedging, failover and streaming.
 *
 * A server-side port of `src/lib/ai-runner.js`. The two rules that shaped the
 * original still hold and are the reason this is a port rather than a rewrite:
 *
 *   1. Providers are tried in priority order, interleaved so a backup gets an
 *      early slot rather than a place at the bottom.
 *   2. Nothing is allowed to hang. Each attempt has its own timeout, and the
 *      next attempt starts *while the previous is still running* rather than
 *      after it fails — a slow model costs a hedge delay, not a full timeout.
 *
 * What is new here is everything the client could not do: the breaker and
 * budget filters in front of the plan, and per-attempt usage rows written by
 * the server rather than reported by the browser.
 *
 * CPU discipline: an Edge Function gets 2s of actual CPU per request, and a
 * long stream is thousands of frames. Waiting on a provider costs nothing, but
 * per-frame work does — so the SSE scanner splits on newlines with `indexOf`
 * rather than building arrays, and skips `JSON.parse` for any line that is not
 * a data frame.
 */
import { headersFor, PROVIDERS, isActive, type ProviderId } from './providers.ts';
import { LANES, isLaneId, type Lane, type LaneId, type Rung } from './lanes.ts';
import { NULL_DB, type ForgeDb } from './db.ts';
import * as breaker from './breaker.ts';
import * as budget from './budget.ts';

export type Reason =
  | 'rate-limit' | 'auth' | 'network' | 'timeout'
  | 'no-key' | 'bad-response' | 'bad-request';

export class ForgeUnavailable extends Error {
  reason: Reason;
  meta: Record<string, unknown>;
  constructor(message: string, reason: Reason = 'network', meta: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ForgeUnavailable';
    this.reason = reason;
    this.meta = meta;
  }
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AttemptInfo {
  provider: ProviderId;
  model: string;
  index: number;
}

export interface CompleteOptions {
  messages: Message[];
  lane?: LaneId | Lane;
  db?: ForgeDb;
  signal?: AbortSignal;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Deltas, not accumulations — the proxy forwards these straight out. */
  onToken?: (delta: string, full: string) => void;
  onThinking?: (delta: string, full: string) => void;
  onAttempt?: (info: AttemptInfo) => void;
  surface?: string;
  userId?: string | null;
  requestId?: string;
  /** Overall ceiling across every attempt. */
  totalTimeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  reasoning: string;
  provider: ProviderId;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  attemptIndex: number;
}

/** How many rungs of a ladder are ever attempted. */
const MAX_ATTEMPTS = 6;

/* ── Attempt planning ──────────────────────────────────────────────────── */

/**
 * Filters a lane's ladder down to what is worth attempting right now.
 *
 * Order is preserved from the lane: the ladders are already interleaved across
 * providers by hand, which is more deliberate than a round-robin could be —
 * `code` leads with a purpose-built coding model rather than with whichever
 * provider happens to sort first.
 */
export async function planAttempts(
  lane: Lane,
  db: ForgeDb,
  now = Date.now(),
): Promise<Rung[]> {
  const open = await breaker.openModels(db, now);
  await budget.refresh(db, now);

  const withKey = lane.ladder.filter(([p]) => isActive(p));
  const usable = withKey.filter(
    ([p, m]) => !open.has(breaker.key(p, m)) && budget.canSpend(p),
  );

  // Every remaining rung is either open or out of budget. A rate-limited
  // answer still beats no answer, so fall back to whatever has a key rather
  // than reporting the lane as dead.
  const plan = usable.length > 0 ? usable : withKey;
  return plan.slice(0, MAX_ATTEMPTS) as Rung[];
}

/* ── HTTP status → reason ──────────────────────────────────────────────── */

export function classify(status: number): Reason {
  if (status === 429) return 'rate-limit';
  if (status === 401 || status === 403) return 'auth';
  // A 400 is us, not them: a malformed request fails identically on every
  // attempt, so failover cannot rescue it and the breaker must not open the
  // model for it. This is how `temperature: 1.1` once failed 100% of one
  // provider's requests while looking like a network problem.
  if (status === 400) return 'bad-request';
  return 'network';
}

/* ── One request ───────────────────────────────────────────────────────── */

interface OnceArgs {
  provider: ProviderId;
  model: string;
  messages: Message[];
  maxTokens: number;
  temperature: number;
  /** Whether this lane wants a visible chain of thought at all. */
  wantThinking: boolean;
  reasoningEffort?: string;
  signal: AbortSignal;
  stream: boolean;
  onToken?: (delta: string, full: string) => void;
  onThinking?: (delta: string, full: string) => void;
}

async function callOnce(a: OnceArgs) {
  const p = PROVIDERS[a.provider];

  // Clamped per provider rather than at each call site: a caller asking for
  // more creativity than a provider allows should get that provider's
  // maximum, not a 400 that failover then has to paper over.
  const temperature = p.maxTemperature != null
    ? Math.min(a.temperature, p.maxTemperature)
    : a.temperature;

  const body: Record<string, unknown> = {
    model: a.model,
    messages: a.messages,
    max_tokens: a.maxTokens,
    temperature,
  };
  if (a.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  // Thinking on or off, in whatever dialect this provider speaks. Sending a
  // single cross-provider field here was wrong: `reasoning_effort: "none"`
  // returned 500 from every NIM model tested.
  Object.assign(body, p.thinkingBody?.(a.wantThinking, a.reasoningEffort) ?? {});

  const res = await fetch(p.endpoint, {
    method: 'POST',
    headers: headersFor(a.provider),
    signal: a.signal,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ForgeUnavailable(
      `${a.provider}/${a.model} -> ${res.status}`,
      classify(res.status),
      { status: res.status, body: text.slice(0, 200) },
    );
  }

  if (!a.stream) {
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    const text = (msg?.content ?? '').trim();
    const reasoning = msg?.reasoning_content ?? msg?.reasoning ?? '';
    if (!text) {
      throw new ForgeUnavailable(`${a.provider}/${a.model} returned no content`, 'bad-response');
    }
    return { text, reasoning, usage: data?.usage };
  }

  return await readStream(res, a);
}

/**
 * OpenAI-shaped SSE.
 *
 * All four providers emit the same frame shape, and the reasoning models put
 * their chain of thought in `delta.reasoning_content` — verified on NVIDIA NIM,
 * which streams many reasoning frames before the first content frame.
 */
async function readStream(res: Response, a: OnceArgs) {
  if (!res.body) throw new ForgeUnavailable('no response body', 'bad-response');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Scan with indexOf rather than split(): split allocates an array per
    // chunk, and this loop runs thousands of times inside a 2s CPU budget.
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);

      // Cheapest possible rejection of keepalives, blank lines and `event:`.
      if (line.charCodeAt(0) !== 100 /* d */ || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let chunk: {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string } }>;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        // A partial frame. Put it back and wait for the rest of it, otherwise
        // a token split across two network reads is silently dropped.
        buffer = `data: ${payload}\n${buffer}`;
        break;
      }

      if (chunk.usage) usage = chunk.usage;

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      const think = delta.reasoning_content ?? delta.reasoning;
      if (think) {
        reasoning += think;
        a.onThinking?.(think, reasoning);
      }
      if (delta.content) {
        content += delta.content;
        a.onToken?.(delta.content, content);
      }
    }
  }

  if (!content.trim()) {
    throw new ForgeUnavailable(`${a.provider}/${a.model} streamed no content`, 'bad-response');
  }
  return { text: content.trim(), reasoning, usage };
}

/* ── Hedged runner ─────────────────────────────────────────────────────── */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

const REASON_PRIORITY: Reason[] = [
  'bad-request', 'auth', 'rate-limit', 'bad-response', 'timeout', 'network',
];

/**
 * Runs a lane's plan with staggered starts and returns the first success.
 *
 * Every attempt gets its own AbortController so a winner can cancel the losers
 * — without that, abandoned requests keep burning quota in the background, and
 * on a 50-a-day allowance that matters.
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  // `opts.lane` is trusted: it is chosen by this codebase, never taken off the
  // wire. The untrusted-input narrowing happens in the HTTP handler, which
  // calls `resolveLane` before it ever reaches here. Doing that narrowing here
  // instead is what silently ran the `guard` lane on the balanced ladder.
  const lane = opts.lane === undefined
    ? LANES.balanced
    : typeof opts.lane === 'string'
      ? (isLaneId(opts.lane) ? LANES[opts.lane] : LANES.balanced)
      : opts.lane;
  const db = opts.db ?? NULL_DB;

  const plan = await planAttempts(lane, db);
  if (plan.length === 0) {
    throw new ForgeUnavailable('No providers configured', 'no-key');
  }

  const maxTokens = opts.maxTokens ?? lane.maxTokens;
  const temperature = opts.temperature ?? lane.temperature;
  const stream = opts.stream ?? false;
  const requestId = opts.requestId ?? crypto.randomUUID();

  const controllers: AbortController[] = [];
  let settled = false;
  const errors: ForgeUnavailable[] = [];

  const abortAll = () => {
    for (const c of controllers) {
      try { c.abort(); } catch { /* already done */ }
    }
  };
  opts.signal?.addEventListener('abort', abortAll, { once: true });

  const overall = setTimeout(abortAll, opts.totalTimeoutMs ?? lane.timeoutMs * 2);

  const record = (
    provider: ProviderId, model: string, index: number, startedAt: number,
    ok: boolean, reason?: string,
    usage?: { prompt_tokens?: number; completion_tokens?: number },
  ) => {
    breaker.recordOutcome(db, provider, model, ok, reason, Date.now() - startedAt);
    void db.recordUsage({
      requestId,
      userId: opts.userId ?? null,
      surface: opts.surface ?? 'unknown',
      lane: lane.id,
      provider,
      model,
      promptTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
      ok,
      reason,
      attemptIndex: index,
    }).catch(() => { /* advisory */ });
  };

  const attempt = async (rung: Rung, index: number) => {
    // Stagger: attempt N starts N x hedgeMs after the first, unless we've won.
    if (index > 0) {
      try {
        await sleep(index * lane.hedgeMs, opts.signal);
      } catch {
        return null;
      }
      if (settled) return null;
    }

    const [provider, model] = rung;
    const controller = new AbortController();
    controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), lane.timeoutMs);
    opts.onAttempt?.({ provider, model, index });
    budget.charge(db, provider);
    const startedAt = Date.now();

    try {
      const out = await callOnce({
        provider,
        model,
        messages: opts.messages,
        maxTokens,
        temperature,
        wantThinking: Boolean(lane.showsThinking),
        reasoningEffort: lane.reasoningEffort,
        stream,
        signal: controller.signal,
        // Only the eventual winner should paint; losers stay silent.
        onToken: (d, f) => { if (!settled) opts.onToken?.(d, f); },
        onThinking: (d, f) => { if (!settled) opts.onThinking?.(d, f); },
      });
      record(provider, model, index, startedAt, true, undefined, out.usage);
      return { ...out, provider, model, attemptIndex: index };
    } catch (err) {
      const e = err as { name?: string; message?: string; reason?: Reason };
      const reason: Reason = e?.name === 'AbortError' ? 'timeout' : (e?.reason ?? 'network');
      // A hedge cancelled by a winner is not a failure, and recording it would
      // badly skew any reliability figure read off this table.
      if (!(e?.name === 'AbortError' && settled)) {
        record(provider, model, index, startedAt, false, reason);
      }
      errors.push(new ForgeUnavailable(`${provider}/${model}: ${e?.message ?? 'failed'}`, reason));
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const runners = plan.map((rung, i) =>
      attempt(rung, i).then((res) => {
        if (res && !settled) {
          settled = true;
          return res;
        }
        return null;
      }),
    );

    const winner = await new Promise<Awaited<ReturnType<typeof attempt>>>((resolve) => {
      let outstanding = runners.length;
      for (const r of runners) {
        void r.then((res) => {
          if (res) resolve(res);
          else if (--outstanding === 0) resolve(null);
        });
      }
    });

    if (winner) {
      abortAll();
      return {
        text: winner.text,
        reasoning: winner.reasoning,
        provider: winner.provider,
        model: winner.model,
        usage: winner.usage,
        attemptIndex: winner.attemptIndex,
      };
    }

    // Everything failed — surface the most actionable reason. `bad-request`
    // outranks everything: it is the only reason here that is a bug in this
    // app rather than a condition at a provider, so it must never be masked
    // by a slower attempt's timeout.
    const best = REASON_PRIORITY.find((r) => errors.some((e) => e.reason === r)) ?? 'network';
    throw new ForgeUnavailable(
      errors.map((e) => e.message).join(' | ').slice(0, 300) || 'All providers failed',
      best,
    );
  } finally {
    clearTimeout(overall);
    opts.signal?.removeEventListener?.('abort', abortAll);
  }
}

/** Convenience wrapper returning just the text. */
export async function chat(
  messages: Message[],
  opts: Omit<CompleteOptions, 'messages'> = {},
): Promise<string> {
  const { text } = await complete({ messages, ...opts });
  return text;
}

export { LANES };
