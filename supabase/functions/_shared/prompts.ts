/**
 * Prompt templates, moved server-side from `src/lib/ai.js`.
 *
 * The details here look fussy and each one is a scar:
 *
 *  - "no markdown, no line breaks" — a passage is rendered as one continuous
 *    run of characters, so a stray `**` becomes something the user has to type
 *    and gets marked wrong on.
 *  - "no characters outside a standard keyboard" — same reason, for em dashes
 *    and smart quotes.
 *  - spaces never tabs, lines under 72 characters — a tab is one keystroke
 *    rendered as an indeterminate number of columns.
 *  - the variation seed — same mode and difficulty means an identical prompt
 *    every time, and temperature alone does not stop a model reaching for its
 *    favourite opening. Practice kept serving variations on one paragraph.
 *
 * Bump PROMPT_VERSION in facets.ts when any of this changes: it is part of the
 * request hash, so a template edit retires the affected buckets cleanly.
 */
import type { Facets } from './facets.ts';
import type { Message } from './runner.ts';

const PASSAGE_SYSTEM =
  'You write text for a typing trainer. Plain prose only — no markdown, no '
  + 'line breaks, no emoji, and no characters outside a standard US keyboard. '
  + 'Reply with a single JSON object and nothing else.';

const SNIPPET_SYSTEM =
  'You produce short, idiomatic, self-contained code snippets for a typing '
  + 'trainer. Reply with a single JSON object and nothing else. Use spaces, '
  + 'never tabs. Keep lines under 72 characters.';

const DIFFICULTY_NOTE: Record<string, string> = {
  easy: 'Use only short, very common words. No punctuation beyond full stops.',
  normal: 'Everyday vocabulary with ordinary punctuation.',
  hard: 'Richer vocabulary, with commas, semicolons and hyphens.',
  expert: 'Dense vocabulary with quotes, parentheses, numbers and symbols.',
};

const TOPIC_BRIEF: Record<string, (words: number) => string> = {
  passage: (w) => `a flowing paragraph of roughly ${w} common English words`,
  quote: () => 'a single memorable sentence about programming, craft or focus, plus its author',
  drill: (w) => `a drill line of roughly ${w} short words`,
};

/** A throwaway seed. Its meaning is irrelevant; its variability is the point. */
function seed(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface PromptOptions {
  facets: Facets;
  words?: number;
  /** Free-text steer from the user, already treated as untrusted. */
  hint?: string;
}

export function passagePrompt({ facets, words = 60, hint }: PromptOptions): Message[] {
  const brief = (TOPIC_BRIEF[facets.kind] ?? TOPIC_BRIEF.passage)(words);
  const spice = DIFFICULTY_NOTE[facets.difficulty] ?? '';
  const topic = facets.topic && facets.topic !== 'general'
    ? ` The subject is ${facets.topic}.`
    : '';

  return [
    { role: 'system', content: PASSAGE_SYSTEM },
    {
      role: 'user',
      content:
        `Write ${brief}. ${spice}${topic}`
        + (hint ? ` The reader asked for: ${hint}` : '')
        + ` Variation seed ${seed()} — ignore its meaning, it exists only to`
        + ' push you somewhere new.'
        /* The shape is shown FILLED, not annotated.
           This used to read `{"text": "...", "label": "3-5 word description"}`
           — a description sitting where a value belongs. Smaller models copy
           what they see, so replies came back with the literal string
           "3-5 word description" in the label field, and that placeholder
           reached the typing surface as a passage title. Showing a plausible
           filled example and naming the rule separately removes the thing
           there was to copy. */
        + ' Reply with one JSON object and nothing else, in this shape: '
        + '{"text": "the passage itself", "label": "Steady hands at dawn"'
        + (facets.kind === 'quote' ? ', "author": "Ada Lovelace"' : '')
        + '}.'
        + ' The example values are illustrations — write your own, never copy'
        + ' them. "text" holds only the passage: no JSON, no quotes around it,'
        + ' no commentary.',
    },
  ];
}

export function snippetPrompt({ facets, hint }: PromptOptions): Message[] {
  const language = facets.language ?? 'javascript';
  const topic = facets.topic && facets.topic !== 'general'
    ? ` about ${facets.topic}`
    : '';

  return [
    { role: 'system', content: SNIPPET_SYSTEM },
    {
      role: 'user',
      content:
        `A ${facets.difficulty} ${language} snippet of 6-14 lines${topic} that `
        + 'teaches one idea.'
        + (hint ? ` The reader asked for: ${hint}` : '')
        + ` Variation seed ${seed()}.`
        /* Filled example, same reasoning as passagePrompt above. */
        + ' Reply with one JSON object and nothing else, in this shape: '
        + '{"title": "Debounce a resize handler", "topic": "event timing", '
        + '"intro": "Waits for the resizing to stop before doing the work.", '
        + '"code": "the snippet"}.'
        + ' The example values are illustrations — write your own, never copy'
        + ' them. "code" holds only the code.',
    },
  ];
}

/** Picks the right template for a kind. */
export function promptFor(opts: PromptOptions): Message[] {
  return opts.facets.kind === 'snippet' ? snippetPrompt(opts) : passagePrompt(opts);
}

/**
 * The lane a kind should run in.
 *
 * Deliberately not caller-controlled: a client asking for a snippet must not be
 * able to route it through the `deep` lane and spend a 6000-token budget on it.
 */
export function laneFor(kind: Facets['kind']): 'instant' | 'code' {
  return kind === 'snippet' ? 'code' : 'instant';
}
