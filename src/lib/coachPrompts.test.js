import { describe, expect, it } from 'vitest';
import {
  capabilitiesFor, categorise, followUpsFor, languageName, startersFor, traceSteps,
} from './coachPrompts.js';

const stats = (over = {}) => ({
  wpm: 62,
  accuracy: 96,
  sessionCount: 12,
  streak: 3,
  level: { level: 7 },
  ...over,
});

const assistant = (text) => ({ role: 'assistant', text });
const user = (text) => ({ role: 'user', text });

describe('startersFor', () => {
  it('offers the beginner set before any session exists', () => {
    const out = startersFor(stats({ sessionCount: 0 }), [], null);
    expect(out).toHaveLength(4);
    expect(out[0].text).toMatch(/never touch-typed/);
  });

  it('leads with accuracy when accuracy is the weaker number', () => {
    const out = startersFor(stats({ accuracy: 88 }), [], 'Python');
    expect(out[0].text).toContain('88%');
  });

  it('leads with speed once accuracy is already high', () => {
    const out = startersFor(stats({ accuracy: 98 }), [], 'Python');
    expect(out[0].text).toContain('62 WPM');
  });

  it('names the language being practised', () => {
    const out = startersFor(stats(), [], 'Rust');
    expect(out.some((s) => s.text.includes('Rust'))).toBe(true);
  });

  it('never offers more than four', () => {
    const out = startersFor(stats(), ['a', 'b', 'c', 'd', 'e'], 'Go');
    expect(out.length).toBeLessThanOrEqual(4);
  });
});

