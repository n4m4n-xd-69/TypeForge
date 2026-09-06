import { describe, expect, it } from 'vitest';
import { CHAT_ERROR_COPY, chatErrorMessage } from './api.js';

describe('chatErrorMessage', () => {
  it('maps a known code to its copy', () => {
    expect(chatErrorMessage({ code: 'CH001' })).toBe(CHAT_ERROR_COPY.CH001);
    expect(chatErrorMessage({ code: 'CH003' })).toBe(CHAT_ERROR_COPY.CH003);
  });

  it('falls back to the raw message for an unknown code', () => {
    expect(chatErrorMessage({ code: 'XX999', message: 'weird' })).toBe('weird');
  });

  it('falls back to a generic message when nothing is usable', () => {
    expect(chatErrorMessage({})).toBe('Something went wrong.');
  });

  it('returns null for a null error', () => {
    expect(chatErrorMessage(null)).toBeNull();
  });
});
