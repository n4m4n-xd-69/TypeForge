/**
 * Fails the build if a provider key or vendor model id reaches the browser.
 *
 * Two separate promises this guards, both easy to break by accident:
 *
 *   1. No API key is in the bundle. The whole reason the Edge Function tier
 *      exists — the previous version of this app inlined two provider keys via
 *      `VITE_`-prefixed variables and said so in a comment nobody actioned.
 *
 *   2. No vendor or model identifier is in the bundle. Forge AI answers as
 *      Forge AI, and the wire protocol deliberately has no field for a model
 *      name. A stray import of the lane table into client code would undo that
 *      quietly, and this is what would catch it.
 *
 *     npm run check:bundle          # after npm run build
 *
 * Scans `dist/` only. Source comments legitimately mention the old names while
 * explaining why they are gone, and comments do not ship.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.cwd(), 'dist');

/** Key formats, matched on their distinctive prefixes. */
const SECRETS = [
  ['OpenRouter key', /sk-or-v1-[A-Za-z0-9]{16}/],
  ['NVIDIA key', /nvapi-[A-Za-z0-9_-]{16}/],
  ['KiraAI key', /kira_[A-Za-z0-9]{16}/],
  ['generic sk- key', /\bsk-[A-Za-z0-9]{32,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{8}/],
];

/**
 * Vendor tokens. Word-anchored where a substring would produce false
 * positives — `glm` inside "algorithm" is the obvious one, and `nemo` would
 * match any number of innocent words.
 */
const VENDORS = [
  /\bnemotron\b/i, /\bdeepseek\b/i, /\bhcnsec\b/i, /\bopenrouter\b/i,
  /\bkiraai\b/i, /\bkat-coder\b/i, /\bsensenova\b/i, /\bminimax\b/i,
  /\bpoolside\b/i, /\bmoonshotai\b/i, /\bnemotron-3\b/i,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|css|html|json|map)$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const files = walk(DIST);
const findings = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(process.cwd(), file);

  for (const [label, pattern] of SECRETS) {
    const m = text.match(pattern);
    if (m) findings.push(`SECRET  ${rel}: ${label} (${m[0].slice(0, 12)}…)`);
  }
  for (const pattern of VENDORS) {
    const m = text.match(pattern);
    if (m) findings.push(`VENDOR  ${rel}: "${m[0]}" — model ids must not ship`);
  }
}

console.log(`scanned ${files.length} built file(s)`);

if (findings.length > 0) {
  console.error('\nFAIL — the bundle must not contain these:\n');
  for (const f of findings) console.error(`  ${f}`);
  console.error('\nProvider keys belong in Supabase (npm run forge:secrets).');
  console.error('Model ids belong in supabase/functions/_shared/lanes.ts only.');
  process.exit(1);
}

console.log('PASS — no provider key and no vendor identifier in the bundle.');
