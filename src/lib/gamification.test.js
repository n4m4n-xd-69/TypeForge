import { describe, expect, it } from 'vitest';
import { xpForSession, ACHIEVEMENTS, missionsForDay, missionProgress } from './gamification.js';

describe('xpForSession', () => {
  const baseParams = { wpm: 80, accuracy: 97, durationSec: 60 };

  it('preserves pre-refactor XP for text kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'text' })).toBe(103);
  });

  it('preserves pre-refactor XP for code kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'code' })).toBe(129);
  });

  it('preserves pre-refactor XP for battle kind', () => {
    expect(xpForSession({ ...baseParams, kind: 'battle' })).toBe(119);
  });

  it('preserves pre-refactor XP for shadow kind (generic fallback to 1)', () => {
    expect(xpForSession({ ...baseParams, kind: 'shadow' })).toBe(103);
  });

  it('preserves pre-refactor XP for unregistered kind (defaults to 1)', () => {
    expect(xpForSession({ ...baseParams, kind: 'made-up-kind' })).toBe(103);
  });

  it('default kind parameter is text', () => {
    expect(xpForSession({ ...baseParams })).toBe(xpForSession({ ...baseParams, kind: 'text' }));
  });

  it('preserves pre-refactor XP for code with hard difficulty', () => {
    expect(xpForSession({ ...baseParams, kind: 'code', difficulty: 'hard' })).toBe(155);
  });
});

describe('Shadow Battle Achievements & Missions (PRD §20)', () => {
  it('contains all 10 required Shadow Battle achievements', () => {
    const shadowIds = [
      'shadow-first',
      'shadow-win',
      'shadow-flawless',
      'shadow-parry-10',
      'shadow-chain-15',
      'shadow-overdrive',
      'shadow-comeback',
      'shadow-rank-quench',
      'shadow-rank-damascus',
      'shadow-win-25',
    ];

    for (const id of shadowIds) {
      const ach = ACHIEVEMENTS.find((a) => a.id === id);
      expect(ach).toBeDefined();
      expect(ach.tier).toMatch(/^(bronze|silver|gold|legend)$/);
      expect(typeof ach.test).toBe('function');
    }
  });

  it('correctly evaluates achievement test conditions', () => {
    const shadowFirst = ACHIEVEMENTS.find((a) => a.id === 'shadow-first');
    expect(shadowFirst.test({ sessions: [{ kind: 'shadow' }], shadowBattles: 0 })).toBe(true);
    expect(shadowFirst.test({ sessions: [{ kind: 'text' }], shadowBattles: 0 })).toBe(false);

    const shadowQuench = ACHIEVEMENTS.find((a) => a.id === 'shadow-rank-quench');
    expect(shadowQuench.test({ shadowFr: 1450 })).toBe(true);
    expect(shadowQuench.test({ shadowFr: 1350 })).toBe(false);
  });

  it('picks 3 valid daily missions including possible shadow missions', () => {
    const missions = missionsForDay('2026-08-25');
    expect(missions.length).toBe(3);
    for (const m of missions) {
      expect(m.goal).toBeGreaterThan(0);
      expect(m.xp).toBeGreaterThan(0);
      expect(typeof m.metric).toBe('string');
    }
  });
});
