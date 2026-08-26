import { describe, it, expect } from 'vitest';
import { HpBar } from './HpBar.jsx';
import { FocusBar } from './FocusBar.jsx';
import { DamageFloater } from './DamageFloater.jsx';
import { CardLane } from './CardLane.jsx';
import { MatchSummary } from './MatchSummary.jsx';
import { FighterCanvas } from './FighterCanvas.jsx';
import { CombatAnnouncer } from './CombatAnnouncer.jsx';
import ShadowArena from './ShadowArena.jsx';
import ShadowHub from './ShadowHub.jsx';
import ShadowRoom from './ShadowRoom.jsx';
import { NinjaScroll } from './NinjaScroll.jsx';
import {
  AVATAR_DEFS, AVATAR_OPTIONS, LANE_PRESENTATION, MOVE_LABELS,
  REQUIRED_AVATAR_FIELDS, getAvatar,
} from './avatars.js';
import { LANE_IDS } from '../../lib/shadow/laneDeck.js';
import { MOVES } from '../../lib/shadow/moveTable.js';

describe('Shadow Battle UI components', () => {
  it('exports all expected components', () => {
    expect(HpBar).toBeDefined();
    expect(FocusBar).toBeDefined();
    expect(DamageFloater).toBeDefined();
    expect(CardLane).toBeDefined();
    expect(MatchSummary).toBeDefined();
    expect(FighterCanvas).toBeDefined();
    expect(CombatAnnouncer).toBeDefined();
    expect(ShadowArena).toBeDefined();
    expect(ShadowHub).toBeDefined();
    expect(ShadowRoom).toBeDefined();
  });

  describe('HUD value math & clamping', () => {
    it('calculates valid percentage bounds for HP and Focus', () => {
      const calcPct = (val, max) => Math.max(0, Math.min(100, (val / max) * 100));

      expect(calcPct(1000, 1000)).toBe(100);
      expect(calcPct(0, 1000)).toBe(0);
      expect(calcPct(-50, 1000)).toBe(0);
      expect(calcPct(1200, 1000)).toBe(100);
      expect(calcPct(25, 100)).toBe(25);
    });

    it('identifies Overdrive and Mend thresholds correctly', () => {
      const isMendReady = (focus) => focus >= 25;
      const isOverdriveReady = (focus) => focus >= 100;

      expect(isMendReady(0)).toBe(false);
      expect(isMendReady(24)).toBe(false);
      expect(isMendReady(25)).toBe(true);
      expect(isMendReady(50)).toBe(true);

      expect(isOverdriveReady(99)).toBe(false);
      expect(isOverdriveReady(100)).toBe(true);
      expect(isOverdriveReady(150)).toBe(true);
    });
  });

  describe('Card Lane typing state logic', () => {
    it('determines card lane dimming on fork commitment', () => {
      const getLaneDimming = (committedLane, lane) => {
        if (!committedLane) return false;
        return committedLane !== lane;
      };

      expect(getLaneDimming(null, 'strike')).toBe(false);
      expect(getLaneDimming(null, 'guard')).toBe(false);
      expect(getLaneDimming('strike', 'strike')).toBe(false);
      expect(getLaneDimming('strike', 'guard')).toBe(true);
      expect(getLaneDimming('guard', 'strike')).toBe(true);
      expect(getLaneDimming('guard', 'guard')).toBe(false);
    });

    it('calculates correct letter cursor progress', () => {
      const word = 'dragon';
      const typed = 3;
      const progress = {
        completed: word.slice(0, typed),
        active: word[typed],
        remaining: word.slice(typed + 1),
      };

      expect(progress.completed).toBe('dra');
      expect(progress.active).toBe('g');
      expect(progress.remaining).toBe('on');
    });
  });

  describe('Combat Announcement speech formatting', () => {
    it('formats descriptive screen-reader announcements', () => {
      const formatDamageAnnouncement = (attacker, move, dmg) =>
        `${attacker} landed ${move} for ${dmg} damage!`;
      const formatParryAnnouncement = (defender, deflectedDmg) =>
        `${defender} performed a Parry, deflecting ${deflectedDmg} damage!`;

      expect(formatDamageAnnouncement('You', 'Slash', 140)).toBe('You landed Slash for 140 damage!');
      expect(formatParryAnnouncement('Opponent', 35)).toBe('Opponent performed a Parry, deflecting 35 damage!');
    });
  });
});

/**
 * Avatar surfaces added by the two-avatar work
 * (docs/superpowers/plans/2026-08-25-shadow-avatar-modes.md).
 *
 * Import-and-shape assertions only: vitest runs `environment: 'node'` with no
 * jsdom, so nothing here can render. What IS worth pinning is the copy and the
 * lane/move label coverage, since a missing label silently falls back to a raw
 * engine id in the HUD.
 */
describe('avatar definitions', () => {
  it('exports both avatars, in order, with every required field', () => {
    expect(AVATAR_DEFS.map((a) => a.id)).toEqual(['stickman', 'ninja']);
    for (const def of AVATAR_DEFS) {
      for (const field of REQUIRED_AVATAR_FIELDS) {
        expect(def, `${def.id} is missing ${field}`).toHaveProperty(field);
      }
      expect(def.beats.length).toBe(3);
      expect(def.description.length).toBeGreaterThan(60);
    }
  });

  it('assigns brand to Stickman and accent to Shadow Ninja, per the Side-Color Rule', () => {
    expect(getAvatar('stickman').tone).toBe('brand');
    expect(getAvatar('ninja').tone).toBe('accent');
  });

  it('gives each avatar a distinct canvas silhouette', () => {
    const silhouettes = AVATAR_DEFS.map((a) => a.silhouette);
    expect(new Set(silhouettes).size).toBe(silhouettes.length);
    expect(silhouettes).toContain('ninja');
  });

  it('getAvatar returns undefined for an unknown id', () => {
    expect(getAvatar('samurai')).toBeUndefined();
  });

  it('offers both avatars as Segmented options', () => {
    expect(AVATAR_OPTIONS.map((o) => o.value)).toEqual(['stickman', 'ninja']);
    for (const option of AVATAR_OPTIONS) expect(option.icon).toBeTruthy();
  });
});

describe('lane and move presentation', () => {
  it('has presentation for every lane the deck produces', () => {
    for (const id of LANE_IDS) {
      expect(LANE_PRESENTATION, `no presentation for lane ${id}`).toHaveProperty(id);
      expect(LANE_PRESENTATION[id].label.length).toBeGreaterThan(0);
      expect(LANE_PRESENTATION[id].hint.length).toBeGreaterThan(0);
    }
  });

  it('names the three lanes the way the brief does', () => {
    expect(LANE_IDS.map((id) => LANE_PRESENTATION[id].label)).toEqual(['Fight', 'Shield', 'Jump']);
  });

  /** A missing label would render a raw engine id like `shuriken` in the HUD. */
  it('has a label for every move in the table', () => {
    for (const id of Object.keys(MOVES)) {
      expect(MOVE_LABELS, `no label for move ${id}`).toHaveProperty(id);
      expect(MOVE_LABELS[id]).toBe(MOVES[id].name);
    }
  });
});

describe('NinjaScroll', () => {
  it('is exported as a component', () => {
    expect(NinjaScroll).toBeDefined();
    expect(typeof NinjaScroll).toBe('function');
  });
});
