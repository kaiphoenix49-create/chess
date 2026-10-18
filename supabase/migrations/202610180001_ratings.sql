-- Ratings, clocks, and unfinished games that stay until quit or a result.
alter table public.games alter column expires_at drop not null;
alter table public.games alter column expires_at drop default;
alter table public.games add column white_ms integer not null default 900000;
alter table public.games add column black_ms integer not null default 900000;
alter table public.games add column clock_at timestamptz;
alter table public.games add column white_seen_at timestamptz;
alter table public.games add column black_seen_at timestamptz;
alter table public.games add column listed boolean not null default false;
alter table public.games add column draw_by uuid;
alter table public.games add column reason text;
update public.games set expires_at = null where status <> 'finished';

create table public.room_events (
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index room_events_user on public.room_events(user_id, created_at);
alter table public.room_events enable row level security;
revoke all on public.room_events from public, anon, authenticated;
grant all on public.room_events to service_role;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  human_rating double precision not null default 1500,
  human_rd double precision not null default 350,
  human_vol double precision not null default 0.06,
  human_games integer not null default 0,
  human_wins integer not null default 0,
  human_losses integer not null default 0,
  human_draws integer not null default 0,
  engine_rating double precision not null default 1500,
  engine_rd double precision not null default 350,
  engine_vol double precision not null default 0.06,
  engine_games integer not null default 0,
  engine_wins integer not null default 0,
  engine_losses integer not null default 0,
  engine_draws integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
create policy "Read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create table public.game_records (
  id uuid primary key default gen_random_uuid(),
  game_id uuid unique,
  pool text not null check (pool in ('human', 'engine')),
  white_id uuid,
  black_id uuid,
  result text not null,
  reason text,
  moves jsonb not null default '[]'::jsonb,
  difficulty integer,
  white_before double precision,
  white_after double precision,
  black_before double precision,
  black_after double precision,
  created_at timestamptz not null default now()
);
create index game_records_white on public.game_records(white_id, created_at desc);
create index game_records_black on public.game_records(black_id, created_at desc);
alter table public.game_records enable row level security;
revoke all on public.game_records from public, anon, authenticated;
grant select on public.game_records to authenticated;
grant all on public.game_records to service_role;
create policy "Read own records" on public.game_records for select to authenticated
  using ((select auth.uid()) = white_id or (select auth.uid()) = black_id);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

