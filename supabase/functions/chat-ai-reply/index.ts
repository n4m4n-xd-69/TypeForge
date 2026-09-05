// supabase/functions/chat-ai-reply/index.ts
/**
 * POST /functions/v1/chat-ai-reply — one /ai command, answered and posted.
 *
 * Not streamed: the caller already has their own message on screen (it was
 * posted through chat_send_message before this was ever called — see
 * Composer.jsx), and the reply reaches every subscriber through the same
 * postgres_changes path any other chat message does. This function's whole
 * job is: verify, rate-limit, ask Forge, write the answer under the reserved
 * bot profile.
 *
 * BOT_USER_ID must match migration 0029's seed and src/lib/chat/constants.js
 * exactly — three runtimes, one fixed UUID, no shared file between them.
 */
import { complete, ForgeUnavailable } from '../_shared/runner.ts';
import { LANES } from '../_shared/lanes.ts';
import { withIdentity, violates, IDENTITY_LINE } from '../_shared/identity.ts';
import { callerFrom, CORS_HEADERS } from '../_shared/auth.ts';
import { createForgeDb, serviceClient } from '../_shared/db.supabase.ts';
import { NULL_DB } from '../_shared/db.ts';
import { aiEnabled } from '../_shared/env.ts';
import { primeSecrets } from '../_shared/secrets.ts';

const BOT_USER_ID = '00000000-0000-0000-0000-0000000000a1';
const AI_RATE_LIMIT = 5;
const AI_RATE_WINDOW_MIN = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!aiEnabled()) return json({ error: 'disabled', code: 'no-key' }, 503);

  const caller = callerFrom(req);
  if (!caller) return json({ error: 'unauthenticated', code: 'CH000' }, 401);

  let body: { messageId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (typeof body.messageId !== 'string' || !body.messageId) {
    return json({ error: 'messageId is required' }, 400);
  }

  const sb = serviceClient();
  if (!sb) return json({ error: 'chat is not configured' }, 503);

  // Fetch the invoking message and check it's really this caller's, really
  // in this channel, and really starts with /ai — never trust the client to
  // supply the question text directly.
  const { data: source, error: sourceErr } = await sb
    .from('chat_channel_messages')
    .select('id, channel_id, user_id, body')
    .eq('id', body.messageId)
    .maybeSingle();

  if (sourceErr || !source || source.user_id !== caller.userId) {
    return json({ error: 'no such message' }, 404);
  }
  const match = /^\/ai\s+(.+)/is.exec(source.body ?? '');
  if (!match) {
    return json({ error: 'not an /ai command' }, 400);
  }
  const question = match[1].trim();

  // This feature's own limit — tighter than general chat because each call
  // costs real provider spend. Counted off the invoking messages themselves,
  // no new table: every /ai use is already a row here.
  const windowStart = new Date(Date.now() - AI_RATE_WINDOW_MIN * 60_000).toISOString();
  const { count } = await sb
    .from('chat_channel_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', caller.userId)
    .ilike('body', '/ai %')
    .gte('created_at', windowStart);
  if ((count ?? 0) > AI_RATE_LIMIT) {
    return json({ error: 'rate limited', code: 'CH002' }, 429);
  }

  const db = createForgeDb() ?? NULL_DB;
  await primeSecrets(() => db.loadSecrets());

  let text: string;
  try {
    const result = await complete({
      messages: [
        {
          role: 'system',
          content: withIdentity(
            'You are answering inside a public group chat channel, not a private one-on-one '
            + 'conversation — other members will see this. Keep answers concise by default: a '
            + 'few sentences unless the question genuinely needs more.',
          ),
        },
        { role: 'user', content: question },
      ],
      lane: LANES.instant,
      db,
      stream: false,
      surface: 'chat-ai',
      userId: caller.userId,
    });
    text = violates(result.text) ? IDENTITY_LINE : result.text;
  } catch (err) {
    const e = err as ForgeUnavailable;
    return json({ error: e.message ?? 'The AI is unavailable right now.', code: e.reason ?? 'network' }, 502);
  }

  const { error: insertErr } = await sb.from('chat_channel_messages').insert({
    channel_id: source.channel_id,
    user_id: BOT_USER_ID,
    body: text,
    display_name: 'TypeForge AI',
    is_bot: true,
  });
  if (insertErr) return json({ error: 'could not post the reply' }, 500);

  return json({ ok: true });
});
