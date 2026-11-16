-- Appearance is actor data; token rows contain placement and a public visual projection.
alter table public.actors
  add column token_asset_id uuid,
  add column token_ring text not null default 'gold'
    check (token_ring in ('gold','silver','emerald','sapphire','ruby','amethyst')),
  add column appearance_revision integer not null default 0,
  add foreign key (token_asset_id,game_id) references public.assets(id,game_id);
alter table public.tokens add column ring text not null default 'gold'
  check (ring in ('gold','silver','emerald','sapphire','ruby','amethyst'));
create index tokens_actor_idx on public.tokens(actor_id);
create index actors_token_asset_idx on public.actors(token_asset_id) where token_asset_id is not null;

-- Preserve a deterministic existing portrait. Different scene portraits now share this one.
update public.actors a set token_asset_id=(
  select t.asset_id from public.tokens t where t.actor_id=a.id and t.asset_id is not null
  order by t.id limit 1
);
update public.tokens t set asset_id=a.token_asset_id,ring=a.token_ring,label=a.name,
  revision=t.revision+1 from public.actors a where a.id=t.actor_id;

create function public.project_actor_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select a.token_asset_id,a.token_ring,a.name into new.asset_id,new.ring,new.label
    from public.actors a where a.id=new.actor_id and a.game_id=new.game_id;
  return new;
end; $$;
revoke all on function public.project_actor_token() from public,anon,authenticated;
create trigger token_appearance before insert or update on public.tokens
  for each row execute function public.project_actor_token();

create function public.sync_actor_tokens() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.token_asset_id,new.token_ring,new.name) is distinct from
     (old.token_asset_id,old.token_ring,old.name) then
    update public.tokens set asset_id=new.token_asset_id,ring=new.token_ring,
      label=new.name,revision=revision+1 where actor_id=new.id;
  end if;
  return null;
end; $$;
revoke all on function public.sync_actor_tokens() from public,anon,authenticated;
create trigger actor_token_appearance after update on public.actors
  for each row execute function public.sync_actor_tokens();

create function public.save_actor_appearance(
  p_game uuid,p_actor uuid,p_asset uuid,p_ring text,p_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.actors;
begin
  perform 1 from public.games where id=p_game for update;
  if not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  if a.id is null or (not public.is_gm(p_game) and a.owner_id<>auth.uid()) then
    raise exception 'Appearance edit denied';
  end if;
  if p_revision is null or a.appearance_revision<>p_revision then
    raise exception 'Appearance changed. Try again with the latest appearance.';
  end if;
  if p_ring is null or p_ring not in ('gold','silver','emerald','sapphire','ruby','amethyst') then
    raise exception 'Invalid token ring';
  end if;
  if p_asset is not null and not exists(
    select 1 from public.assets where id=p_asset and game_id=p_game and kind='token'
      and (public.is_gm(p_game) or owner_id=auth.uid() or id=a.token_asset_id)
  ) then raise exception 'Invalid token image'; end if;
  update public.actors set token_asset_id=p_asset,token_ring=p_ring,
    appearance_revision=appearance_revision+1 where id=a.id;
  return '{}'::jsonb;
end; $$;
revoke all on function public.save_actor_appearance(uuid,uuid,uuid,text,integer) from public,anon;
grant execute on function public.save_actor_appearance(uuid,uuid,uuid,text,integer) to authenticated;

create function public.place_actor_token(p_game uuid,p_actor uuid,p_scene uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.actors; s public.scenes; new_id uuid; gm boolean;
begin
  perform 1 from public.games where id=p_game for update;
  if not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  gm:=public.is_gm(p_game);
  select * into a from public.actors where id=p_actor and game_id=p_game;
  select * into s from public.scenes where id=p_scene and game_id=p_game;
  if a.id is null or s.id is null or (not gm and (a.owner_id<>auth.uid() or
    not exists(select 1 from public.games where id=p_game and active_scene_id=s.id))) then
    raise exception 'Token creation denied';
  end if;
  -- Player retries must not duplicate a token, including one currently concealed.
  -- GMs can place multiple instances of a monster.
  if not gm then
    select id into new_id from public.tokens where actor_id=a.id and scene_id=s.id order by id limit 1;
    if new_id is not null then return '{}'::jsonb; end if;
  end if;
  insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,x,y)
    values(p_game,s.id,a.id,a.owner_id,a.name,least(s.width/2,100),least(s.height/2,100))
    returning id into new_id;
  return '{}'::jsonb;
end; $$;
revoke all on function public.place_actor_token(uuid,uuid,uuid) from public,anon;
grant execute on function public.place_actor_token(uuid,uuid,uuid) to authenticated;

-- A sheet portrait is readable with its sheet, even before any scene placement.
drop policy assets_read on public.assets;
create policy assets_read on public.assets for select to authenticated using (
  public.is_member(game_id) and (public.is_gm(game_id) or (kind='token' and (
    owner_id=(select auth.uid()) or
    exists(select 1 from public.actors a where a.token_asset_id=assets.id) or
    exists(select 1 from public.tokens t where t.asset_id=assets.id and public.can_read_token(t.id))
  )))
);
