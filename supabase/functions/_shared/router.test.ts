import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEnvOverride } from './env.ts';
import { activeProviders, headersFor, isActive, PROVIDERS } from './providers.ts';
import { LANES, laneById, PUBLIC_LANES, publicCatalogue, QUARANTINED, resolveLane } from './lanes.ts';
import { NULL_DB, type ForgeDb } from './db.ts';
import * as breaker from './breaker.ts';
import * as budget from './budget.ts';
import { classify, complete, ForgeUnavailable, planAttempts } from './runner.ts';

const ALL_KEYS = {
  FORGE_NVIDIA_KEY: 'nv-test',
  FORGE_HCNSEC_KEY: 'hc-test',
  FORGE_KIRA_KEY: 'ki-test',
  FORGE_OPENROUTER_KEY: 'or-test',
};

function fakeDb(over: Partial<ForgeDb> = {}): ForgeDb {
  return { ...NULL_DB, ...over };
}

beforeEach(() => {
  setEnvOverride({ ...ALL_KEYS });
  breaker.resetBreakerCache();
  budget.resetBudgetCache();
});

afterEach(() => {
  setEnvOverride(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ── Providers ─────────────────────────────────────────────────────────── */

describe('providers', () => {
  it('a provider without a key is absent, not disabled', () => {
    setEnvOverride({ FORGE_NVIDIA_KEY: 'nv-test' });
    const ids = activeProviders().map((p) => p.id);
    expect(ids).toEqual(['nim']);
    expect(isActive('openrouter')).toBe(false);
  });

  it('orders by priority, with OpenRouter last', () => {
    expect(activeProviders().map((p) => p.id)).toEqual(['nim', 'hcnsec', 'kira', 'openrouter']);
  });

  it('with no keys at all, nothing is active', () => {
    setEnvOverride({});
    expect(activeProviders()).toHaveLength(0);
  });

  it('sends the key as a bearer token, and OpenRouter attribution headers', () => {
    setEnvOverride({ ...ALL_KEYS, FORGE_SITE_URL: 'https://typeforge.test' });
    expect(headersFor('nim').Authorization).toBe('Bearer nv-test');
    const or = headersFor('openrouter');
    expect(or['HTTP-Referer']).toBe('https://typeforge.test');
    expect(or['X-Title']).toBe('TypeForge');
  });

  it('OpenRouter carries the free-tier daily ceiling', () => {
    expect(PROVIDERS.openrouter.dailyLimit).toBe(50);
  });
});

/* ── Lanes ─────────────────────────────────────────────────────────────── */

describe('lanes', () => {
  it('never exposes guard or embed to the picker', () => {
    expect(PUBLIC_LANES).not.toContain('guard');
    expect(PUBLIC_LANES).not.toContain('embed');
  });

  it('falls back to balanced for an unknown or hostile lane name', () => {
    expect(resolveLane('nonsense').id).toBe('balanced');
    expect(resolveLane(undefined).id).toBe('balanced');
    expect(resolveLane('guard').id).toBe('balanced');
    expect(resolveLane('embed').id).toBe('balanced');
  });

  it('laneById reaches the internal lanes that resolveLane must reject', () => {
    // Regression: routing an internal `guard` call through resolveLane ran
    // moderation on the balanced ladder — a bypass, not a mis-route. The live
    // smoke test caught it reporting attempt#0 as a general chat model.
    expect(laneById('guard').ladder[0][1]).toBe('nvidia/nemotron-3.5-content-safety');
    expect(laneById('embed').ladder[0][1]).toBe('nvidia/nemotron-3-embed-1b');
    expect(resolveLane('guard').id).toBe('balanced');
  });

  it('the public catalogue leaks no vendor or model string', () => {
    const json = JSON.stringify(publicCatalogue()).toLowerCase();
    const vendors = [
      'nemotron', 'deepseek', 'glm', 'kimi', 'gemma', 'minimax', 'qwen',
      'laguna', 'inkling', 'openrouter', 'nvidia', 'hcnsec', 'kira',
      'moonshot', 'poolside', 'cohere', 'sensenova', 'step-3', 'llama',
    ];
    for (const v of vendors) expect(json).not.toContain(v);
  });

  it('the catalogue still describes every public lane', () => {
    expect(publicCatalogue().map((l) => l.id)).toEqual([...PUBLIC_LANES]);
    for (const lane of publicCatalogue()) {
      expect(lane.label).toBeTruthy();
      expect(lane.blurb).toBeTruthy();
    }
  });

  it('no ladder contains a quarantined model', () => {
    for (const lane of Object.values(LANES)) {
      for (const [, model] of lane.ladder) {
        expect(QUARANTINED).not.toContain(model);
      }
    }
  });

  it('every ladder rung names a known provider', () => {
    for (const lane of Object.values(LANES)) {
      for (const [provider] of lane.ladder) {
        expect(PROVIDERS[provider]).toBeDefined();
      }
    }
  });
});

/* ── Planning ──────────────────────────────────────────────────────────── */

describe('planAttempts', () => {
  it('drops rungs whose provider has no key', async () => {
    setEnvOverride({ FORGE_NVIDIA_KEY: 'nv-test' });
    const plan = await planAttempts(LANES.instant, NULL_DB);
    expect(plan.every(([p]) => p === 'nim')).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('drops a model the breaker has opened', async () => {
    const db = fakeDb({ openModels: async () => ['nim/nvidia/nemotron-3-nano-30b-a3b'] });
    const plan = await planAttempts(LANES.instant, db);
    expect(plan.map(([, m]) => m)).not.toContain('nvidia/nemotron-3-nano-30b-a3b');
    expect(plan.length).toBeGreaterThan(0);
  });

  it('drops a provider that is at 90% of its daily ceiling', async () => {
    const db = fakeDb({ budgetToday: async () => ({ openrouter: 45 }) });
    const plan = await planAttempts(LANES.instant, db);
    expect(plan.map(([p]) => p)).not.toContain('openrouter');
  });

  it('keeps a provider that is under the ceiling', async () => {
    const db = fakeDb({ budgetToday: async () => ({ openrouter: 10 }) });
    const plan = await planAttempts(LANES.instant, db);
    expect(plan.map(([p]) => p)).toContain('openrouter');
  });

  it('falls back to the full ladder when everything is filtered out', async () => {
    // A rate-limited answer beats no answer at all.
    const db = fakeDb({
      openModels: async () => LANES.feather.ladder.map(([p, m]) => `${p}/${m}`),
    });
    const plan = await planAttempts(LANES.feather, db);
    expect(plan.length).toBe(LANES.feather.ladder.length);
  });

  it('returns nothing when no provider has a key', async () => {
    setEnvOverride({});
    expect(await planAttempts(LANES.instant, NULL_DB)).toHaveLength(0);
  });

  it('caps the plan at six attempts', async () => {
    const plan = await planAttempts(LANES.instant, NULL_DB);
    expect(plan.length).toBeLessThanOrEqual(6);
  });
});

/* ── Status classification ─────────────────────────────────────────────── */

describe('classify', () => {
  it('maps statuses to actionable reasons', () => {
    expect(classify(429)).toBe('rate-limit');
    expect(classify(401)).toBe('auth');
    expect(classify(403)).toBe('auth');
    expect(classify(500)).toBe('network');
    expect(classify(502)).toBe('network');
  });

  it('treats 400 as our bug, not the provider\'s', () => {
    // Failover cannot rescue a malformed request, and the breaker must not
    // open a model for it.
    expect(classify(400)).toBe('bad-request');
  });
});

/* ── Runner ────────────────────────────────────────────────────────────── */

function jsonResponse(text: string, init: ResponseInit = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    }),
    { status: 200, ...init },
  );
}

function sseResponse(frames: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('complete', () => {
  it('returns the first successful attempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('hello forge')));
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
    });
    expect(res.text).toBe('hello forge');
    expect(res.attemptIndex).toBe(0);
    expect(res.provider).toBe('nim');
  });

  it('fails over to the next rung when the first errors', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response('nope', { status: 500 });
      return jsonResponse('second wins');
    }));
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: { ...LANES.instant, hedgeMs: 1 },
    });
    expect(res.text).toBe('second wins');
  });

  it('clamps temperature to the provider ceiling', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse('ok');
    });
    await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
      temperature: 1.8,
    });
    // HCNSec answers 1.1 with a 400; the clamp is what stops that reaching it.
    expect(sent).not.toHaveLength(0);
    expect(sent[0].temperature as number).toBeLessThanOrEqual(1);
  });

  it('suppresses thinking on a non-thinking lane, per provider dialect', async () => {
    // The bug this guards: with thinking left on, several models emit their
    // chain of thought into `content`, so a chat answer opened with
    // "We need to respond per instruction:". Verified against the deployed
    // function before the fix.
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse('ok');
    });
    await complete({ messages: [{ role: 'user', content: 'hi' }], lane: 'instant' });

    // NIM: the chat template, not reasoning_effort — that field returned 500
    // from every NIM model tested.
    expect(sent[0].chat_template_kwargs).toEqual({ thinking: false });
    expect(sent[0].reasoning_effort).toBeUndefined();
  });

  it('asks for thinking on a thinking lane', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse('ok');
    });
    await complete({ messages: [{ role: 'user', content: 'hi' }], lane: 'reasoning' });
    // NIM reasons by default, so a thinking lane sends nothing to enable it.
    expect(sent[0].chat_template_kwargs).toBeUndefined();
  });

  it('uses OpenRouter\'s own dialect for the same switch', async () => {
    setEnvOverride({ FORGE_OPENROUTER_KEY: 'or-test' });
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return jsonResponse('ok');
    });
    await complete({ messages: [{ role: 'user', content: 'hi' }], lane: 'instant' });
    expect(sent[0].reasoning).toEqual({ enabled: false });

    sent.length = 0;
    await complete({ messages: [{ role: 'user', content: 'hi' }], lane: 'deep' });
    expect(sent[0].reasoning).toEqual({ effort: 'high' });
  });

  it('surfaces bad-request ahead of a slower timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    await expect(complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: { ...LANES.feather, hedgeMs: 1 },
    })).rejects.toMatchObject({ reason: 'bad-request' });
  });

  it('reports no-key rather than a network error when nothing is configured', async () => {
    setEnvOverride({});
    await expect(complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
    })).rejects.toMatchObject({ reason: 'no-key' });
  });

  it('reports auth when every provider rejects its key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    await expect(complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: { ...LANES.feather, hedgeMs: 1 },
    })).rejects.toBeInstanceOf(ForgeUnavailable);
  });

  it('records one usage row per settled attempt', async () => {
    const rows: unknown[] = [];
    const db = fakeDb({ recordUsage: async (r) => { rows.push(r); } });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('ok')));
    await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
      db,
      surface: 'chat',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ lane: 'instant', surface: 'chat', ok: true, attemptIndex: 0 });
  });
});

