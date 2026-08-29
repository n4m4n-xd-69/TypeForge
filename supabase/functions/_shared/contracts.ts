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
  if (start === -1) return null;

  const end = candidate.lastIndexOf('}');
  if (end > start) {
    const parsed = tryParse(candidate.slice(start, end + 1));
    if (parsed) return parsed;
  }

  // Nothing parsed cleanly. The usual cause is a reply cut off at the token
  // ceiling mid-object, which leaves a structurally valid prefix and no
  // closing braces — common on the analysis shape, which is large. Repairing
  // it recovers every complete field instead of discarding the whole answer.
  return repairTruncated(candidate.slice(start));
}

function tryParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Closes a JSON object that stops mid-stream.
 *
 * Walks the text tracking string state and nesting depth, cuts back to the
 * last point where a value was complete, and appends the closers the parser
 * needs. A truncated reply is a partial answer, not a wrong one — throwing it
 * away turns "the model ran long" into "Forge could not parse the reply",
 * which is the error the user actually sees.
 */
function repairTruncated(raw: string): Record<string, unknown> | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;

  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
    // A comma or a closer at depth means everything before it is a whole
    // key/value pair, so this is a safe place to cut.
    else if (c === ',') lastSafe = i;
    if ((c === '}' || c === ']') && !inString) lastSafe = i;
  }

  if (lastSafe === -1) return null;

  let head = raw.slice(0, lastSafe + 1).replace(/,\s*$/, '');

  // Recompute what is still open at the cut, then close it.
  const closers: string[] = [];
  let s2 = false;
  let e2 = false;
  for (let i = 0; i < head.length; i += 1) {
    const c = head[i];
    if (s2) {
      if (e2) e2 = false;
      else if (c === '\\') e2 = true;
      else if (c === '"') s2 = false;
      continue;
    }
    if (c === '"') s2 = true;
    else if (c === '{') closers.push('}');
    else if (c === '[') closers.push(']');
    else if (c === '}' || c === ']') closers.pop();
  }
  if (s2) head += '"';

  return tryParse(head + closers.reverse().join(''));
}

/**
 * True when a value is the prompt's own example rather than an answer.
 *
 * Smaller models copy the shape they are shown. The prompts now use filled
 * illustrations instead of annotations, which removes most of it, but a
 * provider that ignores the instruction should not be able to put a schema
 * fragment on a typing surface.
 */
function isEchoedPlaceholder(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (!t) return true;
  return (
    /^\.\.\.$/.test(t)
    || /^(the )?(passage|snippet|text|code|title|topic|intro|label)( itself)?$/.test(t)
    || /^\d+[-–]\d+ words?\b/.test(t)
    || /^(short|one) (title|sentence)\b/.test(t)
    || /\bword description\b/.test(t)
    || /^(your|a) (own|short) /.test(t)
  );
}

/**
 * Best-effort body for a reply that failed the quality gate.
 *
 * A failed check used to send no body at all, and the client falls back to the
 * raw stream when the parsed body is missing — so a generation that was merely
 * *imperfect* reached the typing surface as a JSON envelope. Extracting the
 * field anyway means the worst case is slightly odd prose rather than
 * punctuation nobody can type.
 *
 * Returns null only when there is genuinely nothing to salvage.
 */
export function salvageBody(kind: string, raw: string): string | null {
  const parsed = extractJSON(raw);
  const field = kind === 'snippet' ? 'code' : 'text';
  const value = parsed && typeof parsed[field] === 'string' ? parsed[field] as string : '';
  if (value.trim()) {
    return kind === 'snippet' ? value.trim() : value.replace(/\s+/g, ' ').trim();
  }
  // No envelope: the model answered in prose, which is usable as-is.
  const bare = String(raw ?? '').trim();
  if (bare && !bare.startsWith('{') && !bare.startsWith('[')) {
    return kind === 'snippet' ? bare : bare.replace(/\s+/g, ' ').trim();
  }
  return null;
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

  // A model that wraps its answer twice puts the whole envelope in `text`, and
  // the typing surface would then ask somebody to type a JSON object.
  if (/^\s*[{[]/.test(text) && /["}\]]\s*$/.test(text.trim())) {
    return bad('text is a JSON envelope');
  }
  if (isEchoedPlaceholder(text)) return bad('text is the prompt placeholder');

  const body = normaliseBody(text).replace(/\n+/g, ' ').trim();

  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) return bad(`too short (${words} words)`);
  if (words > MAX_WORDS) return bad(`too long (${words} words)`);

  if (/[*_#`|]|\[[^\]]*\]\(/.test(body)) return bad('contains markdown');
  // Anything outside a standard keyboard is something the user cannot type.
  if (/[^\x20-\x7E]/.test(body)) return bad('contains non-keyboard characters');

  // A copied placeholder is dropped rather than failing the whole generation:
  // the passage is the product, and a missing title is a smaller loss than
  // discarding good text over its label.
  const rawLabel = typeof parsed.label === 'string' ? parsed.label.trim() : '';
  const label = isEchoedPlaceholder(rawLabel) ? '' : rawLabel;
  const rawAuthor = typeof parsed.author === 'string' ? parsed.author.trim() : '';
  const author = isEchoedPlaceholder(rawAuthor) || /^name$/i.test(rawAuthor) ? '' : rawAuthor;

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

  const rawTitle = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const rawIntro = typeof parsed.intro === 'string' ? parsed.intro.trim() : '';
  const rawTopic = typeof parsed.topic === 'string' ? parsed.topic.trim() : '';
  const title = isEchoedPlaceholder(rawTitle) ? '' : rawTitle;
  const intro = isEchoedPlaceholder(rawIntro) ? '' : rawIntro;
  const topic = isEchoedPlaceholder(rawTopic) ? '' : rawTopic;

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
