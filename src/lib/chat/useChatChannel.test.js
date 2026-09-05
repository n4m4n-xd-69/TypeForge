import { describe, expect, it } from 'vitest';
import { mergeIncoming, mergeOlderPage } from './useChatChannel.js';

const msg = (id, createdAt) => ({ id, created_at: createdAt, body: id });

describe('mergeIncoming', () => {
  it('appends a new message to the end', () => {
    const result = mergeIncoming([msg('a', '2026-01-01T00:00:00Z')], msg('b', '2026-01-01T00:00:01Z'));
    expect(result.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('ignores a message already present by id', () => {
    // The sender's own message: sendMessage() already added it optimistically,
    // then the realtime INSERT for that same row arrives a moment later.
    const existing = [msg('a', '2026-01-01T00:00:00Z')];
    const result = mergeIncoming(existing, msg('a', '2026-01-01T00:00:00Z'));
    expect(result).toEqual(existing);
    expect(result).not.toBe(existing); // still a new array, not the same reference re-sent
  });
});

describe('mergeOlderPage', () => {
  it('prepends an older page before the current messages', () => {
    const current = [msg('c', '2026-01-01T00:00:02Z')];
    const older = [msg('a', '2026-01-01T00:00:00Z'), msg('b', '2026-01-01T00:00:01Z')];
    expect(mergeOlderPage(current, older).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops any duplicate id the older page happens to include', () => {
    const current = [msg('b', '2026-01-01T00:00:01Z')];
    const older = [msg('a', '2026-01-01T00:00:00Z'), msg('b', '2026-01-01T00:00:01Z')];
    expect(mergeOlderPage(current, older).map((m) => m.id)).toEqual(['a', 'b']);
  });
});
