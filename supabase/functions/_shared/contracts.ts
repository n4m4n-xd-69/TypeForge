/**
 * The quality gate.
 *
 * A generation that fails validation still streams to the person who asked for
 * it — they get an answer rather than an error — but it is never written to the
 * shared library. The asymmetry is the point: one user tolerating a slightly
 * odd paragraph is a small cost, and every future user being served that same
 * paragraph forever is not.
 *
 * The rules are the ones `src/lib/ai.js` already applies client-side, moved
 * here so the library and the client cannot drift apart on what "valid" means.
 */
import { normaliseBody } from './facets.ts';

export interface Valid<T> { ok: true; value: T }
export interface Invalid { ok: false; reason: string }
export type Checked<T> = Valid<T> | Invalid;

const bad = (reason: string): Invalid => ({ ok: false, reason });

/**
 * Pulls a JSON object out of a reply that may be wrapped in prose or a fence.
 *
 * Models are asked for "a single JSON object and nothing else" and mostly
 * comply, but "mostly" across four providers is not a contract.
 */
export function extractJSON(text: string): Record<string, unknown> | null {
  const trimmed = String(text ?? '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export interface PassageValue {
  body: string;
  title: string | null;
  meta: Record<string, unknown>;
  wordCount: number;
}

const MIN_WORDS = 8;
const MAX_WORDS = 400;

/**
 * Practice prose.
 *
 * The "no markdown, no newlines" rules are not stylistic — the typing engine
 * renders a passage as one continuous run of characters, and a stray `**` or
 * line break becomes something the user has to type and gets marked wrong on.
 */
export function checkPassage(raw: string): Checked<PassageValue> {
  const parsed = extractJSON(raw);
  if (!parsed) return bad('no JSON object in reply');

  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (!text.trim()) return bad('no text field');

  const body = normaliseBody(text).replace(/\n+/g, ' ').trim();

  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) return bad(`too short (${words} words)`);
  if (words > MAX_WORDS) return bad(`too long (${words} words)`);

  if (/[*_#`|]|\[[^\]]*\]\(/.test(body)) return bad('contains markdown');
  // Anything outside a standard keyboard is something the user cannot type.
  if (/[^\x20-\x7E]/.test(body)) return bad('contains non-keyboard characters');

  const label = typeof parsed.label === 'string' ? parsed.label.trim() : '';
  const author = typeof parsed.author === 'string' ? parsed.author.trim() : '';

  return {
    ok: true,
    value: {
      body,
      title: label || null,
      meta: author ? { author } : {},
      wordCount: words,
    },
  };
}

export interface SnippetValue {
  body: string;
  title: string | null;
  meta: Record<string, unknown>;
  wordCount: number;
}

const MAX_SNIPPET_LINES = 24;
const MAX_LINE_LENGTH = 96;

/**
 * Code to be typed.
 *
 * Tabs become two spaces because a tab is one keystroke that renders as an
 * indeterminate number of columns, and the typing engine compares by character.
 * Long lines are rejected rather than wrapped: wrapping would change the code.
 */
export function checkSnippet(raw: string): Checked<SnippetValue> {
  const parsed = extractJSON(raw);
  if (!parsed) return bad('no JSON object in reply');

  const code = typeof parsed.code === 'string' ? parsed.code : '';
  if (!code.trim()) return bad('no code field');

  const body = code
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[ \t]+$/gm, '')
    .trim();

  const lines = body.split('\n');
  if (lines.length < 3) return bad(`too short (${lines.length} lines)`);
  if (lines.length > MAX_SNIPPET_LINES) return bad(`too long (${lines.length} lines)`);
  if (lines.some((l) => l.length > MAX_LINE_LENGTH)) return bad('line too long');
  if (/[^\x20-\x7E\n]/.test(body)) return bad('contains non-keyboard characters');

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const intro = typeof parsed.intro === 'string' ? parsed.intro.trim() : '';
  const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : '';

  return {
    ok: true,
    value: {
      body,
      title: title || null,
      meta: { ...(intro ? { intro } : {}), ...(topic ? { topic } : {}) },
      wordCount: lines.length,
    },
  };
}

export function checkByKind(kind: string, raw: string): Checked<PassageValue | SnippetValue> {
  return kind === 'snippet' ? checkSnippet(raw) : checkPassage(raw);
}
