import { CHARS_PER_WORD } from '../typing.js';

/**
 * The §8 damage formula, in integer tenths of an HP point (SB-CMB-3) —
 * every sub-factor is a float, but `computeDamage`/`reflectedDamage` round
 * exactly once, at the end. Deterministic only (SB-CMB-2):
 * every input here is a fact already present on a resolved CombatEvent.
 */

const REF_WPM = 60;

export function parMs(chars) {
  return Math.round((60000 * (chars + 1)) / (CHARS_PER_WORD * REF_WPM));
}

export function speedFactor(parMsValue, actualMs) {
  const raw = parMsValue / Math.max(actualMs, 1);
  return Math.min(1.40, Math.max(0.60, raw));
}

export function precisionFactor(errors) {
  if (errors === 0) return 1.25;
  if (errors === 1) return 1.00;
  if (errors === 2) return 0.80;
  return 0.60;
}

export function chainMul(chain) {
  return 1 + Math.min(0.05 * chain, 0.50);
}

export const CONTEST = {
  NEUTRAL: 'neutral',
  GUARDING: 'guarding',
  PARRYING: 'parrying',
  EXPOSED: 'exposed',
  COMMITTED: 'committed',
  STAGGERED: 'staggered',
};

export function contestFactor(state, guardFactor = 0.50) {
  switch (state) {
    case CONTEST.NEUTRAL: return 1.00;
    case CONTEST.GUARDING: return guardFactor;
    case CONTEST.PARRYING: return 0.00;
    case CONTEST.EXPOSED: return 1.25;
    case CONTEST.COMMITTED: return 1.50;
    case CONTEST.STAGGERED: return 1.35;
    default: throw new Error(`Unknown contest state: ${state}`);
  }
}

export function isCritical(precision, speed) {
  return precision === 1.25 && speed >= 1.25;
}

export function critMul(precision, speed) {
  return isCritical(precision, speed) ? 1.50 : 1.00;
}

export function computeDamage({ base, chars, actualMs, errors, chain, contestState, guardFactor = 0.50 }) {
  const par = parMs(chars);
  const speed = speedFactor(par, actualMs);
  const precision = precisionFactor(errors);
  const chainFactor = chainMul(chain);
  const contest = contestFactor(contestState, guardFactor);
  const crit = critMul(precision, speed);
  const raw = base * speed * precision * chainFactor * contest * crit;
  return Math.round(raw * 10);
}

// §10.7: a reflected strike's damage is 60% of the incoming strike's
// fully-computed damage at NEUTRAL contest (the caller computes that
// value by calling computeDamage with contestState: CONTEST.NEUTRAL).
export function reflectedDamage(neutralDamageTenths) {
  return Math.round(neutralDamageTenths * 0.60);
}
