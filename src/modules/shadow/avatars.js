import { Flame, User } from 'lucide-react';

/**
 * The two Shadow Battle avatars, as data.
 *
 * Same arrangement as `src/modules/arena/lanes.js` and for the same reason: the
 * test environment is `node` with no DOM, so copy that lives inside JSX cannot
 * be asserted. Keeping it in a module makes the contract testable.
 *
 * An avatar is an **input surface**, not a combat engine — both resolve through
 * the same `combat.stepEvent` reducer. See
 * docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md §3.
 */

export const REQUIRED_AVATAR_FIELDS = [
  'id', 'name', 'tagline', 'description', 'beats', 'icon', 'tone', 'silhouette',
];

export const AVATAR_DEFS = Object.freeze([
  Object.freeze({
    id: 'stickman',
    name: 'Stickman',
    tagline: 'Three lanes. One choice per beat.',
    description:
      'Three words sit in front of you — Fight, Shield, Jump. The first character you '
      + 'type commits you to that lane, and there is no taking it back. Land the word to '
      + 'play the move. Every resolution deals a fresh set, so the keys never sit still.',
    beats: Object.freeze([
      'Fight · Shield · Jump, side by side',
      'First keystroke commits the lane',
      'New words after every move',
    ]),
    icon: User,
    tone: 'brand',
    silhouette: 'stick',
  }),
  Object.freeze({
    id: 'ninja',
    name: 'Shadow Ninja',
    tagline: 'One scroll. Do not break stride.',
    description:
      'A paragraph unrolls and the ninja fights while you type it. There are no lanes to '
      + 'choose — the prose picks the moves, clause by clause. Every wrong character costs '
      + 'you health outright, and your output is measured against your opponent\u2019s own '
      + 'speed and accuracy.',
    beats: Object.freeze([
      'Continuous prose, cut into strikes',
      'A wrong character costs HP immediately',
      'Damage scales against your opponent',
    ]),
    icon: Flame,
    tone: 'accent',
    silhouette: 'ninja',
  }),
]);

export function getAvatar(id) {
  return AVATAR_DEFS.find((a) => a.id === id);
}

/** Segmented-control options, in presentation order. */
export const AVATAR_OPTIONS = AVATAR_DEFS.map((a) => ({ value: a.id, label: a.name, icon: a.icon }));

/**
 * Lane presentation for the Stickman deck.
 *
 * Keyed by the lane ids `laneDeck.LANE_IDS` produces. `tone` follows the site
 * palette rather than inventing colours: Fight is the forge accent, Shield the
 * steel accent, Jump stays neutral ink so three lanes side by side do not turn
 * into a traffic light.
 */
export const LANE_PRESENTATION = Object.freeze({
  fight: Object.freeze({ label: 'Fight', hint: 'Deal damage', tone: 'brand' }),
  shield: Object.freeze({ label: 'Shield', hint: 'Block, parry or mend', tone: 'accent' }),
  jump: Object.freeze({ label: 'Jump', hint: 'Evade and bank Focus', tone: 'neutral' }),
});

/** Human-readable move names for the HUD, mirroring `moveTable.MOVES[].name`. */
export const MOVE_LABELS = Object.freeze({
  jab: 'Jab', slash: 'Slash', crush: 'Crush', shuriken: 'Shuriken', overdrive: 'Overdrive',
  guard: 'Guard', parry: 'Parry', mend: 'Mend', evade: 'Evade',
});
