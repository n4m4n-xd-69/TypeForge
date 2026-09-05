-- Admin read path for chat moderation (Task 12).
--
-- `chat_channel_messages`' own read policy (0029) is member-facing:
-- `deleted_at is null`. An admin reviewing moderation needs the removed rows
-- too, so this is a dedicated SECURITY DEFINER RPC rather than a widened
-- table policy — same shape as every other admin_* read in this console
-- (0014, 0024, 0029), gated by the same `content.moderate` scope
-- chat_delete_message/admin_mute_chat_user/admin_unmute_chat_user already
-- require. Added as its own migration, not folded back into 0029, because
-- 0029 is already committed.

create or replace function public.admin_recent_chat_channel_messages(p_limit int default 100)
returns setof public.chat_channel_messages
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_require('content.moderate');
  return query
    select * from public.chat_channel_messages
     order by created_at desc
     limit least(p_limit, 200);
end; $$;

revoke execute on function public.admin_recent_chat_channel_messages(int) from public, anon;
grant  execute on function public.admin_recent_chat_channel_messages(int) to authenticated;
