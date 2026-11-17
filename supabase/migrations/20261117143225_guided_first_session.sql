-- Spawn coordinates are GM-private, including while concealed. Never replicate this table.
create index rolls_game_author_idx on public.rolls(game_id,author_id);
create index invitations_game_live_idx on public.invitations(game_id,expires_at) where not revoked;
create table public.party_spawns (
  scene_id uuid primary key,
  game_id uuid not null references public.games on delete cascade,
  x double precision not null check (x >= 0 and x < 4096),
  y double precision not null check (y >= 0 and y < 4096),
  foreign key (scene_id,game_id) references public.scenes(id,game_id) on delete cascade
);
create index party_spawns_game_idx on public.party_spawns(game_id);
alter table public.party_spawns enable row level security;
revoke all on public.party_spawns from public,anon,authenticated;
grant select on public.party_spawns to authenticated;
create policy party_spawns_read on public.party_spawns for select to authenticated
  using (public.is_gm(game_id));

create table public.placement_receipts (
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  primary key(game_id,user_id,operation_id)
);
create index placement_receipts_user_idx on public.placement_receipts(user_id);
alter table public.placement_receipts enable row level security;
revoke all on public.placement_receipts from public,anon,authenticated;

alter table public.scenes add column calibrated boolean not null default false;
update public.scenes set calibrated=true where units_per_pixel<>1 or unit<>'units';
create function public.mark_scene_calibrated() returns trigger
language plpgsql set search_path='' as $$
begin
  new.calibrated:=true;
  return new;
end; $$;
revoke all on function public.mark_scene_calibrated() from public,anon,authenticated;
-- mutate_game sets scale columns even for fog edits. Only actual scale changes count.
create trigger scene_calibrated before update on public.scenes
  for each row when (old.units_per_pixel is distinct from new.units_per_pixel or old.unit is distinct from new.unit)
  execute function public.mark_scene_calibrated();

create function public.onboarding_command(p_game uuid,p_command text,p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.scenes; a public.actors; px double precision; py double precision;
  gm boolean; previous jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  gm:=public.is_gm(p_game);
  if p is null or pg_column_size(p)>2000 then raise exception 'Invalid request'; end if;
  if p_command not in ('token_place','party_spawn','scene_calibrate') or p_command is null then raise exception 'Unknown command'; end if;
  if p_command='token_place' then
    if p->>'operation_id' is null then raise exception 'Operation required'; end if;
    select request into previous from public.placement_receipts
      where game_id=p_game and user_id=auth.uid() and operation_id=(p->>'operation_id')::uuid;
    if found then
      if previous<>p then raise exception 'Operation already used'; end if;
      return '{"confirmed":"true"}'::jsonb;
    end if;
  end if;
  select * into s from public.scenes where id=(p->>'scene_id')::uuid and game_id=p_game;
  if s.id is null or not exists(select 1 from public.games where id=p_game and active_scene_id=s.id) then
    raise exception 'Active scene changed';
  end if;
  if p->>'revision' is null or s.revision<>(p->>'revision')::integer then raise exception 'Scene changed. Review the latest map.'; end if;
  if p_command='scene_calibrate' then
    if not gm then raise exception 'GM required'; end if;
    if p->>'units_per_pixel' is null or p->>'unit' is null then raise exception 'Scale and unit required'; end if;
    update public.scenes set units_per_pixel=(p->>'units_per_pixel')::double precision,
      unit=trim(p->>'unit'),calibrated=true,revision=revision+1 where id=s.id;
    return '{"confirmed":"true"}'::jsonb;
  end if;
  if p_command='party_spawn' then
    if not gm then raise exception 'GM required'; end if;
    px:=(p->>'x')::double precision; py:=(p->>'y')::double precision;
  else
    select * into a from public.actors where id=(p->>'actor_id')::uuid and game_id=p_game;
    if a.id is null or (not gm and (a.owner_id<>auth.uid() or a.kind<>'character')) then raise exception 'Token creation denied'; end if;
    if (p ? 'x')<>(p ? 'y') then raise exception 'Choose both coordinates'; end if;
    if p ? 'x' then
      px:=(p->>'x')::double precision; py:=(p->>'y')::double precision;
    else
      select x,y into px,py from public.party_spawns where scene_id=s.id;
      px:=coalesce(px,s.width/2.0); py:=coalesce(py,s.height/2.0);
    end if;
  end if;
  if px is null or py is null or not (px>=0 and px<s.width and py>=0 and py<s.height) then raise exception 'Position is outside the scene'; end if;
  if p_command='party_spawn' then
    insert into public.party_spawns values(s.id,p_game,px,py)
      on conflict(scene_id) do update set x=excluded.x,y=excluded.y;
    update public.scenes set revision=revision+1 where id=s.id;
  else
    -- Concealed or other-scene locations never leave the server. Players may only place
    -- into revealed space; hidden existing placements remain indistinguishable.
    if not gm and not public.point_visible(s.fog,px,py) then raise exception 'Placement unavailable. Ask the GM to reveal a party area or choose a revealed point.'; end if;
    if gm or not exists(select 1 from public.tokens where actor_id=a.id and scene_id=s.id) then
      insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,x,y)
        values(p_game,s.id,a.id,a.owner_id,a.name,px,py);
    end if;
    insert into public.placement_receipts values(p_game,auth.uid(),(p->>'operation_id')::uuid,p);
  end if;
  return '{"confirmed":"true"}'::jsonb;
end; $$;
revoke all on function public.onboarding_command(uuid,text,jsonb) from public,anon;
grant execute on function public.onboarding_command(uuid,text,jsonb) to authenticated;

-- Backwards-compatible callers keep their authorization and duplicate behavior.
-- Replace only the old top-left default, not existing placements.
create or replace function public.place_actor_token(p_game uuid,p_actor uuid,p_scene uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.actors; s public.scenes; px double precision; py double precision;
begin
  perform 1 from public.games where id=p_game for update;
  if not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  select * into s from public.scenes where id=p_scene and game_id=p_game;
  if a.id is null or s.id is null or (not public.is_gm(p_game) and
    (a.owner_id<>auth.uid() or not exists(select 1 from public.games where id=p_game and active_scene_id=s.id))) then
    raise exception 'Token creation denied';
  end if;
  if not public.is_gm(p_game) and exists(select 1 from public.tokens where actor_id=a.id and scene_id=s.id) then return '{}'::jsonb; end if;
  select x,y into px,py from public.party_spawns where scene_id=s.id;
  insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,x,y)
    values(p_game,s.id,a.id,a.owner_id,a.name,coalesce(px,s.width/2.0),coalesce(py,s.height/2.0));
  return '{}'::jsonb;
end; $$;
