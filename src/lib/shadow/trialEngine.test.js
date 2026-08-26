import { describe, it, expect } from 'vitest';
import {
  createTrialMatch,
  createTrialRound,
  handlePlayerKey,
  trialEngineTick,
  settleRoundOutcome,
} from './trialEngine.js';

describe('createTrialMatch & createTrialRound', () => {
  it('initializes match state and round state correctly', () => {
    const match = createTrialMatch({ seed: 42, botProfileId: 'adept', band: 'steel' });
    expect(match.match.phase).toBe('in-progress');
    expect(match.match.wins).toEqual([0, 0]);
    expect(match.currentRound).toBe(1);

    const round = createTrialRound(match, 1, 1000);
    expect(round.phase).toBe('countdown');
    expect(round.tCombatStart).toBe(4500); // 1000 + 3500ms countdown
    expect(round.roundState.hp).toEqual([1000, 1000]);
  });
});

describe('handlePlayerKey — Fork Commitment & Whiff (PRD §5.3, §6.1, §11.1)', () => {
  it('commits to strike or guard on first matching keystroke', () => {
    const match = createTrialMatch({ seed: 777, botProfileId: 'recruit', band: 'steel' });
    let round = createTrialRound(match, 1, 0);

    // Advance past countdown
    const tick = trialEngineTick(round, 4000);
    round = tick.nextRound;
    expect(round.phase).toBe('combat');

    const cardPair = round.playerCardState.activePair;
    expect(cardPair).toBeDefined();

    // Type the first character of the strike word
    const firstStrikeChar = cardPair.strikeWord[0];
    const resStrike = handlePlayerKey(round, firstStrikeChar, 4100);
    expect(resStrike.whiff).toBe(false);
    expect(resStrike.nextRound.playerCardState.lane).toBe('strike');
    expect(resStrike.nextRound.playerCardState.input).toBe(firstStrikeChar);
  });

  it('whiffs when typing a character that matches neither strike nor guard word', () => {
    const match = createTrialMatch({ seed: 777, botProfileId: 'recruit', band: 'steel' });
    let round = createTrialRound(match, 1, 0);
    round = trialEngineTick(round, 4000).nextRound;

    // Grant Focus so whiff can deduct it
    round.roundState.focus[0] = 10;

    const cardPair = round.playerCardState.activePair;
    // Find a char that matches neither strikeWord[0] nor guardWord[0]
    const invalidChar = 'xyz'.split('').find((c) => c !== cardPair.strikeWord[0] && c !== cardPair.guardWord[0]) ?? 'q';

    const res = handlePlayerKey(round, invalidChar, 4100);
    expect(res.whiff).toBe(true);
    expect(res.nextRound.roundState.focus[0]).toBe(7); // 10 - 3 Focus penalty
    expect(res.nextRound.playerCardState.lane).toBeNull();
  });
});

describe('handlePlayerKey — Card Completion & Reducer Folding', () => {
  it('completes card and steps combat reducer when full word is typed', () => {
    const match = createTrialMatch({ seed: 100, botProfileId: 'recruit', band: 'steel' });
    let round = createTrialRound(match, 1, 0);
    round = trialEngineTick(round, 4000).nextRound;

    const cardPair = round.playerCardState.activePair;
    const strikeWord = cardPair.strikeWord;

    // Type out the full strike word character by character
    let t = 4100;
    for (const ch of strikeWord) {
      const res = handlePlayerKey(round, ch, t);
      round = res.nextRound;
      t += 100;
    }

    // After completion:
    // 1. An event should be recorded in eventsLog
    expect(round.eventsLog.length).toBe(1);
    const ev = round.eventsLog[0];
    expect(ev.player).toBe(0);
    expect(ev.outcome).toBe('complete');
    expect(ev.lane).toBe('strike');
    expect(ev.moveId).toBe(cardPair.strikeMove);

    // 2. Opponent (bot) HP should have taken damage
    expect(round.roundState.hp[1]).toBeLessThan(1000);

    // 3. Next card is initialized for the player
    expect(round.playerCardState.cardIndex).toBe(1);
    expect(round.playerCardState.lane).toBeNull();
  });
});

describe('Overdrive stickiness caching (PRD §10.2 / Note 2)', () => {
  it('locks Overdrive into the active card pair once Focus hits 100 and persists even if Focus drops below 100', () => {
    const match = createTrialMatch({ seed: 100, botProfileId: 'recruit', band: 'steel' });
    let round = createTrialRound(match, 1, 0);
    round = trialEngineTick(round, 4000).nextRound;

    // Simulate gaining 100 Focus
    round.roundState.focus[0] = 100;

    // Trigger engine tick or input check
    round = trialEngineTick(round, 4100).nextRound;
    expect(round.playerCardState.activePair.strikeMove).toBe('overdrive');
    expect(round.playerCardState.overdriveLocked).toBe(true);

    // Simulate Focus being drained by an opponent action or whiff
    round.roundState.focus[0] = 50;
    round = trialEngineTick(round, 4200).nextRound;

    // Overdrive MUST remain locked on this card!
    expect(round.playerCardState.activePair.strikeMove).toBe('overdrive');
  });
});

describe('Round & Match Lifecycle', () => {
  it('ends round when bot HP reaches 0 and updates match state', () => {
    let match = createTrialMatch({ seed: 50, botProfileId: 'recruit', band: 'steel' });
    let round = createTrialRound(match, 1, 0);
    round = trialEngineTick(round, 4000).nextRound;

    // Force bot HP to 0
    round.roundState.hp[1] = 0;
    const tick = trialEngineTick(round, 5000);
    expect(tick.roundEnded).toBe(true);
    expect(tick.roundOutcome.winner).toBe(0);

    // Settle round outcome
    match = settleRoundOutcome(match, tick.roundOutcome);
    expect(match.match.wins[0]).toBe(1);
    expect(match.match.roundsPlayed).toBe(1);
  });
});