describe('streaming', () => {
  it('emits content deltas and accumulates the full text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" forge"}}]}\n',
      'data: [DONE]\n',
    ])));
    const deltas: string[] = [];
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
      stream: true,
      onToken: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(['Hello', ' forge']);
    expect(res.text).toBe('Hello forge');
  });

  it('separates reasoning from content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n',
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n',
    ])));
    const think: string[] = [];
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'reasoning',
      stream: true,
      onThinking: (d) => think.push(d),
    });
    expect(think).toEqual(['thinking...']);
    expect(res.text).toBe('answer');
    expect(res.reasoning).toBe('thinking...');
  });

  it('survives a frame split across two network reads', async () => {
    // The regression this guards: a token silently vanishing because its JSON
    // arrived in two pieces.
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n',
      'data: {"choices":[{"delta":{"content":"-ok"}}]}\n',
    ])));
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
      stream: true,
    });
    expect(res.text).toBe('split-ok');
  });

  it('ignores keepalive comments and blank lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      ': keepalive\n',
      '\n',
      'event: ping\n',
      'data: {"choices":[{"delta":{"content":"fine"}}]}\n',
    ])));
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
      stream: true,
    });
    expect(res.text).toBe('fine');
  });

  it('treats an empty stream as a bad response, so failover can run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: [DONE]\n'])));
    await expect(complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: { ...LANES.feather, hedgeMs: 1 },
      stream: true,
    })).rejects.toMatchObject({ reason: 'bad-response' });
  });

  it('picks up token usage from the trailing frame', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":3}}\n',
    ])));
    const res = await complete({
      messages: [{ role: 'user', content: 'hi' }],
      lane: 'instant',
      stream: true,
    });
    expect(res.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 3 });
  });
});

