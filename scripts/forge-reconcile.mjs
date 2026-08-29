/**
 * Reconciles every configured model id against the providers' live catalogues.
 *
 * This exists because model ids churn faster than anyone expects: six of the
 * eight HCNSec ids in the original `src/lib/config.js` vanished within about
 * three weeks, and two of the four OpenRouter ids went with them. Nothing in
 * the app noticed — requests just failed over to the tail of the ladder and
 * the lead provider silently stopped being used.
 *
 * Run it in CI, and nightly against production:
 *
 *     node scripts/forge-reconcile.mjs
 *
 * Exits non-zero if any configured id is absent upstream, so it can gate a
 * deploy. Providers without a key are skipped, not failed — a three-key deploy
 * is a supported configuration.
 *
 * Node 24 strips TypeScript types natively, which is why this .mjs file can
 * import the Edge Function modules directly instead of duplicating the tables.
 */
import { LANES, EMBED_MODEL, QUARANTINED } from '../supabase/functions/_shared/lanes.ts';
import { PROVIDERS } from '../supabase/functions/_shared/providers.ts';

const CATALOGUE = {
  nim: 'https://integrate.api.nvidia.com/v1/models',
  hcnsec: 'https://api.hcnsec.cn/v1/models',
  kira: 'https://kiraai.vn/api/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

const TIMEOUT_MS = 30_000;

async function fetchIds(providerId) {
  const key = process.env[PROVIDERS[providerId].keyName] ?? '';
  if (!key) return { skipped: 'no key' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CATALOGUE[providerId], {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = await res.json();
    const rows = json?.data ?? json?.models ?? [];
    return { ids: new Set(rows.map((m) => m.id ?? m.name).filter(Boolean)) };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Every (provider, model) this deploy could ever call. */
function configuredRungs() {
  const out = new Map();
  for (const lane of Object.values(LANES)) {
    for (const [provider, model] of lane.ladder) {
      if (!out.has(provider)) out.set(provider, new Map());
      const seen = out.get(provider);
      seen.set(model, [...(seen.get(model) ?? []), lane.id]);
    }
  }
  // The embed model is already reachable through the `embed` lane's ladder;
  // this only guarantees it is checked even if that lane is ever restructured.
  if (!out.has('nim')) out.set('nim', new Map());
  const nim = out.get('nim');
  if (!nim.has(EMBED_MODEL)) nim.set(EMBED_MODEL, ['embed']);
  return out;
}

async function main() {
  const wanted = configuredRungs();
  let missing = 0;
  let checked = 0;
  const skipped = [];

  for (const [provider, models] of wanted) {
    const result = await fetchIds(provider);

    if (result.skipped) {
      skipped.push(`${provider} (${result.skipped})`);
      continue;
    }
    if (result.error) {
      // A catalogue that cannot be read is not proof a model is gone, so this
      // is a warning rather than a failure. Failing here would let one
      // provider's outage block an unrelated deploy.
      console.warn(`WARN  ${provider}: catalogue unreadable (${result.error}) — not checked`);
      skipped.push(`${provider} (unreadable)`);
      continue;
    }

    for (const [model, lanes] of models) {
      checked += 1;
      if (result.ids.has(model)) {
        console.log(`ok    ${provider}/${model}  [${lanes.join(', ')}]`);
      } else {
        missing += 1;
        console.error(`GONE  ${provider}/${model}  [${lanes.join(', ')}] — absent from /v1/models`);
      }
    }
  }

  // A quarantined model reappearing is worth knowing about: it means the rung
  // can go back into its ladder.
  for (const [provider, models] of wanted) {
    for (const model of models.keys()) {
      if (QUARANTINED.includes(model)) {
        console.warn(`NOTE  ${provider}/${model} is quarantined but still configured`);
      }
    }
  }

  console.log(`\n${checked} ids checked, ${missing} missing.`);
  if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`);

  if (missing > 0) {
    console.error('\nFAIL: configured models no longer exist upstream. Fix lanes.ts.');
    process.exit(1);
  }
  if (checked === 0) {
    console.error('\nFAIL: nothing was checked — no provider keys are set.');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((err) => {
  console.error('reconcile failed:', err);
  process.exit(1);
});
