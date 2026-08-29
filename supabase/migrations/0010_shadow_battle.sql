-- Shadow Battle — 2-player real-time combat backend (docs/08-PRD-shadow-battle.md).
--
-- Depends on 0001 (profiles, RLS shape), 0002 (is_admin), and 0009 (Battlefield).
-- Extends the platform to 2-player duels without modifying 0009 (SC-A3 / G5).

/* ── 1. tables ──────────────────────────────────────────────────────────── */

create table if not exists public.shadow_rooms (
  id                uuid primary key default gen_random_uuid(),
  pin               text not null,
  host_id           uuid not null references auth.users on delete cascade,
  visibility        text not null default 'private' check (visibility in ('private', 'public')),
  status            text not null default 'lobby'
                      check (status in ('lobby','countdown','active','round_end','paused','finished','abandoned','cancelled','expired')),
  seed              bigint not null,
  band              text not null default 'steel' check (band in ('ember', 'steel', 'damascus')),
  rated             boolean not null default false,
  current_round     int not null default 1 check (current_round between 1 and 5),
  score_p0          int not null default 0,
  score_p1          int not null default 0,

  starts_at         timestamptz,
  round_starts_at   timestamptz,
  round_deadline_at timestamptz,
  paused_at         timestamptz,
  pause_ms_total    int not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 minutes'
);

create unique index if not exists shadow_rooms_pin_live_uniq
  on public.shadow_rooms (pin)
  where status in ('lobby', 'countdown', 'active', 'round_end', 'paused');

create index if not exists shadow_rooms_host_idx on public.shadow_rooms (host_id);
create index if not exists shadow_rooms_status_idx on public.shadow_rooms (status);
create index if not exists shadow_rooms_reap_idx on public.shadow_rooms (expires_at)
  where status in ('lobby', 'countdown', 'active', 'round_end', 'paused');

/* ── 2. players / seats ─────────────────────────────────────────────────── */

create table if not exists public.shadow_players (
  room_id       uuid not null references public.shadow_rooms on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  seat          int not null check (seat in (0, 1)),
  display_name  text,
  avatar        text,
  fighter_id    text not null default 'standard',
  is_host       boolean not null default false,
  ready         boolean not null default false,
  connection    text not null default 'connected' check (connection in ('connected', 'unstable', 'disconnected')),
  last_seen_at  timestamptz not null default now(),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,

  primary key (room_id, user_id),
  unique (room_id, seat)
);

create index if not exists shadow_players_user_idx on public.shadow_players (user_id);

/* ── 3. events log ──────────────────────────────────────────────────────── */

create table if not exists public.shadow_events (
  room_id    uuid not null references public.shadow_rooms on delete cascade,
  seat       int not null check (seat in (0, 1)),
  seq        int not null,
  round      int not null check (round between 1 and 5),
  card_index int not null,
  lane       text not null check (lane in ('strike', 'guard')),
  outcome    text not null check (outcome in ('complete', 'expire', 'whiff')),
  t_start    int not null,
  t_end      int not null,
  keystrokes int not null,
  errors     int not null,
  iki_mean   real not null default 0,
  iki_stdev  real not null default 0,
  created_at timestamptz not null default now(),

  primary key (room_id, seat, seq)
);

create index if not exists shadow_events_room_round_idx on public.shadow_events (room_id, round);

/* ── 4. settled rounds ──────────────────────────────────────────────────── */

create table if not exists public.shadow_rounds (
  room_id     uuid not null references public.shadow_rooms on delete cascade,
  round       int not null check (round between 1 and 5),
  winner_seat int check (winner_seat in (0, 1)),
  hp_p0       int not null,
  hp_p1       int not null,
  reason      text not null check (reason in ('knockout', 'time', 'forfeit', 'double_ko')),
  duration_ms int not null,
  settled_at  timestamptz not null default now(),

  primary key (room_id, round)
);

/* ── 5. match results ───────────────────────────────────────────────────── */

