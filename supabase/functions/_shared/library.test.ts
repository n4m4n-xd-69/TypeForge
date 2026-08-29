import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEnvOverride } from './env.ts';
import {
  contentHash, facetSummary, levelBand, normaliseBody, normaliseFacets, requestHash,
} from './facets.ts';
import { checkPassage, checkSnippet, extractJSON } from './contracts.ts';
import { generate, learn, resetOrchestratorCache } from './orchestrator.ts';
import { NULL_DB, type ForgeDb, type LibraryRow } from './db.ts';
import * as breaker from './breaker.ts';
import * as budget from './budget.ts';

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'gen-1', title: 'T', body: 'A calm paragraph about focus and practice.',
  meta: {}, topic: 'focus', serveCount: 0, ...over,
});

function fakeDb(over: Partial<ForgeDb> = {}): ForgeDb {
  return { ...NULL_DB, ...over };
}

beforeEach(() => {
  setEnvOverride({ FORGE_NVIDIA_KEY: 'nv-test' });
  breaker.resetBreakerCache();
  budget.resetBudgetCache();
  resetOrchestratorCache();
});

afterEach(() => {
  setEnvOverride(null);
  vi.restoreAllMocks();
});

/* ── Facets ────────────────────────────────────────────────────────────── */

describe('facets', () => {
  it('bands levels so neighbours share a bucket', () => {
    // Level 7 and 8 want the same text; 100 buckets where 34 will do would
    // take three times as long to fill to the point where reuse pays.
    expect(levelBand(7)).toBe(levelBand(8));
    expect(levelBand(0)).toBe(0);
    expect(levelBand(99)).toBe(99);
    expect(levelBand(-5)).toBe(0);
    expect(levelBand(1000)).toBe(99);
    expect(levelBand(NaN)).toBe(0);
  });

  it('normalises case and whitespace so buckets do not fragment', () => {
    const a = normaliseFacets({ kind: 'snippet', language: ' Rust ', topic: 'Closures' });
    const b = normaliseFacets({ kind: 'snippet', language: 'rust', topic: 'closures' });
    expect(a).toEqual(b);
  });

  it('falls back rather than trusting hostile input', () => {
    const f = normaliseFacets({ kind: 'evil', difficulty: 'impossible', level: 'abc' });
    expect(f.kind).toBe('passage');
    expect(f.difficulty).toBe('normal');
    expect(f.level).toBe(0);
  });

  it('treats a missing language as null, not the empty string', () => {
    expect(normaliseFacets({ language: '  ' }).language).toBeNull();
  });

  it('gives equal facets the same request hash, and different ones a different hash', async () => {
    const base = normaliseFacets({ kind: 'passage', difficulty: 'hard', topic: 'focus' });
    const same = normaliseFacets({ kind: 'PASSAGE', difficulty: 'Hard', topic: ' Focus ' });
    const other = normaliseFacets({ kind: 'passage', difficulty: 'easy', topic: 'focus' });

    expect(await requestHash(base)).toBe(await requestHash(same));
    expect(await requestHash(base)).not.toBe(await requestHash(other));
  });

  it('changes every request hash when the prompt version moves', async () => {
    const f = normaliseFacets({ kind: 'passage' });
    expect(await requestHash(f, 'v1')).not.toBe(await requestHash(f, 'v2'));
  });

  it('hashes bodies that differ only in whitespace or quotes identically', async () => {
    expect(await contentHash('The  keys   do not move.'))
      .toBe(await contentHash('The keys do not move.'));
    expect(await contentHash('“quoted”')).toBe(await contentHash('"quoted"'));
  });

  it('normaliseBody leaves real content alone', () => {
    expect(normaliseBody('  Type well.  ')).toBe('Type well.');
  });

  it('facetSummary is stable and human-readable', () => {
    const s = facetSummary(normaliseFacets({ kind: 'snippet', language: 'rust', level: 12 }));
    expect(s).toContain('snippet');
    expect(s).toContain('rust');
  });
});

/* ── Contracts ─────────────────────────────────────────────────────────── */

describe('extractJSON', () => {
  it('reads a bare object', () => {
    expect(extractJSON('{"text":"hi"}')).toEqual({ text: 'hi' });
  });
  it('reads an object wrapped in a fence', () => {
    expect(extractJSON('```json\n{"text":"hi"}\n```')).toEqual({ text: 'hi' });
  });
  it('reads an object surrounded by prose', () => {
    expect(extractJSON('Sure! {"text":"hi"} hope that helps')).toEqual({ text: 'hi' });
  });
  it('returns null for junk', () => {
    expect(extractJSON('no json here')).toBeNull();
    expect(extractJSON('{broken')).toBeNull();
  });
});

