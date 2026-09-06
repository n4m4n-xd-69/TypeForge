/**
 * Chat-wide constants shared by the client.
 *
 * BOT_USER_ID must match the fixed UUID seeded in migration 0029 and the one
 * used in supabase/functions/chat-ai-reply/index.ts. Three independent
 * runtimes (Postgres, Deno, the browser) can't share one source file, so all
 * three carry a comment pointing at the other two — change one, change all.
 */
export const BOT_USER_ID = '00000000-0000-0000-0000-0000000000a1';
export const BOT_DISPLAY_NAME = 'TypeForge AI';
export const AI_COMMAND = '/ai';