create table if not exists public.shadow_results (
  room_id       uuid not null references public.shadow_rooms on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  seat          int not null check (seat in (0, 1)),
  outcome       text not null check (outcome in ('win', 'loss', 'draw', 'forfeit')),
  rounds_won    int not null default 0,
  rounds_lost   int not null default 0,
  damage_dealt  int not null default 0,
  damage_taken  int not null default 0,
  best_chain    int not null default 0,
  wpm           real not null default 0,
  accuracy      real not null default 100,
  clean_rate    real not null default 1,
  client_hp     int not null default 1000,
  fr_before     int not null default 1200,
  fr_after      int not null default 1200,
  fr_delta      int not null default 0,
  opponent_kind text not null default 'human' check (opponent_kind in ('human', 'bot')),
  bot_profile   text,
  flags         text[] not null default '{}',
  created_at    timestamptz not null default now(),

  primary key (room_id, user_id)
);

create index if not exists shadow_results_user_idx on public.shadow_results (user_id, created_at desc);

/* ── 6. persistent ratings & statistics ─────────────────────────────────── */

create table if not exists public.shadow_ratings (
  user_id      uuid primary key references auth.users on delete cascade,
  fr           int not null default 1200,
  peak_fr      int not null default 1200,
  matches      int not null default 0,
  wins         int not null default 0,
  losses       int not null default 0,
  draws        int not null default 0,
  streak       int not null default 0,
  best_streak  int not null default 0,
  rounds_won   int not null default 0,
  rounds_lost  int not null default 0,
  damage_dealt bigint not null default 0,
  damage_taken bigint not null default 0,
  best_chain   int not null default 0,
  parries      int not null default 0,
  overdrives   int not null default 0,
  avg_wpm      real not null default 0,
  avg_accuracy real not null default 100,
  clean_rate   real not null default 1,
  updated_at   timestamptz not null default now()
);

/* ── 7. cosmetic unlocks ────────────────────────────────────────────────── */

create table if not exists public.shadow_unlocks (
  user_id     uuid not null references auth.users on delete cascade,
  fighter_id  text not null,
  unlocked_at timestamptz not null default now(),

  primary key (user_id, fighter_id)
);

/* ── 8. transient matchmaking queue ─────────────────────────────────────── */

create table if not exists public.shadow_queue (
  user_id         uuid primary key references auth.users on delete cascade,
  fighter_id      text not null default 'standard',
  fr              int not null default 1200,
  band            text not null default 'steel',
  enqueued_at     timestamptz not null default now(),
  matched_room_id uuid references public.shadow_rooms on delete set null,
  matched_at      timestamptz
);

create index if not exists shadow_queue_enqueued_idx on public.shadow_queue (enqueued_at);

/* ── 9. views ───────────────────────────────────────────────────────────── */

create or replace view public.shadow_public_rooms as
select
  r.id,
  r.pin,
  r.band,
  r.rated,
  r.status,
  r.created_at,
  h.display_name as host_name,
  h.avatar as host_avatar,
  coalesce(rt.fr, 1200) as host_fr
from public.shadow_rooms r
join public.shadow_players h on h.room_id = r.id and h.is_host = true
left join public.shadow_ratings rt on rt.user_id = h.user_id
where r.visibility = 'public'
  and r.status = 'lobby'
  and r.expires_at > now();

create or replace view public.shadow_leaderboard as
select
  sr.user_id,
  coalesce(p.display_name, 'Anonymous') as display_name,
  p.avatar as avatar,
  sr.fr,
  sr.peak_fr,
  sr.matches,
  sr.wins,
  sr.losses,
  sr.draws,
  sr.best_streak,
  sr.avg_wpm,
  sr.avg_accuracy
from public.shadow_ratings sr
left join public.profiles p on p.id = sr.user_id
where sr.matches >= 3
order by sr.fr desc;

/* ── 10. security definer helpers & RLS ──────────────────────────────────── */

create or replace function public.in_shadow(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.shadow_players
    where room_id = p_room_id
      and user_id = auth.uid()
      and left_at is null
  );
$$;

create or replace function public.is_shadow_host(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.shadow_rooms
    where id = p_room_id
      and host_id = auth.uid()
  );
$$;