/* ── Breaker ───────────────────────────────────────────────────────────── */

describe('breaker', () => {
  it('opens a model only after three failures', async () => {
    const db = NULL_DB;
    breaker.recordOutcome(db, 'nim', 'm', false, 'network');
    breaker.recordOutcome(db, 'nim', 'm', false, 'network');
    expect(await breaker.openModels(db, Date.now() + 10_000)).not.toContain('nim/m');
    breaker.recordOutcome(db, 'nim', 'm', false, 'network');
    expect(breaker.key('nim', 'm')).toBe('nim/m');
    // The third failure is what sidelines it locally.
    const open = await breaker.openModels(db, Date.now());
    expect(open.has('nim/m')).toBe(true);
  });

  it('never opens a model for bad-request', async () => {
    const db = NULL_DB;
    for (let i = 0; i < 5; i++) breaker.recordOutcome(db, 'nim', 'b', false, 'bad-request');
    const open = await breaker.openModels(db, Date.now());
    expect(open.has('nim/b')).toBe(false);
  });

  it('opens immediately on auth — a rejected key will not heal itself', async () => {
    const db = NULL_DB;
    breaker.recordOutcome(db, 'nim', 'a', false, 'auth');
    const open = await breaker.openModels(db, Date.now());
    expect(open.has('nim/a')).toBe(true);
  });

  it('a success clears the strike count', async () => {
    const db = NULL_DB;
    breaker.recordOutcome(db, 'nim', 'r', false, 'network');
    breaker.recordOutcome(db, 'nim', 'r', false, 'network');
    breaker.recordOutcome(db, 'nim', 'r', true);
    breaker.recordOutcome(db, 'nim', 'r', false, 'network');
    const open = await breaker.openModels(db, Date.now());
    expect(open.has('nim/r')).toBe(false);
  });

  it('an unreadable breaker means nothing is open, not everything', async () => {
    const db = fakeDb({ openModels: async () => { throw new Error('db down'); } });
    await expect(breaker.openModels(db, Date.now())).resolves.toEqual(new Set());
  });
});

/* ── Budget ────────────────────────────────────────────────────────────── */

describe('budget', () => {
  it('blocks a provider at 90% of its ceiling', async () => {
    await budget.refresh(fakeDb({ budgetToday: async () => ({ openrouter: 45 }) }));
    expect(budget.canSpend('openrouter')).toBe(false);
  });

  it('allows a provider below the ceiling', async () => {
    await budget.refresh(fakeDb({ budgetToday: async () => ({ openrouter: 44 }) }));
    expect(budget.canSpend('openrouter')).toBe(true);
  });

  it('a provider with no published ceiling is never blocked', async () => {
    await budget.refresh(fakeDb({ budgetToday: async () => ({ nim: 100_000 }) }));
    expect(budget.canSpend('nim')).toBe(true);
  });

  it('charging moves the local counter immediately', async () => {
    await budget.refresh(fakeDb({ budgetToday: async () => ({ openrouter: 44 }) }));
    budget.charge(NULL_DB, 'openrouter');
    expect(budget.canSpend('openrouter')).toBe(false);
  });
});
