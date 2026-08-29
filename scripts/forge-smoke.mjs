/**
 * End-to-end smoke test of the router against the real providers.
 *
 * Unit tests prove the plan, the hedge and the SSE parser in isolation with a
 * stubbed `fetch`. This proves the same code against four live APIs that each
 * have their own quirks — an empty `model` field, a temperature ceiling, a
 * reasoning stream that emits nothing but thinking for many frames.
 *
 *     node scripts/forge-smoke.mjs            # every lane, non-streaming
 *     node scripts/forge-smoke.mjs --stream   # add a streaming pass
 *
 * Costs real quota, so it is not part of `npm test`.
 */
import { complete } from '../supabase/functions/_shared/runner.ts';
import { LANES, PUBLIC_LANES } from '../supabase/functions/_shared/lanes.ts';
import { activeProviders } from '../supabase/functions/_shared/providers.ts';

const wantStream = process.argv.includes('--stream');

async function run(laneId, stream) {
  const started = Date.now();
  const attempts = [];
  try {
    const res = await complete({
      messages: [
        { role: 'system', content: 'Reply with exactly the words: hello forge. Nothing else.' },
        { role: 'user', content: 'go' },
      ],
      lane: laneId,
      stream,
      maxTokens: 64,
      onAttempt: (a) => attempts.push(`${a.provider}/${a.model}`),
    });
    const ms = Date.now() - started;
    const text = res.text.replace(/\s+/g, ' ').slice(0, 60);
    console.log(
      `PASS  ${laneId.padEnd(9)} ${String(ms).padStart(6)}ms  ` +
      `attempt#${res.attemptIndex}  ${res.provider}/${res.model}\n` +
      `      -> "${text}"` +
      (res.reasoning ? `\n      thinking: ${res.reasoning.replace(/\s+/g, ' ').slice(0, 60)}...` : ''),
    );
    return true;
  } catch (err) {
    const ms = Date.now() - started;
    console.error(
      `FAIL  ${laneId.padEnd(9)} ${String(ms).padStart(6)}ms  reason=${err.reason ?? '?'}\n` +
      `      tried: ${attempts.join(', ') || '(none)'}\n` +
      `      ${String(err.message).slice(0, 200)}`,
    );
    return false;
  }
}

const providers = activeProviders().map((p) => p.id);
console.log(`providers with keys: ${providers.join(', ') || '(none)'}\n`);
if (providers.length === 0) {
  console.error('No FORGE_*_KEY set — nothing to smoke test.');
  process.exit(1);
}

let pass = 0;
let total = 0;

console.log('--- non-streaming ---');
for (const lane of PUBLIC_LANES) {
  total += 1;
  if (await run(lane, false)) pass += 1;
}

total += 1;
if (await run('guard', false)) pass += 1;

if (wantStream) {
  console.log('\n--- streaming ---');
  for (const lane of ['instant', 'balanced', 'reasoning']) {
    total += 1;
    if (await run(lane, true)) pass += 1;
  }
}

console.log(`\n${pass}/${total} lanes answered.`);
process.exit(pass === total ? 0 : 1);
