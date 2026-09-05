-- Prevents /ai reply replay: without this, POSTing the same messageId to
-- chat-ai-reply repeatedly re-passes every check in the function (ownership,
-- the /ai regex match, the rate-limit count) and calls Forge again each
-- time, at real cost — the rate-limit count tracks messages the caller has
-- SENT, not how many times this endpoint has been INVOKED, so it does
-- nothing to stop a replay against one already-answered message.

alter table public.chat_channel_messages
  add column if not exists ai_reply_to uuid references public.chat_channel_messages(id) on delete set null;

create index if not exists chat_channel_messages_ai_reply_to_idx
  on public.chat_channel_messages (ai_reply_to) where ai_reply_to is not null;