create function public.ensure_profile(p_user uuid, p_name text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare row public.profiles;
begin
  insert into public.profiles(user_id, display_name)
    values (p_user, left(nullif(btrim(p_name), ''), 80))
    on conflict (user_id) do update
      set display_name = coalesce(public.profiles.display_name, excluded.display_name)
    returning * into row;
  return row;
end $$;

-- The clock runs only while the player to move has checked in during the last 20 seconds.
create function public.tick_clock(g public.games, p_user uuid) returns public.games
language plpgsql set search_path = '' as $$
declare
  white_turn boolean := mod(jsonb_array_length(g.moves), 2) = 0;
  their_turn boolean;
  elapsed integer;
begin
  if p_user = g.white_id then g.white_seen_at := now();
  elsif p_user is not distinct from g.black_id then g.black_seen_at := now();
  end if;
  their_turn := g.status = 'active' and g.black_id is not null
    and ((white_turn and p_user = g.white_id) or (not white_turn and p_user = g.black_id));
  if not their_turn then return g; end if;
  -- clock_at moves only while this player is checking in, so a closed browser pauses the clock.
  if g.clock_at is not null and now() - g.clock_at <= interval '20 seconds' then
    elapsed := floor(extract(epoch from (now() - g.clock_at)) * 1000)::integer;
    if white_turn then g.white_ms := g.white_ms - elapsed; else g.black_ms := g.black_ms - elapsed; end if;
    if (white_turn and g.white_ms <= 0) or (not white_turn and g.black_ms <= 0) then
      if white_turn then g.white_ms := 0; else g.black_ms := 0; end if;
      g.status := 'finished';
      g.result := case when white_turn then '0-1' else '1-0' end;
      g.reason := 'time';
      g.expires_at := now() + interval '1 day';
      g.version := g.version + 1;
    end if;
  end if;
  g.clock_at := now();
  g.updated_at := now();
  return g;
end $$;

create or replace function public.create_game(p_user uuid, p_minutes integer) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games; ms integer;
begin
  if p_minutes not in (5, 10, 15) then raise exception 'Choose 5, 10, or 15 minutes.'; end if;
  ms := p_minutes * 60000;
  perform pg_advisory_xact_lock(736421);
  delete from public.games where id in (select id from public.games where expires_at is not null and expires_at < now() limit 100);
  select * into g from public.games
    where expires_at is null and status in ('waiting', 'active') and (white_id = p_user or black_id = p_user)
    order by updated_at desc limit 1;
  if found then return g; end if;
  if (select count(*) from public.games) >= 5000 then raise exception 'Online rooms are at capacity. Please try later.'; end if;
  if (select count(*) from public.room_events where user_id = p_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Room limit reached. Please try again in an hour.';
  end if;
  insert into public.room_events(user_id) values (p_user);
  insert into public.games(white_id, expires_at, white_ms, black_ms, listed)
    values (p_user, null, ms, ms, false) returning * into g;
  return g;
end $$;

create or replace function public.create_game(p_user uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
begin
  return public.create_game(p_user, 15);
end $$;

create function public.seek_game(p_user uuid, p_minutes integer) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games; ms integer;
begin
  if p_minutes not in (5, 10, 15) then raise exception 'Choose 5, 10, or 15 minutes.'; end if;
  ms := p_minutes * 60000;
  perform pg_advisory_xact_lock(736421);
  delete from public.games where id in (select id from public.games where expires_at is not null and expires_at < now() limit 100);
  select * into g from public.games
    where expires_at is null and status in ('waiting', 'active') and (white_id = p_user or black_id = p_user)
    order by updated_at desc limit 1;
  if found then return g; end if;
  select * into g from public.games
    where listed and status = 'waiting' and black_id is null and white_id <> p_user and expires_at is null
    order by created_at for update limit 1;
  if found then
    update public.games set black_id = p_user, status = 'active', version = version + 1, updated_at = now()
      where id = g.id returning * into g;
    return g;
  end if;
  if (select count(*) from public.games) >= 5000 then raise exception 'Online rooms are at capacity. Please try later.'; end if;
  if (select count(*) from public.room_events where user_id = p_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Room limit reached. Please try again in an hour.';
  end if;
  insert into public.room_events(user_id) values (p_user);
  insert into public.games(white_id, expires_at, white_ms, black_ms, listed)
    values (p_user, null, ms, ms, true) returning * into g;
  return g;
end $$;

create or replace function public.join_game(p_id uuid, p_user uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  if exists (
    select 1 from public.games where id <> p_id and expires_at is null and status in ('waiting', 'active')
      and (white_id = p_user or black_id = p_user)
  ) then raise exception 'Quit your current game first.'; end if;
  select * into g from public.games where id = p_id for update;
  if not found or (g.expires_at is not null and g.expires_at <= now()) then raise exception 'Game unavailable or expired.'; end if;
  if p_user = g.white_id or p_user = g.black_id then return g; end if;
  if g.black_id is not null or g.status <> 'waiting' then raise exception 'Both seats are already taken.'; end if;
  update public.games set black_id = p_user, status = 'active', version = version + 1, updated_at = now()
    where id = p_id returning * into g;
  return g;
end $$;

create or replace function public.commit_move(p_id uuid, p_user uuid, p_version integer, p_move text, p_fen text, p_result text)
returns public.games language plpgsql security definer set search_path = '' as $$
declare g public.games; opponent_present boolean;
begin
  select * into g from public.games where id = p_id for update;
  if not found or (g.expires_at is not null and g.expires_at <= now()) then raise exception 'Game unavailable or expired.'; end if;
  if p_user <> g.white_id and p_user is distinct from g.black_id then raise exception 'You are not a player in this game.'; end if;
  if g.status <> 'active' then raise exception 'This game is not active.'; end if;
  if g.version <> p_version then raise exception 'The board changed. Please try your move again.'; end if;
  if (jsonb_array_length(g.moves) % 2 = 0 and p_user <> g.white_id)
     or (jsonb_array_length(g.moves) % 2 = 1 and p_user <> g.black_id) then raise exception 'It is not your turn.'; end if;
  g := public.tick_clock(g, p_user);
  if g.status = 'finished' then
    update public.games set white_ms = g.white_ms, black_ms = g.black_ms, clock_at = g.clock_at,
      white_seen_at = g.white_seen_at, black_seen_at = g.black_seen_at, status = g.status, result = g.result,
      reason = g.reason, expires_at = g.expires_at, version = g.version, updated_at = now()
      where id = p_id returning * into g;
    return g;
  end if;
  if jsonb_array_length(g.moves) >= 1024 then raise exception 'Move limit reached.'; end if;
  opponent_present := case when p_user = g.white_id then g.black_seen_at else g.white_seen_at end is not null
    and now() - case when p_user = g.white_id then g.black_seen_at else g.white_seen_at end <= interval '20 seconds';
  update public.games set moves = moves || jsonb_build_array(p_move), fen = p_fen, draw_by = null,
    white_ms = g.white_ms, black_ms = g.black_ms, white_seen_at = g.white_seen_at, black_seen_at = g.black_seen_at,
    clock_at = case when opponent_present then now() else null end,
    result = p_result, reason = case when p_result is null then null when p_result = '1/2-1/2' and jsonb_array_length(moves) + 1 >= 1024 then 'move-limit' when p_result = '1/2-1/2' then 'draw' else 'checkmate' end,
    status = case when p_result is null then 'active' else 'finished' end,
    expires_at = case when p_result is null then null else now() + interval '1 day' end,
    version = version + 1, updated_at = now() where id = p_id returning * into g;
  return g;
end $$;

create function public.touch_game(p_id uuid, p_user uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if not found or (g.expires_at is not null and g.expires_at <= now()) then raise exception 'Game unavailable or expired.'; end if;
  if p_user <> g.white_id and p_user is distinct from g.black_id then raise exception 'You are not a player in this game.'; end if;
  g := public.tick_clock(g, p_user);
  update public.games set white_ms = g.white_ms, black_ms = g.black_ms, clock_at = g.clock_at,
    white_seen_at = g.white_seen_at, black_seen_at = g.black_seen_at, status = g.status, result = g.result,
    reason = g.reason, expires_at = g.expires_at, version = g.version, updated_at = now()
    where id = p_id returning * into g;
  return g;
end $$;

create function public.resign_game(p_id uuid, p_user uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if not found or (g.expires_at is not null and g.expires_at <= now()) then raise exception 'Game unavailable or expired.'; end if;
  if p_user <> g.white_id and p_user is distinct from g.black_id then raise exception 'You are not a player in this game.'; end if;
  if g.status <> 'active' then raise exception 'This game is not active.'; end if;
  update public.games set status = 'finished', reason = 'resign', draw_by = null,
    result = case when p_user = white_id then '0-1' else '1-0' end,
    expires_at = now() + interval '1 day', version = version + 1, updated_at = now()
    where id = p_id returning * into g;
  return g;
end $$;

create function public.quit_game(p_id uuid, p_user uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if not found then raise exception 'Game unavailable or expired.'; end if;
  if p_user <> g.white_id and p_user is distinct from g.black_id then raise exception 'You are not a player in this game.'; end if;
  if g.status = 'waiting' and g.black_id is null and p_user = g.white_id then
    delete from public.games where id = p_id;
    return null;
  end if;
  return public.resign_game(p_id, p_user);
end $$;

create function public.offer_draw(p_id uuid, p_user uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if not found or g.status <> 'active' then raise exception 'This game is not active.'; end if;
  if p_user <> g.white_id and p_user is distinct from g.black_id then raise exception 'You are not a player in this game.'; end if;
  if g.draw_by is not null then raise exception 'A draw offer is already waiting.'; end if;
  update public.games set draw_by = p_user, version = version + 1, updated_at = now() where id = p_id returning * into g;
  return g;
end $$;

create function public.answer_draw(p_id uuid, p_user uuid, p_accept boolean) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if not found or g.status <> 'active' then raise exception 'This game is not active.'; end if;
  if p_user <> g.white_id and p_user is distinct from g.black_id then raise exception 'You are not a player in this game.'; end if;
  if g.draw_by is null or g.draw_by = p_user then raise exception 'There is no draw offer to answer.'; end if;
  if not p_accept then
    update public.games set draw_by = null, version = version + 1, updated_at = now() where id = p_id returning * into g;
    return g;
  end if;
  update public.games set status = 'finished', result = '1/2-1/2', reason = 'agreement', draw_by = null,
    expires_at = now() + interval '1 day', version = version + 1, updated_at = now()
    where id = p_id returning * into g;
  return g;
end $$;

create function public.apply_human_result(
  p_game uuid,
  p_white_rating double precision, p_white_rd double precision, p_white_vol double precision, p_white_games integer,
  p_black_rating double precision, p_black_rd double precision, p_black_vol double precision, p_black_games integer
) returns public.game_records language plpgsql security definer set search_path = '' as $$
declare g public.games; existing public.game_records; white public.profiles; black public.profiles;
  first uuid; second uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.status <> 'finished' or g.black_id is null or g.result is null then raise exception 'This game is not ready to rate.'; end if;
  select * into existing from public.game_records where game_id = p_game;
  if found then return existing; end if;
  insert into public.profiles(user_id) values (g.white_id) on conflict do nothing;
  insert into public.profiles(user_id) values (g.black_id) on conflict do nothing;
  if g.white_id < g.black_id then first := g.white_id; second := g.black_id; else first := g.black_id; second := g.white_id; end if;
  perform 1 from public.profiles where user_id = first for update;
  perform 1 from public.profiles where user_id = second for update;
  select * into existing from public.game_records where game_id = p_game;
  if found then return existing; end if;
  select * into white from public.profiles where user_id = g.white_id;
  select * into black from public.profiles where user_id = g.black_id;
  if white.human_games <> p_white_games or black.human_games <> p_black_games then raise exception 'retry'; end if;
  update public.profiles set human_rating = p_white_rating, human_rd = p_white_rd, human_vol = p_white_vol,
    human_games = human_games + 1,
    human_wins = human_wins + case when g.result = '1-0' then 1 else 0 end,
    human_losses = human_losses + case when g.result = '0-1' then 1 else 0 end,
    human_draws = human_draws + case when g.result = '1/2-1/2' then 1 else 0 end,
    updated_at = now() where user_id = g.white_id;
  update public.profiles set human_rating = p_black_rating, human_rd = p_black_rd, human_vol = p_black_vol,
    human_games = human_games + 1,
    human_wins = human_wins + case when g.result = '0-1' then 1 else 0 end,
    human_losses = human_losses + case when g.result = '1-0' then 1 else 0 end,
    human_draws = human_draws + case when g.result = '1/2-1/2' then 1 else 0 end,
    updated_at = now() where user_id = g.black_id;
  insert into public.game_records(game_id, pool, white_id, black_id, result, reason, moves, white_before, white_after, black_before, black_after)
    values (g.id, 'human', g.white_id, g.black_id, g.result, g.reason, g.moves, white.human_rating, p_white_rating, black.human_rating, p_black_rating)
    returning * into existing;
  return existing;
end $$;

create function public.apply_engine_result(
  p_record uuid, p_user uuid, p_color text, p_result text, p_reason text, p_moves jsonb, p_difficulty integer,
  p_rating double precision, p_rd double precision, p_vol double precision, p_games integer,
  p_before double precision, p_opponent double precision
) returns public.game_records language plpgsql security definer set search_path = '' as $$
declare existing public.game_records; player public.profiles;
begin
  insert into public.profiles(user_id) values (p_user) on conflict do nothing;
  select * into player from public.profiles where user_id = p_user for update;
  select * into existing from public.game_records where game_id = p_record;
  if found then return existing; end if;
  if player.engine_games <> p_games then raise exception 'retry'; end if;
  update public.profiles set engine_rating = p_rating, engine_rd = p_rd, engine_vol = p_vol,
    engine_games = engine_games + 1,
    engine_wins = engine_wins + case when (p_color = 'w' and p_result = '1-0') or (p_color = 'b' and p_result = '0-1') then 1 else 0 end,
    engine_losses = engine_losses + case when (p_color = 'w' and p_result = '0-1') or (p_color = 'b' and p_result = '1-0') then 1 else 0 end,
    engine_draws = engine_draws + case when p_result = '1/2-1/2' then 1 else 0 end,
    updated_at = now() where user_id = p_user;
  insert into public.game_records(id, game_id, pool, white_id, black_id, result, reason, moves, difficulty, white_before, white_after, black_before, black_after)
    values (p_record, p_record, 'engine',
      case when p_color = 'w' then p_user else null end, case when p_color = 'b' then p_user else null end,
      p_result, p_reason, p_moves, p_difficulty,
      case when p_color = 'w' then p_before else p_opponent end, case when p_color = 'w' then p_rating else p_opponent end,
      case when p_color = 'b' then p_before else p_opponent end, case when p_color = 'b' then p_rating else p_opponent end)
    returning * into existing;
  return existing;
end $$;

drop policy "Players read their games" on public.games;
create policy "Players read their games" on public.games for select to authenticated
  using ((select auth.uid()) in (white_id, black_id) and (expires_at is null or expires_at > now()));

revoke all on function public.tick_clock(public.games, uuid) from public, anon, authenticated;
revoke all on function public.create_game(uuid, integer) from public, anon, authenticated;
revoke all on function public.seek_game(uuid, integer) from public, anon, authenticated;
revoke all on function public.touch_game(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resign_game(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quit_game(uuid, uuid) from public, anon, authenticated;
revoke all on function public.offer_draw(uuid, uuid) from public, anon, authenticated;
revoke all on function public.answer_draw(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.ensure_profile(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_human_result(uuid, double precision, double precision, double precision, integer, double precision, double precision, double precision, integer) from public, anon, authenticated;
revoke all on function public.apply_engine_result(uuid, uuid, text, text, text, jsonb, integer, double precision, double precision, double precision, integer, double precision, double precision) from public, anon, authenticated;
grant execute on function public.create_game(uuid, integer) to service_role;
grant execute on function public.seek_game(uuid, integer) to service_role;
grant execute on function public.touch_game(uuid, uuid) to service_role;
grant execute on function public.resign_game(uuid, uuid) to service_role;
grant execute on function public.quit_game(uuid, uuid) to service_role;
grant execute on function public.offer_draw(uuid, uuid) to service_role;
grant execute on function public.answer_draw(uuid, uuid, boolean) to service_role;
grant execute on function public.ensure_profile(uuid, text) to service_role;
grant execute on function public.apply_human_result(uuid, double precision, double precision, double precision, integer, double precision, double precision, double precision, integer) to service_role;
grant execute on function public.apply_engine_result(uuid, uuid, text, text, text, jsonb, integer, double precision, double precision, double precision, integer, double precision, double precision) to service_role;