describe('followUpsFor', () => {
  it('returns nothing when there is no transcript', () => {
    expect(followUpsFor([])).toEqual([]);
    expect(followUpsFor(null)).toEqual([]);
  });

  it('returns nothing while the user holds the last turn', () => {
    expect(followUpsFor([user('hello')])).toEqual([]);
  });

  it('returns nothing for a failed answer', () => {
    expect(followUpsFor([{ role: 'assistant', text: 'nope', failed: true }])).toEqual([]);
  });

  it('offers code follow-ups when the answer contains a snippet', () => {
    const out = followUpsFor([user('show me'), assistant('Sure:\n```js\nconst a = 1;\n```')]);
    expect(out[0]).toMatch(/typing drill/);
  });

  it('offers drill follow-ups when the answer is about drills', () => {
    const out = followUpsFor([assistant('Try this drill for ten minutes each morning.')]);
    expect(out[0]).toMatch(/10-minute daily plan/);
  });

  it('tracks the topic — a speed answer and an accuracy answer differ', () => {
    const speed = followUpsFor([assistant('Your WPM will climb if you stop pausing.')]);
    const accuracy = followUpsFor([assistant('Your accuracy dips because of one error class.')]);
    expect(speed).not.toEqual(accuracy);
  });

  it('never offers a question the user has already asked', () => {
    const already = 'Explain that more simply.';
    const out = followUpsFor([user(already), assistant('Some general answer with no topic.')]);
    expect(out).not.toContain(already);
  });

  it('volunteers weak keys when the answer did not mention them', () => {
    const out = followUpsFor([assistant('A general answer.')], { weak: ['q', 'z', 'x'] });
    expect(out.some((p) => p.includes('q, z, x'))).toBe(true);
  });

  it('does not volunteer weak keys the answer already covered', () => {
    const out = followUpsFor([assistant('Focus on q for now.')], { weak: ['q'] });
    expect(out.some((p) => p.startsWith('Work my weakest keys'))).toBe(false);
  });

  it('caps at three and never repeats one', () => {
    const out = followUpsFor([assistant('```js\ncode\n```')], { weak: ['q'] });
    expect(out.length).toBeLessThanOrEqual(3);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('traceSteps', () => {
  it('marks only context done before anything streams', () => {
    const [ctx, reason, write] = traceSteps({ thinking: '', partial: '', hasContext: true });
    expect(ctx.state).toBe('done');
    expect(reason.state).toBe('idle');
    expect(write.state).toBe('idle');
  });

  it('activates reasoning while reasoning tokens arrive', () => {
    const [, reason, write] = traceSteps({ thinking: 'hmm', partial: '', hasContext: true });
    expect(reason.state).toBe('active');
    expect(write.state).toBe('idle');
  });

  it('closes reasoning once the answer starts arriving', () => {
    const [, reason, write] = traceSteps({ thinking: 'hmm', partial: 'The', hasContext: true });
    expect(reason.state).toBe('done');
    expect(write.state).toBe('active');
  });

  it('still reports writing when a model streams no reasoning at all', () => {
    const [, reason, write] = traceSteps({ thinking: '', partial: 'The', hasContext: true });
    expect(reason.state).toBe('done');
    expect(write.state).toBe('active');
  });

  it('says so when there is no practice data to read', () => {
    const [ctx] = traceSteps({ thinking: '', partial: '', hasContext: false });
    expect(ctx.label).toMatch(/Opened the session/);
  });
});

describe('capabilitiesFor', () => {
  it('always offers exactly four cards', () => {
    expect(capabilitiesFor(stats(), [], 'Go')).toHaveLength(4);
    expect(capabilitiesFor(stats({ sessionCount: 0 }), [], null)).toHaveLength(4);
  });

  it('seeds the drill card with the real weak keys', () => {
    const [, drills] = capabilitiesFor(stats(), ['q', 'z'], 'Go');
    expect(drills.prompt).toContain('q, z');
  });

  it('falls back to a general drill when no weak keys are recorded', () => {
    const [, drills] = capabilitiesFor(stats(), [], 'Go');
    expect(drills.prompt).not.toContain('undefined');
    expect(drills.prompt).toMatch(/most likely to be weak/);
  });

  it('asks a beginner about first steps rather than quoting a fake accuracy', () => {
    const [technique] = capabilitiesFor(stats({ sessionCount: 0, accuracy: 0 }), [], null);
    expect(technique.prompt).toMatch(/starting from scratch/);
  });

  it('names the language and the next level', () => {
    const [, , code, progress] = capabilitiesFor(stats({ level: { level: 9 } }), [], 'Rust');
    expect(code.prompt).toContain('Rust');
    expect(progress.prompt).toContain('level 10');
  });
});

describe('categorise', () => {
  it('reads a drill request as Drills', () => {
    expect(categorise('Design a drill for my weakest keys')).toBe('Drills');
  });

  it('reads a code question as Code', () => {
    expect(categorise('Explain closures in JavaScript')).toBe('Code');
  });

  it('prefers Drills when a request is both', () => {
    expect(categorise('Drill my closures')).toBe('Drills');
  });

  it('reads a posture question as Technique', () => {
    expect(categorise('Should I learn proper finger placement first?')).toBe('Technique');
  });

  it('falls back to Coaching, and never throws on junk', () => {
    expect(categorise('How am I doing?')).toBe('Coaching');
    expect(categorise('')).toBe('Coaching');
    expect(categorise(undefined)).toBe('Coaching');
  });
});

describe('language naming', () => {
  it('capitalises the stored lowercase language in both surfaces', () => {
    expect(capabilitiesFor(stats(), [], 'javascript')[2].hint).toBe('JavaScript concepts');
    expect(startersFor(stats(), [], 'python').some((s) => s.text.includes('Python'))).toBe(true);
  });

  it('falls back to JavaScript for a missing or blank language', () => {
    expect(capabilitiesFor(stats(), [], null)[2].hint).toBe('JavaScript concepts');
    expect(capabilitiesFor(stats(), [], '   ')[2].hint).toBe('JavaScript concepts');
  });
});

describe('language names with internal capitals', () => {
  it('uses the real name for every language the app ships', () => {
    const hint = (l) => capabilitiesFor(stats(), [], l)[2].hint;
    expect(hint('typescript')).toBe('TypeScript concepts');
    expect(hint('sql')).toBe('SQL concepts');
    expect(hint('cpp')).toBe('C++ concepts');
    expect(hint('go')).toBe('Go concepts');
  });

  it('still capitalises a language it has never seen', () => {
    expect(capabilitiesFor(stats(), [], 'elixir')[2].hint).toBe('Elixir concepts');
  });
});

describe('languageName', () => {
  it('is exported so read-only panels and prompts agree', () => {
    expect(languageName('javascript')).toBe('JavaScript');
    expect(languageName(undefined)).toBe('JavaScript');
    expect(languageName('cpp')).toBe('C++');
  });
});
