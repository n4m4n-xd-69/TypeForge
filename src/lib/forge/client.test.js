import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase, signInAnonymously } from '../supabase.js';
import { streamChat, ForgeError } from './client.js';

/**
 * These cover the one piece of this file that is not just transport: how a
 * request behaves when nobody is signed in.
 *
 * It matters because moving the provider key server-side made a session
 * mandatory where none used to be. Before, the browser called the provider
 * itself and a first-time visitor got an answer without an account. Now every
 * call needs a JWT, so if the client did not mint a guest, the whole AI surface
 * would silently switch off for signed-out visitors — which is most people on a
 * first visit, and exactly the regression a passing build would not have shown.
 */

vi.mock('../supabase.js', () => ({
  supabase: { auth: { getSession: vi.fn() } },
  signInAnonymously: vi.fn(),
}));

vi.mock('../config.js', () => ({
  SUPABASE: { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' },
  AI_TIMING: { requestTimeoutMs: 1000, quickTimeoutMs: 1000 },
}));

/** A minimal SSE body so a successful call can complete. */
function sseResponse(frames) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const OK_FRAMES =
  'event: meta\ndata: {"cache":"miss"}\n\n' +
  'event: token\ndata: {"delta":"hello"}\n\n';

describe('forge/client authHeaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async () => sseResponse(OK_FRAMES));
  });

  it('uses the existing session without minting a guest', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'existing' } } });

    const res = await streamChat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('hello');
    expect(signInAnonymously).not.toHaveBeenCalled();
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer existing');
    // Not interchangeable with Authorization: a publishable key is not a JWT.
    expect(init.headers.apikey).toBe('sb_publishable_test');
  });

  it('mints a guest when there is no session, then proceeds', async () => {
    supabase.auth.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'minted' } } });
    signInAnonymously.mockResolvedValue({ id: 'guest-1' });

    const res = await streamChat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(res.text).toBe('hello');
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer minted');
  });

  it('signs in once when several calls race, not once per call', async () => {
    // The home page opens the coach read and the chat panel in the same tick.
    // Two sign-ins would mean two auth.users rows, the second orphaning the
    // first one's history.
    supabase.auth.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'minted' } } });

    let resolveSignIn;
    signInAnonymously.mockReturnValue(new Promise((r) => { resolveSignIn = r; }));

    const both = Promise.all([
      streamChat({ messages: [{ role: 'user', content: 'a' }] }),
      streamChat({ messages: [{ role: 'user', content: 'b' }] }),
    ]);
    resolveSignIn({ id: 'guest-1' });
    await both;

    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reports auth when anonymous sign-in is disabled for the project', async () => {
    // signInAnonymously returns null rather than throwing in that case. The
    // surfaces render `auth` as a fallback, not an error page.
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValue(null);

    await expect(streamChat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({ reason: 'auth' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retries the sign-in on a later call after one fails', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    signInAnonymously.mockResolvedValueOnce(null);

    await expect(streamChat({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toBeInstanceOf(ForgeError);

    // The shared promise must be cleared, or the app is stuck signed-out until
    // a reload.
    supabase.auth.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 'minted' } } });
    signInAnonymously.mockResolvedValue({ id: 'guest-1' });

    const res = await streamChat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello');
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });
});
