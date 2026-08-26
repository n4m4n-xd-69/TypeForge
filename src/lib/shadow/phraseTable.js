import { xorshift32, draw } from './prng.js';
import { COMMON, HARDER, PUNCTUATED } from '../content.js';

/**
 * The §9.1 [NEW] phrase table: 60 two-to-four-word combinations assembled
 * from COMMON+HARDER, generated once from a FIXED internal seed (never the
 * round's own seed — this table is the same for every match) and memoized.
 * Crush (§9.3, 10-16 chars) and Overdrive (14-24 chars, multi-word, mixed
 * case, >=1 punctuation mark) both query this same table by length range;
 * Overdrive additionally requires punctuation, satisfied at generation
 * time by splicing in a PUNCTUATED entry for phrases that don't already
 * have one.
 */

const TABLE_SEED = 0xC0FFEE; // fixed, arbitrary, never a live round seed
const TABLE_SIZE = 60;
const SOURCE_WORDS = [...COMMON, ...HARDER];

function buildTable() {
  const phrases = [];
  let state = xorshift32(TABLE_SEED);
  for (let i = 0; i < TABLE_SIZE; i += 1) {
    const wordCountDraw = draw(state); state = wordCountDraw.next;
    const wordCount = 2 + Math.floor(wordCountDraw.u * 3); // 2, 3, or 4

    const words = [];
    for (let w = 0; w < wordCount; w += 1) {
      const wordDraw = draw(state); state = wordDraw.next;
      words.push(SOURCE_WORDS[Math.floor(wordDraw.u * SOURCE_WORDS.length)]);
    }

    // Mixed case: capitalize the first word.
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);

    // Ensure at least one punctuation-bearing token, for phrases that
    // will need to satisfy Overdrive's requirePunctuation query.
    const hasPunctuation = words.some((w) => /[^A-Za-z0-9]/.test(w));
    if (!hasPunctuation) {
      const punctDraw = draw(state); state = punctDraw.next;
      const punctIndexDraw = draw(state); state = punctIndexDraw.next;
      const punctWord = PUNCTUATED[Math.floor(punctIndexDraw.u * PUNCTUATED.length)];
      const insertAt = Math.floor(punctDraw.u * words.length);
      words.splice(insertAt, 0, punctWord);
    }

    phrases.push(words.join(' '));
  }
  return phrases;
}

let cachedTable = null;
function table() {
  if (!cachedTable) cachedTable = buildTable();
  return cachedTable;
}

export function phraseFor(u, minChars, maxChars, { requirePunctuation = false } = {}) {
  const candidates = table().filter((p) => {
    if (p.length < minChars || p.length > maxChars) return false;
    if (requirePunctuation && !/[^A-Za-z0-9 ]/.test(p)) return false;
    return true;
  });
  if (candidates.length === 0) {
    throw new Error(`No phrase in the table satisfies [${minChars}, ${maxChars}]${requirePunctuation ? ' with punctuation' : ''}`);
  }
  return candidates[Math.floor(u * candidates.length)];
}
