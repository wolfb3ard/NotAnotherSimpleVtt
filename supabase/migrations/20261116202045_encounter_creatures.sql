-- Existing tokens remain linked to their actor. Only the explicit new command
-- creates independent actors; PCs keep their cross-scene shared sheet.
alter table public.actors
  add column encounter_instance boolean not null default false,
  add column definition_actor_id uuid,
  add column appearance_source_id uuid,
  add foreign key (definition_actor_id,game_id) references public.actors(id,game_id)
    on delete set null (definition_actor_id),
  add foreign key (appearance_source_id,game_id) references public.actors(id,game_id)
    on delete set null (appearance_source_id);
create index actors_definition_idx on public.actors(definition_actor_id) where definition_actor_id is not null;
create index actors_appearance_source_idx on public.actors(appearance_source_id) where appearance_source_id is not null;

-- Appearance follows the definition until explicitly changed on this instance.
-- Name, sheet, HP and counters are NEVER propagated.
create function public.sync_creature_appearance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.token_asset_id,new.token_ring) is distinct from (old.token_asset_id,old.token_ring) then
    update public.actors set token_asset_id=new.token_asset_id,token_ring=new.token_ring,
      appearance_revision=appearance_revision+1 where appearance_source_id=new.id;
  end if;
  return null;
end; $$;
revoke all on function public.sync_creature_appearance() from public,anon,authenticated;
create trigger sync_creature_appearance after update on public.actors
  for each row execute function public.sync_creature_appearance();

-- Preserve all existing appearance validation, then detach on a successful
-- explicit instance edit (even if the selected appearance is unchanged).
alter function public.save_actor_appearance(uuid,uuid,uuid,text,integer) rename to save_actor_appearance_base;
revoke all on function public.save_actor_appearance_base(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
create function public.save_actor_appearance(p_game uuid,p_actor uuid,p_asset uuid,p_ring text,p_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result:=public.save_actor_appearance_base(p_game,p_actor,p_asset,p_ring,p_revision);
  update public.actors set appearance_source_id=null where id=p_actor and game_id=p_game;
  return result;
end; $$;
revoke all on function public.save_actor_appearance(uuid,uuid,uuid,text,integer) from public,anon;
grant execute on function public.save_actor_appearance(uuid,uuid,uuid,text,integer) to authenticated;

-- Private permanent receipts prevent a lost response/reconnect from adding a
-- second group. Authorization is rechecked before any receipt is returned.
create table public.creature_creation_receipts (
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key (game_id,user_id,operation_id)
);
create index creature_creation_receipts_user_idx on public.creature_creation_receipts(user_id);
alter table public.creature_creation_receipts enable row level security;
revoke all on public.creature_creation_receipts from public,anon,authenticated;

-- As with mutate_game, definer is required because browser roles cannot write.
create function public.create_encounter_creatures(
  p_game uuid,p_scene uuid,p_operation uuid,p_count integer,
  p_source uuid default null,p_revision integer default null,
  p_name text default null,p_sheet jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  source public.actors; s public.scenes; receipt public.creature_creation_receipts;
  request jsonb:=jsonb_build_object('scene',p_scene,'count',p_count,'source',p_source,
    'revision',p_revision,'name',p_name,'sheet',p_sheet);
  doc jsonb; base_name text; label text; a uuid; first_id uuid; i integer; suffix integer:=1;
  result jsonb; appearance_source uuid;
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) or not public.is_gm(p_game) then
    raise exception 'GM required';
  end if;
  if p_operation is null or p_count is null or p_count not between 1 and 20 or
    pg_column_size(request)>200000 then raise exception 'Invalid creature request'; end if;
  select * into receipt from public.creature_creation_receipts
    where game_id=p_game and user_id=auth.uid() and operation_id=p_operation;
  if receipt.game_id is not null then
    if receipt.request is distinct from request then raise exception 'Operation already used for another group'; end if;
    return receipt.result;
  end if;
  select * into s from public.scenes where id=p_scene and game_id=p_game;
  if s.id is null then raise exception 'Scene unavailable'; end if;
  if p_source is not null then
    if p_sheet is not null or p_name is not null then raise exception 'Choose a source or a new definition'; end if;
    select * into source from public.actors where id=p_source and game_id=p_game;
    if source.id is null or source.kind='character' then raise exception 'Choose an NPC or enemy definition'; end if;
    if p_revision is null or p_revision<>source.revision then raise exception 'Definition changed. Reload before adding creatures.'; end if;
    doc:=source.sheet;
    base_name:=source.name;
    appearance_source:=coalesce(source.appearance_source_id,source.id);
  else
    if p_name is null or length(trim(p_name)) not between 1 and 100 or
      p_sheet is null or not public.valid_sheet(p_sheet) then raise exception 'Invalid creature definition'; end if;
    doc:=p_sheet; base_name:=trim(p_name);
  end if;
  for i in 1..p_count loop
    loop
      label:=left(base_name,90)||' '||suffix::text;
      suffix:=suffix+1;
      exit when not exists(select 1 from public.actors where game_id=p_game and name=label);
    end loop;
    insert into public.actors(game_id,owner_id,name,kind,sheet,encounter_instance,
      definition_actor_id,appearance_source_id,token_asset_id,token_ring)
      values(p_game,auth.uid(),label,coalesce(source.kind,'enemy'),doc,true,
        source.id,appearance_source,source.token_asset_id,coalesce(source.token_ring,'gold'))
      returning id into a;
    first_id:=coalesce(first_id,a);
    insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,x,y,hidden)
      values(p_game,s.id,a,auth.uid(),label,
        least(s.width-1,greatest(0,s.width/2+((i-1)%5)*52)),
        least(s.height-1,greatest(0,s.height/2+((i-1)/5)*52)),true);
  end loop;
  result:=jsonb_build_object('id',first_id::text,'count',p_count::text);
  insert into public.creature_creation_receipts values(p_game,auth.uid(),p_operation,request,result);
  return result;
end; $$;
revoke all on function public.create_encounter_creatures(uuid,uuid,uuid,integer,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.create_encounter_creatures(uuid,uuid,uuid,integer,uuid,integer,text,jsonb) to authenticated;