alter table public.shadow_rooms enable row level security;
alter table public.shadow_players enable row level security;
alter table public.shadow_events enable row level security;
alter table public.shadow_rounds enable row level security;
alter table public.shadow_results enable row level security;
alter table public.shadow_ratings enable row level security;
alter table public.shadow_unlocks enable row level security;
alter table public.shadow_queue enable row level security;

create policy "shadow_rooms_select"
  on public.shadow_rooms for select
  using (public.in_shadow(id) or host_id = auth.uid() or public.is_admin());

create policy "shadow_players_select"
  on public.shadow_players for select
  using (public.in_shadow(room_id) or public.is_shadow_host(room_id) or public.is_admin());

create policy "shadow_players_update_self"
  on public.shadow_players for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "shadow_events_select"
  on public.shadow_events for select
  using (public.in_shadow(room_id) or public.is_admin());

create policy "shadow_rounds_select"
  on public.shadow_rounds for select
  using (public.in_shadow(room_id) or public.is_admin());

create policy "shadow_results_select"
  on public.shadow_results for select
  using (user_id = auth.uid() or public.in_shadow(room_id) or public.is_admin());

create policy "shadow_ratings_select"
  on public.shadow_ratings for select
  using (true);

create policy "shadow_unlocks_select"
  on public.shadow_unlocks for select
  using (user_id = auth.uid() or public.is_admin());

create policy "shadow_queue_select"
  on public.shadow_queue for select
  using (user_id = auth.uid() or public.is_admin());

/* ── 11. RPC functions ───────────────────────────────────────────────────── */

-- Clock synchronization handshake
create or replace function public.arena_server_time()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'server_time', clock_timestamp(),
    'epoch_ms', round(extract(epoch from clock_timestamp()) * 1000)
  );
$$;

-- Global PIN minting across competitive modes
create or replace function public.arena_mint_pin()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := '';
    for i in 1..4 loop
      candidate := candidate || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    if not exists (select 1 from public.shadow_rooms where pin = candidate and status in ('lobby','countdown','active','round_end','paused'))
       and not exists (select 1 from public.battle_rooms where pin = candidate and status in ('lobby','countdown','active')) then
      return candidate;
    end if;
  end loop;
end;
$$;

