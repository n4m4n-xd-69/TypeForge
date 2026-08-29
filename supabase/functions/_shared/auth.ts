/**
 * Who is calling.
 *
 * Signature verification is the *platform's* job, not this file's: every Forge
 * function ships with `verify_jwt = true` in config.toml, so the Edge Runtime
 * validates the token against the project JWKS before the handler is entered.
 * By the time this code runs, an invalid signature has already been rejected
 * with a 401.
 *
 * So this only decodes the claims. That matters for the CPU budget — an
 * Edge Function gets 2s of actual CPU per request, and re-verifying a
 * signature the platform already checked would spend it on nothing.
 *
 * The one rule that follows: never deploy a Forge function with
 * `verify_jwt = false` and then trust `claims.sub`. Functions that must run
 * unauthenticated (the cron-driven drain) authenticate with the secret key on
 * the `apikey` header instead, and never read a user id.
 */

export interface Caller {
  userId: string;
  role: string;
  isAnonymous: boolean;
  email?: string;
}

function decodeSegment(seg: string): Record<string, unknown> | null {
  try {
    const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/**
 * Reads the caller out of the Authorization header.
 *
 * Returns null rather than throwing: an unauthenticated visitor is a supported
 * state — they get bundled content and no inference, exactly as the app
 * behaves today when no AI is configured — not an error page.
 */
export function callerFrom(req: Request): Caller | null {
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;

  const token = header.slice(7).trim();
  // The new-style API keys are not JWTs. Sending one as a bearer token is a
  // common mistake and must not be read as an identity.
  if (token.startsWith('sb_publishable_') || token.startsWith('sb_secret_')) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const claims = decodeSegment(parts[1]);
  const sub = claims?.sub;
  if (typeof sub !== 'string' || !sub) return null;

  // Defence in depth: the platform checks `exp`, but a function accidentally
  // deployed with verify_jwt = false should still not honour a stale token.
  const exp = claims?.exp;
  if (typeof exp === 'number' && exp * 1000 < Date.now()) return null;

  return {
    userId: sub,
    role: typeof claims?.role === 'string' ? claims.role : 'authenticated',
    isAnonymous: claims?.is_anonymous === true,
    email: typeof claims?.email === 'string' ? claims.email : undefined,
  };
}

/** Callers presenting the project's secret key — cron and internal callers. */
export function isServiceCaller(req: Request, ...secrets: string[]): boolean {
  const key = req.headers.get('apikey') ?? '';
  if (!key) return false;
  // Any configured secret is accepted, not just the first.
  //
  // Supabase is migrating projects off the legacy `service_role` JWT onto
  // `sb_secret_` keys, and both are injected during the overlap. Accepting one
  // only would mean the scheduled caller starts failing 403 the day legacy
  // keys are turned off — a silent stop, since nothing is waiting on the
  // response. Accepting either makes that switch a no-op.
  return secrets.some((s) => s.length > 0 && s === key);
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
