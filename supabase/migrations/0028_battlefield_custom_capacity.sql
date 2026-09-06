-- Battlefield custom capacity: raise the ceiling from 30 to 60.
--
-- 0023 made 30 the real ceiling (the frontend had never offered more than 8).
-- This raises it again for a "Custom" tier the create form now exposes above
-- its 2/4/6/8/12/16/24/30 quick-pick chips — same server-owned validation,
-- same story, a higher number.
--
-- The realtime and checkpoint math 0023 worked out both scale with room size
-- rather than being pinned to 30: ticks broadcast at 1 Hz per player with no
-- fan-out through Postgres, and the checkpoint interval is
-- `max(5s, players * 600ms)`, so a 60-player room checkpoints every 36s
-- instead of writing on a fixed clock. Nothing here assumed a ceiling of 30
-- and had to be touched to reach 60 — the one number that mattered was the
-- constraint itself.

alter table public.battle_rooms drop constraint if exists battle_rooms_max_players_check;
alter table public.battle_rooms
  add constraint battle_rooms_max_players_check check (max_players between 2 and 60);

create or replace function public.battle_create(
  p_passage        text,
  p_passage_meta   text default null,
  p_difficulty     text default 'normal',
  p_max_players    int  default 8,
  p_time_limit_sec int  default 180
) returns public.battle_rooms
language plpgsql security definer set search_path = '' as $$
declare
  r    public.battle_rooms;
  uid  uuid := auth.uid();
  live int;
begin
  if uid is null then
    raise exception 'Sign in to open a Battlefield' using errcode = 'BF000';
  end if;
  if p_passage is null or length(p_passage) < 40 or length(p_passage) > 4000 then
    raise exception 'That passage is not a usable length' using errcode = 'BF008';
  end if;
  if p_max_players < 2 or p_max_players > 60 then
    raise exception 'A Battlefield holds 2 to 60 players' using errcode = 'BF007';
  end if;

  perform public.battle_reap();

  select count(*) into live from public.battle_rooms
   where admin_id = uid and status in ('lobby','countdown','active');
  if live >= 3 then
    raise exception 'You already have 3 Battlefields open' using errcode = 'BF010';
  end if;

  insert into public.battle_rooms (
    pin, admin_id, max_players, passage_chars, passage_meta, difficulty, time_limit_sec
  ) values (
    public.battle_mint_pin(), uid, p_max_players, length(p_passage),
    p_passage_meta, coalesce(p_difficulty, 'normal'), p_time_limit_sec
  ) returning * into r;

  insert into public.battle_passages (room_id, passage) values (r.id, p_passage);

  insert into public.battle_players (room_id, user_id, display_name, avatar, is_admin)
  select r.id, uid, p.display_name, p.avatar, true
    from public.profiles p where p.id = uid;

  return r;
end; $$;

revoke execute on function public.battle_create(text, text, text, int, int) from public, anon;
grant  execute on function public.battle_create(text, text, text, int, int) to authenticated;