-- Cross-mode join code lookup
create or replace function public.arena_code_lookup(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := upper(trim(p_pin));
  v_shadow public.shadow_rooms%rowtype;
  v_battle public.battle_rooms%rowtype;
begin
  select * into v_shadow from public.shadow_rooms
  where pin = v_norm and status in ('lobby', 'countdown', 'active', 'round_end', 'paused')
  limit 1;

  if found then
    return jsonb_build_object('mode', 'shadow', 'room_id', v_shadow.id, 'status', v_shadow.status);
  end if;

  select * into v_battle from public.battle_rooms
  where pin = v_norm and status in ('lobby', 'countdown', 'active')
  limit 1;

  if found then
    return jsonb_build_object('mode', 'battle', 'room_id', v_battle.id, 'status', v_battle.status);
  end if;

  return null;
end;
$$;

-- Create Shadow Battle room
create or replace function public.shadow_create(
  p_visibility text default 'private',
  p_fighter_id text default 'standard',
  p_rated boolean default false,
  p_band text default 'steel'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_pin text;
  v_room public.shadow_rooms%rowtype;
  v_seed bigint;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_profile from public.profiles where id = v_user_id;
  v_pin := public.arena_mint_pin();
  v_seed := (abs(hashtext(v_pin || clock_timestamp()::text))::bigint * 4294967296::bigint) + floor(random() * 4294967295)::bigint;

  insert into public.shadow_rooms (
    pin, host_id, visibility, status, seed, band, rated
  ) values (
    v_pin, v_user_id, p_visibility, 'lobby', v_seed, p_band, p_rated
  ) returning * into v_room;

  insert into public.shadow_players (
    room_id, user_id, seat, display_name, avatar, fighter_id, is_host, ready
  ) values (
    v_room.id, v_user_id, 0, coalesce(v_profile.display_name, 'Host'), v_profile.avatar, p_fighter_id, true, true
  );

  return jsonb_build_object('room', to_jsonb(v_room), 'pin', v_pin);
end;
$$;

-- Join Shadow Battle room by PIN
create or replace function public.shadow_join(
  p_pin text,
  p_fighter_id text default 'standard'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_room public.shadow_rooms%rowtype;
  v_count int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select * into v_room from public.shadow_rooms
  where pin = upper(trim(p_pin)) and status = 'lobby'
  for update;

  if not found then raise exception 'Room not found or no longer in lobby'; end if;

  select count(*) into v_count from public.shadow_players where room_id = v_room.id and left_at is null;
  if v_count >= 2 and not exists (select 1 from public.shadow_players where room_id = v_room.id and user_id = v_user_id) then
    raise exception 'Room is full';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;

  insert into public.shadow_players (
    room_id, user_id, seat, display_name, avatar, fighter_id, is_host, ready
  ) values (
    v_room.id, v_user_id, 1, coalesce(v_profile.display_name, 'Challenger'), v_profile.avatar, p_fighter_id, false, false
  )
  on conflict (room_id, user_id) do update
  set left_at = null, fighter_id = p_fighter_id, last_seen_at = now();

  return jsonb_build_object('room_id', v_room.id, 'seat', 1);
end;
$$;

-- Set ready status
create or replace function public.shadow_set_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shadow_players
  set ready = p_ready, last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
end;
$$;

-- Set fighter cosmetic
create or replace function public.shadow_set_fighter(p_room_id uuid, p_fighter_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shadow_players
  set fighter_id = p_fighter_id, last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
end;
$$;

-- Start Shadow Battle match (server-side start anchor)
create or replace function public.shadow_start(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.shadow_rooms%rowtype;
  v_p0_ready boolean;
  v_p1_ready boolean;
  v_now timestamptz := clock_timestamp();
  v_start timestamptz := v_now + interval '3.5 seconds';
  v_deadline timestamptz := v_start + interval '90 seconds';
begin
  select * into v_room from public.shadow_rooms where id = p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'Only the host can start'; end if;

  select coalesce(bool_and(ready), false) into v_p0_ready from public.shadow_players where room_id = p_room_id and left_at is null;
  if not v_p0_ready then raise exception 'Not all players are ready'; end if;

  update public.shadow_rooms
  set status = 'countdown',
      starts_at = v_now,
      round_starts_at = v_start,
      round_deadline_at = v_deadline,
      updated_at = v_now
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object('room', to_jsonb(v_room));
end;
$$;

-- Append batch of combat events
create or replace function public.shadow_event_append(p_room_id uuid, p_events jsonb[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_inserted int := 0;
begin
  if not public.in_shadow(p_room_id) then raise exception 'Not a member of this room'; end if;

  foreach v_elem in array p_events loop
    insert into public.shadow_events (
      room_id, seat, seq, round, card_index, lane, outcome,
      t_start, t_end, keystrokes, errors, iki_mean, iki_stdev
    ) values (
      p_room_id,
      (v_elem->>'seat')::int,
      (v_elem->>'seq')::int,
      (v_elem->>'round')::int,
      (v_elem->>'card_index')::int,
      v_elem->>'lane',
      v_elem->>'outcome',
      (v_elem->>'t_start')::int,
      (v_elem->>'t_end')::int,
      (v_elem->>'keystrokes')::int,
      (v_elem->>'errors')::int,
      coalesce((v_elem->>'iki_mean')::real, 0),
      coalesce((v_elem->>'iki_stdev')::real, 0)
    )
    on conflict (room_id, seat, seq) do nothing;
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

-- Heartbeat
create or replace function public.shadow_heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shadow_players
  set last_seen_at = now(), connection = 'connected'
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;

-- Settle round (idempotent)
create or replace function public.shadow_settle_round(
  p_room_id uuid,
  p_round int,
  p_winner_seat int,
  p_hp_p0 int,
  p_hp_p1 int,
  p_reason text,
  p_duration_ms int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.shadow_rounds%rowtype;
begin
  if not public.in_shadow(p_room_id) then raise exception 'Unauthorized'; end if;

  insert into public.shadow_rounds (
    room_id, round, winner_seat, hp_p0, hp_p1, reason, duration_ms
  ) values (
    p_room_id, p_round, p_winner_seat, p_hp_p0, p_hp_p1, p_reason, p_duration_ms
  )
  on conflict (room_id, round) do nothing
  returning * into v_round;

  if p_winner_seat = 0 then
    update public.shadow_rooms set score_p0 = score_p0 + 1 where id = p_room_id;
  elsif p_winner_seat = 1 then
    update public.shadow_rooms set score_p1 = score_p1 + 1 where id = p_room_id;
  end if;

  return to_jsonb(v_round);
end;
$$;

-- Settle match & apply rating
create or replace function public.shadow_settle_match(
  p_room_id uuid,
  p_results jsonb[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_user_id uuid;
begin
  if not public.in_shadow(p_room_id) then raise exception 'Unauthorized'; end if;

  update public.shadow_rooms
  set status = 'finished', updated_at = now()
  where id = p_room_id;

  foreach v_elem in array p_results loop
    v_user_id := (v_elem->>'user_id')::uuid;

    insert into public.shadow_results (
      room_id, user_id, seat, outcome, rounds_won, rounds_lost,
      damage_dealt, damage_taken, best_chain, wpm, accuracy, clean_rate,
      client_hp, fr_before, fr_after, fr_delta, opponent_kind, bot_profile, flags
    ) values (
      p_room_id,
      v_user_id,
      (v_elem->>'seat')::int,
      v_elem->>'outcome',
      (v_elem->>'rounds_won')::int,
      (v_elem->>'rounds_lost')::int,
      (v_elem->>'damage_dealt')::int,
      (v_elem->>'damage_taken')::int,
      (v_elem->>'best_chain')::int,
      (v_elem->>'wpm')::real,
      (v_elem->>'accuracy')::real,
      (v_elem->>'clean_rate')::real,
      (v_elem->>'client_hp')::int,
      coalesce((v_elem->>'fr_before')::int, 1200),
      coalesce((v_elem->>'fr_after')::int, 1200),
      coalesce((v_elem->>'fr_delta')::int, 0),
      coalesce(v_elem->>'opponent_kind', 'human'),
      v_elem->>'bot_profile',
      coalesce(array(select jsonb_array_elements_text(v_elem->'flags')), '{}')
    )
    on conflict (room_id, user_id) do nothing;

    -- Update shadow_ratings if human opponent
    if coalesce(v_elem->>'opponent_kind', 'human') = 'human' then
      insert into public.shadow_ratings (
        user_id, fr, peak_fr, matches, wins, losses, draws,
        rounds_won, rounds_lost, damage_dealt, damage_taken
      ) values (
        v_user_id,
        coalesce((v_elem->>'fr_after')::int, 1200),
        coalesce((v_elem->>'fr_after')::int, 1200),
        1,
        case when v_elem->>'outcome' = 'win' then 1 else 0 end,
        case when v_elem->>'outcome' = 'loss' then 1 else 0 end,
        case when v_elem->>'outcome' = 'draw' then 1 else 0 end,
        (v_elem->>'rounds_won')::int,
        (v_elem->>'rounds_lost')::int,
        (v_elem->>'damage_dealt')::bigint,
        (v_elem->>'damage_taken')::bigint
      )
      on conflict (user_id) do update set
        fr = coalesce((v_elem->>'fr_after')::int, shadow_ratings.fr),
        peak_fr = greatest(shadow_ratings.peak_fr, coalesce((v_elem->>'fr_after')::int, shadow_ratings.fr)),
        matches = shadow_ratings.matches + 1,
        wins = shadow_ratings.wins + case when v_elem->>'outcome' = 'win' then 1 else 0 end,
        losses = shadow_ratings.losses + case when v_elem->>'outcome' = 'loss' then 1 else 0 end,
        draws = shadow_ratings.draws + case when v_elem->>'outcome' = 'draw' then 1 else 0 end,
        rounds_won = shadow_ratings.rounds_won + (v_elem->>'rounds_won')::int,
        rounds_lost = shadow_ratings.rounds_lost + (v_elem->>'rounds_lost')::int,
        damage_dealt = shadow_ratings.damage_dealt + (v_elem->>'damage_dealt')::bigint,
        damage_taken = shadow_ratings.damage_taken + (v_elem->>'damage_taken')::bigint,
        updated_at = now();
    end if;
  end loop;
end;
$$;

-- Forfeit
create or replace function public.shadow_forfeit(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.in_shadow(p_room_id) then raise exception 'Unauthorized'; end if;
  update public.shadow_rooms set status = 'abandoned', updated_at = now() where id = p_room_id;
end;
$$;

-- Leave lobby
create or replace function public.shadow_leave(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shadow_players
  set left_at = now()
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
end;
$$;

-- Close lobby (host only)
create or replace function public.shadow_close(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shadow_rooms
  set status = 'cancelled', updated_at = now()
  where id = p_room_id and host_id = auth.uid() and status = 'lobby';
end;
$$;

-- Match history
create or replace function public.shadow_match_history(p_limit int default 20, p_offset int default 0)
returns table (
  room_id uuid,
  created_at timestamptz,
  outcome text,
  rounds_won int,
  rounds_lost int,
  wpm real,
  accuracy real,
  fr_delta int,
  opponent_name text,
  opponent_avatar text,
  opponent_kind text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.room_id,
    r.created_at,
    r.outcome,
    r.rounds_won,
    r.rounds_lost,
    r.wpm,
    r.accuracy,
    r.fr_delta,
    coalesce(opp.display_name, r.bot_profile, 'Opponent') as opponent_name,
    opp.avatar as opponent_avatar,
    r.opponent_kind
  from public.shadow_results r
  left join public.shadow_players opp on opp.room_id = r.room_id and opp.user_id <> r.user_id
  where r.user_id = auth.uid()
  order by r.created_at desc
  limit p_limit offset p_offset;
$$;

-- Reaping stale rooms
create or replace function public.shadow_reap()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.shadow_rooms
  set status = 'expired', updated_at = now()
  where expires_at < now()
    and status in ('lobby', 'countdown', 'active', 'round_end', 'paused');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* ── 12. permissions ─────────────────────────────────────────────────────── */

revoke all on all tables in schema public from public, anon;
grant select on public.shadow_public_rooms to authenticated, anon;
grant select on public.shadow_leaderboard to authenticated, anon;
grant select on public.shadow_ratings to authenticated, anon;

grant select on public.shadow_rooms to authenticated;
grant select, update on public.shadow_players to authenticated;
grant select on public.shadow_events to authenticated;
grant select on public.shadow_rounds to authenticated;
grant select on public.shadow_results to authenticated;
grant select on public.shadow_unlocks to authenticated;
grant select on public.shadow_queue to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.arena_server_time() to authenticated, anon;
grant execute on function public.arena_code_lookup(text) to authenticated, anon;
grant execute on function public.shadow_create(text, text, boolean, text) to authenticated;
grant execute on function public.shadow_join(text, text) to authenticated;
grant execute on function public.shadow_set_ready(uuid, boolean) to authenticated;
grant execute on function public.shadow_set_fighter(uuid, text) to authenticated;
grant execute on function public.shadow_start(uuid) to authenticated;
grant execute on function public.shadow_event_append(uuid, jsonb[]) to authenticated;
grant execute on function public.shadow_heartbeat(uuid) to authenticated;
grant execute on function public.shadow_settle_round(uuid, int, int, int, int, text, int) to authenticated;
grant execute on function public.shadow_settle_match(uuid, jsonb[]) to authenticated;
grant execute on function public.shadow_forfeit(uuid) to authenticated;
grant execute on function public.shadow_leave(uuid) to authenticated;
grant execute on function public.shadow_close(uuid) to authenticated;
grant execute on function public.shadow_match_history(int, int) to authenticated;

/* ── 13. realtime publications ───────────────────────────────────────────── */

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shadow_rooms, public.shadow_players, public.shadow_rounds, public.shadow_events;
  end if;
end;
$$;
