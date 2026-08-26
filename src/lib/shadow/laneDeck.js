import { xorshift32, toU32, seedFrom } from './prng.js';
import { card, drawWordFor, SB_WRD_1_FALLBACK } from './wordQueue.js';
import { resolveForPlayer } from './cardResolution.js';

/**
 * The Stickman avatar's three-lane deck — Fight / Shield / Jump.
 *
 * The engine has two mechanical lanes (moveTable.js `LANES`). This module adds
 * a third *presented* lane on top of them: Jump always resolves to `evade`,
 * which is a GUARD-lane move. See
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §4 for why a
 * presented lane rather than a mechanical one.
 *
 * Two invariants make this module worth its own file:
 *
 *   1. **Reachability.** A lane is committed to by typing its word's first
 *      character, so if two lanes share a first character one of them can never
 *      be chosen. All three first characters must differ, case-insensitively.
 *      `wordQueue.card()` already guarantees this pairwise for Fight/Shield;
 *      this module extends it three-way and never weakens it.
 *
 *   2. **Non-perturbation.** The Jump word is drawn from an independently
 *      salted stream, the same discipline `cardResolution.js` uses for its
 *      Overdrive and Mend re-rolls. Adding a third lane must not change the
 *      Fight/Shield words an existing seed produces — otherwise every stored
 *      replay and every determinism fixture silently shifts.
 */

/** Presentation order, left to right. Also the tab order. */
export const LANE_IDS = ['fight', 'shield', 'jump'];

/** 'JUMP' as bytes. Keeps the Jump draw off the shared base stream. */
const JUMP_SALT = 0x4a554d50;

/** 'JMP2' — a second, distinct salt for the collision re-roll walk. */
const JUMP_REROLL_SALT = 0x4a4d5032;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

const MAX_REROLLS = 8;

const firstChar = (word) => word[0].toLowerCase();

/**
 * A curated fallback word whose first letter avoids every character in
 * `taken`. Walks the alphabet from `after` and returns the first
 * `SB_WRD_1_FALLBACK` entry that clears — each of those words starts with its
 * own key letter, so the returned word's first character is the key itself.
 *
 * Termination: `taken` holds at most two letters and the alphabet has 26, so a
 * full walk always finds one. Returns `null` only if that arithmetic is ever
 * violated, which the caller treats as a hard error rather than papering over.
 */
export function fallbackWordAvoiding(taken, after = 'a') {
  const start = ALPHABET.indexOf(after.toLowerCase());
  const blocked = new Set([...taken].map((c) => c.toLowerCase()));
  for (let i = 1; i <= ALPHABET.length; i += 1) {
    const letter = ALPHABET[(start + i) % ALPHABET.length];
    if (!blocked.has(letter)) return SB_WRD_1_FALLBACK[letter];
  }
  return null;
}

/**
 * Draw the Jump lane's word, guaranteed distinct from the two words it sits
 * beside. Pure in `(seed, round, index, band, taken)`.
 */
function drawJumpWord(seed, round, index, band, taken) {
  const state = xorshift32(seedFrom(toU32(seed), round, index, JUMP_SALT));
  let { word } = drawWordFor('evade', state, band);

  let attempts = 0;
  while (taken.includes(firstChar(word)) && attempts < MAX_REROLLS) {
    // Each re-roll gets its own salted stream keyed by attempt number, so a
    // collision-heavy card cannot drag the Jump sequence out of step with a
    // collision-free one — the nth re-roll of any card is independent.
    const rerollState = xorshift32(
      seedFrom(toU32(seed), round, index, JUMP_REROLL_SALT, attempts),
    );
    word = drawWordFor('evade', rerollState, band).word;
    attempts += 1;
  }

  if (taken.includes(firstChar(word))) {
    // Deterministic escape hatch, mirroring wordQueue's own fallback: pick the
    // alphabet's next unused letter relative to the Fight word, so the result
    // is a function of the card rather than of how many re-rolls happened.
    const fallback = fallbackWordAvoiding(taken, taken[0] ?? 'a');
    if (!fallback) throw new Error('laneDeck: no fallback word avoids the taken first characters');
    word = fallback;
  }

  return word;
}

/**
 * The deck for one card, resolved for one player.
 *
 * Signature mirrors `cardResolution.resolveForPlayer` — it needs live
 * `roundState` because Overdrive and the Mend gate are functions of Focus and
 * HP, not of the card index alone (see combat.js's "Event resolution seam"
 * note). Callers must cache the result once Overdrive fires, exactly as
 * `trialEngine`'s `overdriveLocked` flag does; this function is pure and will
 * happily un-resolve Overdrive the moment Focus drops.
 *
 * @returns {{
 *   overdrive: boolean,
 *   lanes: Array<{ id: string, moveId: string, word: string, mechanicalLane: 'strike'|'guard' }>
 * }}
 *   When `overdrive` is true the deck holds a **single** lane: a full burn is a
 *   commitment, not a choice, so offering Shield and Jump beside it would be
 *   offering a decision the rules do not allow.
 */
export function deckFor(seed, round, index, band, roundState, player = 0) {
  const base = card(seed, round, index, band);
  const resolved = resolveForPlayer(seed, round, index, base, roundState, player);

  if (resolved.strikeMove === 'overdrive') {
    return {
      overdrive: true,
      lanes: [
        {
          id: 'fight',
          moveId: 'overdrive',
          word: resolved.strikeWord,
          mechanicalLane: 'strike',
        },
      ],
    };
  }

  const taken = [firstChar(resolved.strikeWord), firstChar(resolved.guardWord)];
  const jumpWord = drawJumpWord(seed, round, index, band, taken);

  return {
    overdrive: false,
    lanes: [
      { id: 'fight', moveId: resolved.strikeMove, word: resolved.strikeWord, mechanicalLane: 'strike' },
      { id: 'shield', moveId: resolved.guardMove, word: resolved.guardWord, mechanicalLane: 'guard' },
      { id: 'jump', moveId: 'evade', word: jumpWord, mechanicalLane: 'guard' },
    ],
  };
}

/**
 * Which lane does this keystroke commit to? `null` means none — a whiff.
 *
 * Case-insensitive on purpose: holding Shift should not cost you Focus. The
 * word itself is still matched case-sensitively once committed, so
 * capitalisation inside a phrase still counts.
 */
export function laneForKey(deck, key) {
  if (!key || key.length !== 1) return null;
  const k = key.toLowerCase();
  return deck.lanes.find((lane) => firstChar(lane.word) === k) ?? null;
}

/**
 * Focus cost of a whiff, duplicated from combat.js's `applyWhiff` so the UI can
 * preview it without importing the reducer. Kept as a named export rather than
 * a literal in a component so the two cannot drift apart unnoticed.
 */
export const WHIFF_FOCUS_COST = 3;
