-- `community_post` could not attach a room code to a post. At all.
--
-- 0025 named the local variable `pin`, and the live-room check reads:
--
--     where battle_rooms.pin = pin
--
-- Qualifying the left side does not disambiguate the right side: plpgsql sees
-- `pin` as both the variable and `battle_rooms.pin`, and its default conflict
-- behaviour is to raise. So every post carrying a Battlefield code failed with
-- `column reference "pin" is ambiguous` — which is to say the Community's one
-- distinguishing feature, sharing an invite, was broken 100% of the time. The
-- suite could not see it (the function lives in Postgres) and neither could the
-- structural checker (the SQL is well-formed); it took calling the RPC.
--
-- Two changes:
--
-- 1. The variable is `v_pin`, so nothing is ambiguous.
--
-- 2. A code whose room is not open no longer rejects the post — it drops the
--    code and posts the message. The pin is *auto-detected* from free text by
--    the composer, so refusing meant an unrelated six-character token could
--    block a message the person actually wanted to send, with an error about a
--    Battlefield they never mentioned. Dropping it degrades to plain text,
--    which is what the author wrote anyway. A code that is live when posted and
--    closes later is unaffected: it stays on the row, and `community_feed`
--    already renders it as closed rather than as a join button.

create or replace function public.community_post(
  p_body text,
  p_pin  text default null
) returns public.community_posts
language plpgsql security definer set search_path = '' as $$
declare
  post  public.community_posts;
  v_pin text := nullif(btrim(upper(coalesce(p_pin, ''))), '');
  recent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to post' using errcode = 'BF000';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'a message is required' using errcode = '22023';
  end if;

  -- Repeated from the RLS policy on purpose. This function is SECURITY DEFINER,
  -- so it bypasses that policy entirely — and since this is the path the client
  -- actually uses, the policy alone would let a suspended account post through
  -- the only door anyone walks through.
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and coalesce(status, 'active') = 'active'
  ) then
    raise exception 'Your account cannot post right now' using errcode = '42501';
  end if;

  -- Rate limit in the database, where it cannot be skipped by not using the UI.
  select count(*) into recent from public.community_posts
   where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if recent >= 5 then
    raise exception 'Slow down a moment — five posts a minute is the limit'
      using errcode = 'CM001';
  end if;

  if v_pin is not null and not exists (
    select 1 from public.battle_rooms r
     where r.pin = v_pin and r.status in ('lobby','countdown','active')
  ) then
    v_pin := null;
  end if;

  insert into public.community_posts (user_id, body, battle_pin)
  values (auth.uid(), btrim(p_body), v_pin)
  returning * into post;

  return post;
end; $$;

revoke execute on function public.community_post(text, text) from public, anon;
grant  execute on function public.community_post(text, text) to authenticated;