describe('checkPassage', () => {
  const good = JSON.stringify({
    text: 'The keys do not move. Your fingers learn where they already are, one repetition at a time.',
    label: 'On practice',
  });

  it('accepts clean prose and counts its words', () => {
    const r = checkPassage(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.wordCount).toBeGreaterThan(8);
      expect(r.value.title).toBe('On practice');
    }
  });

  it('rejects markdown, which the typing engine would make the user type', () => {
    const r = checkPassage(JSON.stringify({ text: 'Type **well** and often, every single day please.' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('markdown');
  });

  it('rejects characters that are not on a keyboard', () => {
    const r = checkPassage(JSON.stringify({ text: 'Practice makes perfect — every day, always, forever ✨' }));
    expect(r.ok).toBe(false);
  });

  it('flattens newlines rather than rejecting them', () => {
    const r = checkPassage(JSON.stringify({ text: 'One line here.\nAnother line there, with more words.' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.body).not.toContain('\n');
  });

  it('rejects too short and too long', () => {
    expect(checkPassage(JSON.stringify({ text: 'Too short.' })).ok).toBe(false);
    expect(checkPassage(JSON.stringify({ text: 'word '.repeat(500) })).ok).toBe(false);
  });

  it('rejects a reply with no JSON at all', () => {
    expect(checkPassage('I am happy to help!').ok).toBe(false);
  });
});

describe('checkSnippet', () => {
  const code = 'function add(a, b) {\n  return a + b;\n}\n';

  it('accepts a small snippet', () => {
    const r = checkSnippet(JSON.stringify({ code, title: 'Add' }));
    expect(r.ok).toBe(true);
  });

  it('converts tabs to spaces', () => {
    // A tab is one keystroke rendered as an indeterminate number of columns,
    // and the engine compares by character.
    const r = checkSnippet(JSON.stringify({ code: 'if (x) {\n\treturn 1;\n}' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.body).not.toContain('\t');
      expect(r.value.body).toContain('  return 1;');
    }
  });

  it('rejects an over-long line rather than wrapping it', () => {
    const long = `const x = "${'a'.repeat(120)}";`;
    const r = checkSnippet(JSON.stringify({ code: `a();\n${long}\nb();` }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('line too long');
  });

  it('rejects a snippet with no code field', () => {
    expect(checkSnippet(JSON.stringify({ title: 'nope' })).ok).toBe(false);
  });
});

/* ── Orchestrator ──────────────────────────────────────────────────────── */

describe('generate', () => {
  const base = {
    facets: { kind: 'passage', difficulty: 'normal', topic: 'focus' },
    messages: [{ role: 'user' as const, content: 'write a passage' }],
    lane: 'instant' as const,
    userId: 'user-1',
    requestId: 'req-1',
    surface: 'practice',
  };

  it('serves an exact hit without calling a provider at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = fakeDb({ lookupExact: async () => [row()] });

    const res = await generate({ ...base, db });

    expect(res.cache).toBe('exact');
    expect(res.replay).toBe(true);
    expect(res.generationId).toBe('gen-1');
    // The whole point: zero provider traffic on a hit.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports the outcome before any body is emitted', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const seen: string[] = [];
    await generate({
      ...base,
      db: fakeDb({ lookupExact: async () => [row()] }),
      onOutcome: (o) => seen.push(o),
    });
    expect(seen).toEqual(['exact']);
  });

  it('generates on a miss and streams deltas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"fresh text"}}]}\n',
      { status: 200 },
    )));
    const deltas: string[] = [];
    const res = await generate({
      ...base,
      db: fakeDb(),
      onToken: (d) => deltas.push(d),
    });
    expect(res.cache).toBe('miss');
    expect(res.replay).toBe(false);
    expect(deltas.join('')).toBe('fresh text');
  });

  it('does not let a failing lookup take the request down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"still works"}}]}\n',
      { status: 200 },
    )));
    const db = fakeDb({ lookupExact: async () => { throw new Error('db down'); } });
    const res = await generate({ ...base, db });
    expect(res.cache).toBe('miss');
    expect(res.body).toBe('still works');
  });
});

describe('learn', () => {
  it('saves a valid passage and queues it for embedding', async () => {
    const saved: unknown[] = [];
    const queued: string[] = [];
    const db = fakeDb({
      saveGeneration: async (r) => { saved.push(r); return 'new-id'; },
      enqueueEmbed: async (id) => { queued.push(id); },
    });

    const out = await learn({
      db,
      facets: { kind: 'passage', difficulty: 'normal' },
      raw: JSON.stringify({ text: 'A calm paragraph about focus, practice and the quiet work of repetition.' }),
      userId: 'user-1',
    });

    expect(out.saved).toBe(true);
    expect(saved).toHaveLength(1);
    expect(queued).toEqual(['new-id']);
  });

  it('refuses to store a generation that fails the quality gate', async () => {
    const saved: unknown[] = [];
    const db = fakeDb({ saveGeneration: async (r) => { saved.push(r); return 'x'; } });

    const out = await learn({
      db,
      facets: { kind: 'passage' },
      // Long enough to clear the word-count check, so this exercises the
      // markdown rule rather than tripping on length first.
      raw: JSON.stringify({
        text: 'Type **well** and often, every single day, because the hands learn '
          + 'what the eyes stop needing to check.',
      }),
      userId: 'user-1',
    });

    // The user still got their answer; the library did not get the markdown.
    expect(out.saved).toBe(false);
    expect(out.reason).toContain('markdown');
    expect(saved).toHaveLength(0);
  });

  it('never throws, whatever the database does', async () => {
    const db = fakeDb({ saveGeneration: async () => { throw new Error('boom'); } });
    const out = await learn({
      db,
      facets: { kind: 'passage' },
      raw: JSON.stringify({ text: 'A perfectly reasonable paragraph about practice and patience.' }),
      userId: 'u',
    });
    expect(out.saved).toBe(false);
  });
});
