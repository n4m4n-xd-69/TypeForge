import { describe, expect, it } from 'vitest';
import { COMMANDS, matchCommands } from './commands.js';

describe('matchCommands', () => {
  it('returns every command for a bare slash', () => {
    expect(matchCommands('/')).toEqual(COMMANDS);
  });

  it('filters by prefix as more is typed', () => {
    expect(matchCommands('/ai')).toEqual([COMMANDS[0]]);
  });

  it('is case-insensitive', () => {
    expect(matchCommands('/AI')).toEqual([COMMANDS[0]]);
  });

  it('returns nothing once the text no longer matches any command', () => {
    expect(matchCommands('/aiquestion')).toEqual([]);
  });

  it('returns nothing for input that is not a slash command', () => {
    expect(matchCommands('hello /ai')).toEqual([]);
    expect(matchCommands('')).toEqual([]);
  });
});
