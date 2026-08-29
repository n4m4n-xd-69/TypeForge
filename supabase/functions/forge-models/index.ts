/**
 * GET /functions/v1/forge-models — the picker catalogue.
 *
 * Returns Forge lane names and plugin descriptors only. No provider, no model
 * id, and no count of either — a model count is itself a hint about what is
 * underneath. This endpoint is the reason the client never needs to know.
 */
import { publicCatalogue } from '../_shared/lanes.ts';
import { CORS_HEADERS } from '../_shared/auth.ts';

/** Capability packs offered on the composer. Client-side executors. */
const PLUGINS = [
  { id: 'drill_forge', label: 'Drill Forge', blurb: 'Turn any answer into a typing drill.' },
  { id: 'snippet_forge', label: 'Snippet Forge', blurb: 'Send a tagged snippet straight to Code.' },
  { id: 'passage_forge', label: 'Passage Forge', blurb: 'Write practice prose on a topic.' },
  { id: 'stats_lens', label: 'Stats Lens', blurb: 'Answer using your real numbers.' },
  { id: 'code_lens', label: 'Code Lens', blurb: 'Read the snippet on screen.' },
  { id: 'library', label: 'Library', blurb: 'Search everything Forge has written.' },
];

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  return new Response(
    JSON.stringify({ lanes: publicCatalogue(), plugins: PLUGINS, default: 'balanced' }),
    {
      headers: {
        'Content-Type': 'application/json',
        // The catalogue is static per deploy; let the browser keep it.
        'Cache-Control': 'public, max-age=300',
        ...CORS_HEADERS,
      },
    },
  );
});
