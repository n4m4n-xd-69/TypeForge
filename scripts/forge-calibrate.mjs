/**
 * Calibrates the semantic-retrieval thresholds against the live embedding model.
 *
 *     FORGE_NVIDIA_KEY=... node scripts/forge-calibrate.mjs
 *
 * Why this exists: ARCHITECTURE.md specified "serve at >= 0.86, anchor at
 * >= 0.78". Those numbers were invented, not measured, and are unreachable
 * with `nemotron-3-embed-1b` — a correct query/passage pair scores 0.19-0.46.
 * Shipping them would have left the semantic stage silently dead.
 *
 * The table below is what the thresholds in `orchestrator.ts` are derived
 * from. Re-run it whenever the embedding model or `queryText()` changes, and
 * move the thresholds to match what it prints. Two numbers matter:
 *
 *   relevant min     the worst score a *correct* pair achieves
 *   irrelevant max   the best score a *wrong* pair achieves
 *
 * If irrelevant max >= relevant min, the ranges overlap and no single cutoff
 * can separate them — which is the situation today. In that case SERVE must
 * sit above everything observed (fire rarely, never wrongly) and ANCHOR can
 * sit low, because a wrong anchor only steers a fresh generation.
 */
import { embed } from '../supabase/functions/_shared/embeddings.ts';
import { embedTextFor, normaliseFacets, queryText } from '../supabase/functions/_shared/facets.ts';

/** Deliberately varied: two on-theme for a typing app, two well outside it. */
const PASSAGES = {
  focus: 'A quiet room, a steady breath, and a paragraph you have never seen '
    + 'before. That is the whole exercise, repeated until it becomes ordinary.',
  ocean: 'The tide pulled back across the grey shingle, dragging small stones '
    + 'with it, and the gulls turned inland ahead of the coming weather.',
  cooking: 'Warm the pan slowly, add the butter, and wait for the foam to '
    + 'subside before the garlic goes in, or it will catch and turn bitter.',
  space: 'The probe fell silent beyond Neptune, its transmitter too weak to '
    + 'reach the antennas that had listened for thirty patient years.',
};

/** Query topic -> the passage it should match. */
const QUERIES = {
  focus: 'focus',
  'the ocean and tides': 'ocean',
  'cooking dinner': 'cooking',
  'space exploration': 'space',
};

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

async function main() {
  if (!process.env.FORGE_NVIDIA_KEY) {
    console.error('FORGE_NVIDIA_KEY is required — it is the only embedding provider.');
    process.exit(1);
  }

  const keys = Object.keys(PASSAGES);
  const vectors = {};
  for (const [k, text] of Object.entries(PASSAGES)) {
    vectors[k] = await embed(embedTextFor(text), 'passage');
    if (!vectors[k]) {
      console.error(`could not embed the "${k}" passage — provider unavailable?`);
      process.exit(1);
    }
  }

  console.log(`query`.padEnd(22) + keys.map((k) => k.padStart(7)).join(''));

  const relevant = [];
  const irrelevant = [];
  let top1 = 0;

  for (const [topic, expected] of Object.entries(QUERIES)) {
    const facets = normaliseFacets({ kind: 'passage', difficulty: 'normal', topic });
    const q = await embed(queryText(facets), 'query');
    const sims = keys.map((k) => cosine(q, vectors[k]));

    const best = keys[sims.indexOf(Math.max(...sims))];
    if (best === expected) top1 += 1;

    keys.forEach((k, i) => (k === expected ? relevant : irrelevant).push(sims[i]));

    console.log(
      topic.padEnd(22)
      + sims.map((s) => s.toFixed(3).padStart(7)).join('')
      + (best === expected ? '   top-1 ok' : '   MISRANKED'),
    );
  }

  const relMin = Math.min(...relevant);
  const relMax = Math.max(...relevant);
  const irrMax = Math.max(...irrelevant);

  console.log(`\ntop-1 correct   : ${top1}/${Object.keys(QUERIES).length}`);
  console.log(`relevant range  : ${relMin.toFixed(3)} .. ${relMax.toFixed(3)}`);
  console.log(`irrelevant max  : ${irrMax.toFixed(3)}`);

  if (irrMax >= relMin) {
    console.log(
      `\nOVERLAP: the best irrelevant pair (${irrMax.toFixed(3)}) scores above the\n`
      + `worst relevant one (${relMin.toFixed(3)}). No single cutoff separates them.\n`
      + `Keep SERVE above ${relMax.toFixed(2)} so it never fires wrongly, and rely on\n`
      + `exact-facet lookup for reuse. ANCHOR may sit near ${(irrMax / 2).toFixed(2)}.`,
    );
  } else {
    const suggested = (relMin + irrMax) / 2;
    console.log(`\nSEPARABLE: a cutoff near ${suggested.toFixed(2)} splits them cleanly.`);
  }
}

main().catch((err) => {
  console.error('calibration failed:', err);
  process.exit(1);
});
