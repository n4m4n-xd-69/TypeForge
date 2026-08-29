/**
 * The six axes a generation is filed under, and the hashes derived from them.
 *
 * Normalisation matters more than it looks. `Rust`, `rust` and ` rust ` must
 * produce the same request hash or the library silently fragments into buckets
 * of one, every lookup misses, and the whole reuse story quietly stops working
 * while appearing to be fine.
 */

export interface Facets {
  kind: 'passage' | 'snippet' | 'drill' | 'quote' | 'explanation' | 'analysis';
  category: string;
  level: number;
  difficulty: 'easy' | 'normal' | 'hard' | 'expert';
  language: string | null;
  topic: string;
}

const KINDS = ['passage', 'snippet', 'drill', 'quote', 'explanation', 'analysis'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;

/**
 * Bumped whenever a prompt template changes.
 *
 * Included in the request hash, so a template edit invalidates the affected
 * buckets cleanly — old rows stop matching and stop being served, without a
 * delete and without touching anything generated under a different template.
 */
export const PROMPT_VERSION = 'v1';

/**
 * Levels are banded, not exact.
 *
 * Level 7 and level 8 want the same text. Keying on the raw level would give
 * 100 buckets where 34 will do, and each one would take three times as long to
 * fill to the point where reuse starts paying.
 */
export const LEVEL_BAND = 3;

export function levelBand(level: number): number {
  const n = Number.isFinite(level) ? Math.max(0, Math.min(100, Math.trunc(level))) : 0;
  return Math.floor(n / LEVEL_BAND) * LEVEL_BAND;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(value ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Untrusted input in, canonical facets out. */
export function normaliseFacets(input: Partial<Record<keyof Facets, unknown>>): Facets {
  const language = String(input.language ?? '').trim().toLowerCase();
  return {
    kind: oneOf(input.kind, KINDS, 'passage'),
    category: String(input.category ?? 'practice').trim().toLowerCase() || 'practice',
    level: levelBand(Number(input.level ?? 0)),
    difficulty: oneOf(input.difficulty, DIFFICULTIES, 'normal'),
    language: language || null,
    topic: String(input.topic ?? 'general').trim().toLowerCase().slice(0, 80) || 'general',
  };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * Identity of a *request*: what was asked for, not what came back.
 *
 * This is what the exact-lookup stage keys on. Deliberately not unique — many
 * generations share one request hash, and the bucket they form is what makes
 * "don't show me what I've already typed" a free `not exists` rather than a
 * plea to the model.
 */
export function requestHash(facets: Facets, promptVersion = PROMPT_VERSION): Promise<string> {
  return sha256Hex([
    promptVersion,
    facets.kind,
    facets.category,
    String(facets.level),
    facets.difficulty,
    facets.language ?? '-',
    facets.topic,
  ].join('|'));
}

/**
 * Identity of a *body*, for collapsing duplicates on write.
 *
 * Normalised before hashing so two runs that differ only in whitespace or
 * quote style are recognised as the same text rather than filling the bucket
 * with near-identical rows.
 */
export function contentHash(body: string): Promise<string> {
  return sha256Hex(normaliseBody(body));
}

/** Whitespace and quote normalisation, shared by the hash and the quality gate. */
export function normaliseBody(body: string): string {
  return String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Terse label for logs and admin views. Not used for embedding — see below. */
export function facetSummary(facets: Facets): string {
  return [
    facets.kind,
    facets.difficulty,
    facets.language ?? 'prose',
    facets.topic,
    `level ${facets.level}`,
  ].join(' · ');
}

/**
 * What gets embedded on the *query* side.
 *
 * Measured, not guessed. The first version embedded `facetSummary()` for the
 * query and `facetSummary() + body` for the stored row, and the two sat about
 * **0.49** apart — below even the 0.78 anchor threshold, so the semantic stage
 * would have quietly never fired while looking perfectly healthy.
 *
 * Two things were wrong. The tag string is not natural language, and mixing it
 * into the stored vector let the body dominate one side but not the other. The
 * fix is to make both sides describe the same kind of thing: a query says what
 * text is wanted, in a sentence; a row embeds its body alone (`embedTextFor`).
 *
 * The facets are not in the vector at all. They do not need to be — the SQL
 * prefilter in `forge_match()` already restricts to the right kind, difficulty,
 * language and level band, so spending vector dimensions on them only blurs
 * the topical signal that the vector exists to carry.
 */
export function queryText(facets: Facets, hint?: string): string {
  const what = facets.kind === 'snippet'
    ? `A ${facets.language ?? 'code'} snippet`
    : facets.kind === 'quote'
      ? 'A short quotation'
      : facets.kind === 'drill'
        ? 'A typing drill line'
        : 'A paragraph';

  const about = facets.topic && facets.topic !== 'general'
    ? ` about ${facets.topic}`
    : '';

  // No "for typing practice" tail, deliberately. That boilerplate is itself
  // the subject of generic practice prose, and adding it made a "cooking
  // dinner" query rank a passage about focus and repetition *above* the one
  // about a frying pan. Dropping it moved top-1 accuracy to 4/4 on the
  // calibration set.
  return `${what}${about}.${hint ? ` ${hint}` : ''}`;
}

/** What gets embedded on the *stored row* side: the text itself, nothing else. */
export function embedTextFor(body: string): string {
  return normaliseBody(body);
}
