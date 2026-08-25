/**
 * The seeded PRNG primitives §9.4 requires — xorshift32, the canonical
 * Marsaglia 32-bit variant, specified exactly (a named algorithm with a
 * written reference implementation, not "use a seeded PRNG"). Every
 * consumer in src/lib/shadow/ builds on `draw`, which turns a 32-bit state
 * into a [0,1) float plus the next state — the same shape whether you're
 * picking a move, a word, or a bank.
 */

export function xorshift32(state) {
  let x = state | 0;
  x ^= x << 13; x |= 0;
  x ^= x >>> 17;
  x ^= x << 5; x |= 0;
  return x >>> 0;
}

// seed is a Postgres bigint at the database boundary; JS bitwise ops
// truncate to 32 bits, so the reduction is explicit here rather than
// left to whatever `| 0` happens to do to an out-of-range bigint.
export function toU32(seedOrBigInt) {
  return Number(BigInt(seedOrBigInt) & 0xFFFFFFFFn) >>> 0;
}

export function draw(state) {
  const next = xorshift32(state);
  return { u: next / 4294967296, next };
}

// Combines seed components via XOR for callers building a per-card PRNG
// seed from several parts (seed, round, index, etc.) — guards xorshift32's
// documented zero fixed-point (see the test above) by substituting a fixed
// nonzero constant if the XOR happens to land on exactly 0. Any call site
// that XORs multiple parts together to seed xorshift32 should go through
// this instead of a raw XOR.
export function seedFrom(...parts) {
  const combined = parts.reduce((acc, p) => (acc ^ p) >>> 0, 0);
  return combined === 0 ? 0x9E3779B9 : combined; // arbitrary nonzero constant
}
