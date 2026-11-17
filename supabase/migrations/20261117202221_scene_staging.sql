-- Group contents are immutable snapshots; clients only need the GM-only summary.
create table public.encounter_groups (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  creatures jsonb not null check(jsonb_array_length(creatures) between 1 and 20),
  labels text[] not null
);
create index encounter_groups_game on public.encounter_groups(game_id);
alter table public.encounter_groups enable row level security;
revoke all on public.encounter_groups from public,anon,authenticated;
grant select(id,game_id,name,labels) on public.encounter_groups to authenticated;
create policy gm_groups on public.encounter_groups for select to authenticated using(public.is_gm(game_id));

create function public.stage_scene(p_game uuid,p_command text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare live uuid; s public.scenes; grp public.encounter_groups; item jsonb; aid uuid;
  names text[]; members jsonb; i integer:=0; px float8; py float8; new_id uuid;
begin
  select active_scene_id into live from public.games where id=p_game for update;
  if not public.is_gm(p_game) or auth.uid() is null then raise exception 'GM required'; end if;
  if p_command='scene_draft' then
    insert into public.scenes(game_id,name,asset_id,width,height)
      select p_game,p->>'name',id,width,height from public.assets
      where id=(p->>'asset_id')::uuid and game_id=p_game and kind='background' returning id into new_id;
    if not found then raise exception 'Invalid background'; end if;
    return jsonb_build_object('id',new_id);
  end if;
  select * into strict s from public.scenes where game_id=p_game and id=(p->>'scene_id')::uuid;
  if p_command='scene_publish' then
    if not (p ? 'previous') or live is distinct from (p->>'previous')::uuid or
       s.revision is distinct from (p->>'revision')::int then raise exception 'Scene changed. Review before showing.'; end if;
    if (p->>'party')::boolean and live is distinct from s.id then
      -- Reuse actor IDs and existing destination placements. No sheet writes.
      insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,x,y,size,hidden)
        select distinct on(a.id) p_game,s.id,a.id,t.controller_id,a.name,
          coalesce(sp.x,s.width/2.0),coalesce(sp.y,s.height/2.0),t.size,t.hidden
        from public.tokens t join public.actors a on a.id=t.actor_id
        left join public.party_spawns sp on sp.scene_id=s.id
        where t.game_id=p_game and t.scene_id=live and a.kind='character'
          and not exists(select 1 from public.tokens d where d.scene_id=s.id and d.actor_id=a.id)
        order by a.id,t.hidden,t.id;
    end if;
    update public.games set active_scene_id=s.id where id=p_game;
  elsif p_command='group_save' then
    select jsonb_agg(jsonb_build_object('name',a.name,'kind',a.kind,'sheet',a.sheet,'asset',a.token_asset_id,
       'ring',a.token_ring,'size',t.size,'x',t.x,'y',t.y) order by t.id),array_agg(a.name order by t.id)
      into members,names from public.tokens t join public.actors a on a.id=t.actor_id
      where t.scene_id=s.id and a.kind<>'character';
    if members is null or jsonb_array_length(members)>20 then raise exception 'Choose a scene with 1–20 NPC or enemy tokens'; end if;
    insert into public.encounter_groups(game_id,name,creatures,labels) values(p_game,p->>'name',members,names);
  elsif p_command='group_place' then
    select * into strict grp from public.encounter_groups where id=(p->>'group_id')::uuid and game_id=p_game;
    if p ? 'member' and (p->>'member')::int not between 0 and jsonb_array_length(grp.creatures)-1 then raise exception 'Unknown member'; end if;
    px:=coalesce((p->>'x')::float8,s.width/2.0); py:=coalesce((p->>'y')::float8,s.height/2.0);
    if not(px>=0 and py>=0 and px<s.width and py<s.height) then raise exception 'Drop inside the map'; end if;
    for item in select value from jsonb_array_elements(grp.creatures) loop
      if not(p ? 'member') or (p->>'member')::int=i then
        insert into public.actors(game_id,owner_id,name,kind,sheet,encounter_instance,token_asset_id,token_ring)
        values(p_game,auth.uid(),item->>'name',item->>'kind',item->'sheet',true,(item->>'asset')::uuid,item->>'ring') returning id into aid;
        insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,x,y,size,hidden)
        values(p_game,s.id,aid,auth.uid(),item->>'name',
          greatest(0,least(s.width-1,px+case when p ? 'member' then 0 else (item->>'x')::float8-(grp.creatures->0->>'x')::float8 end)),
          greatest(0,least(s.height-1,py+case when p ? 'member' then 0 else (item->>'y')::float8-(grp.creatures->0->>'y')::float8 end)),
          (item->>'size')::int,true);
      end if;
      i:=i+1;
    end loop;
  else raise exception 'Unknown staging command';
  end if;
  return '{"confirmed":"true"}'::jsonb;
end; $$;
revoke all on function public.stage_scene(uuid,text,jsonb) from public,anon;
grant execute on function public.stage_scene(uuid,text,jsonb) to authenticated;

create or replace function public.tabletop_command(p_game uuid,p_command text,p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid:=auth.uid(); sid uuid:=(p->>'scene_id')::uuid;
  h public.tabletop_history; t public.tokens; s public.scenes;
  target uuid; inverse jsonb; next_revision integer; history jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if uid is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  if sid is null or not exists(select 1 from public.games where id=p_game and case when coalesce((p->>'preparing')::boolean,false) then public.is_gm(p_game) and active_scene_id is distinct from sid else active_scene_id=sid end) then
    raise exception 'Scene changed. Switch back before editing or undoing.';
  end if;
  if p_command not in ('tabletop_move','tabletop_fog','tabletop_undo','tabletop_history') or
    p is null or pg_column_size(p)>200000 then raise exception 'Invalid tabletop operation'; end if;

  -- Hard bound: twenty receipts/inverses per user/game, retained for at most 24h.
  delete from public.tabletop_history where game_id=p_game and user_id=uid
    and created_at<now()-interval '24 hours';
  if p_command<>'tabletop_history' then
    if p->>'operation_id' is null then raise exception 'Operation identifier required'; end if;
    select * into h from public.tabletop_history
      where game_id=p_game and user_id=uid and operation_id=(p->>'operation_id')::uuid;
    if p_command='tabletop_undo' then
      if h.sequence is null or h.scene_id<>sid then
        raise exception 'Undo expired or unsupported. Only the last 20 moves/fog edits within 24 hours are retained.';
      end if;
      target:=h.target_id;
    else
      target:=(p->>'id')::uuid;
    end if;
    if p_command='tabletop_fog' or (p_command='tabletop_undo' and h.kind='fog') then
      if not public.is_gm(p_game) then raise exception 'GM required'; end if;
      select * into s from public.scenes where id=target and id=sid and game_id=p_game;
      if s.id is null then raise exception 'Scene access denied'; end if;
    else
      select * into t from public.tokens where id=target and scene_id=sid and game_id=p_game;
      if t.id is null or (not public.is_gm(p_game) and
        (t.controller_id<>uid or not public.can_read_token(t.id))) then
        raise exception 'Token control denied';
      end if;
    end if;
    if p_command='tabletop_undo' then
      if not h.undone then
        next_revision:=coalesce(t.revision,s.revision);
        if next_revision<>h.expected_revision then
          raise exception 'Undo blocked: a later change would be overwritten. Adjust manually.';
        end if;
        perform public.mutate_game(p_game,case when h.kind='move' then 'token_update' else 'scene_update' end,
          h.inverse||jsonb_build_object('id',target,'revision',next_revision));
        update public.tabletop_history set undone=true where sequence=h.sequence;
        -- Rebase only the immediately preceding state of this user's same target.
        -- An intervening write by anyone else breaks the revision chain.
        update public.tabletop_history set expected_revision=next_revision+1
          where game_id=p_game and user_id=uid and target_id=target and kind=h.kind
            and not undone and expected_revision=(h.request->>'revision')::integer;
      end if;
    elsif h.sequence is not null then
      if h.request is distinct from p then raise exception 'Operation identifier already used'; end if;
      -- Acknowledgement retry only: never reapply an already committed/undone edit.
    else
      if p_command='tabletop_move' then
        if not (p ?& array['x','y','revision']) or
          jsonb_typeof(p->'x') is distinct from 'number' or
          jsonb_typeof(p->'y') is distinct from 'number' or
          (p-'id'-'scene_id'-'operation_id'-'revision'-'x'-'y')<>'{}'::jsonb then
          raise exception 'Invalid move';
        end if;
        inverse:=jsonb_build_object('x',t.x,'y',t.y);
        next_revision:=t.revision+1;
        perform public.mutate_game(p_game,'token_update',p-'scene_id'-'operation_id');
      else
        if not (p ?& array['fog','revision']) or
          jsonb_typeof(p->'fog') is distinct from 'array' or
          (p-'id'-'scene_id'-'operation_id'-'revision'-'fog')<>'{}'::jsonb then
          raise exception 'Invalid fog edit';
        end if;
        inverse:=jsonb_build_object('fog',s.fog);
        next_revision:=s.revision+1;
        perform public.mutate_game(p_game,'scene_update',p-'scene_id'-'operation_id');
      end if;
      insert into public.tabletop_history(game_id,user_id,operation_id,scene_id,target_id,kind,request,inverse,expected_revision)
        values(p_game,uid,(p->>'operation_id')::uuid,sid,target,
          case when p_command='tabletop_move' then 'move' else 'fog' end,p,inverse,next_revision);
      delete from public.tabletop_history where sequence in (
        select sequence from public.tabletop_history where game_id=p_game and user_id=uid
        order by sequence desc offset 20);
    end if;
  end if;
  -- Metadata only, currently authorized, active scene only. No inverse, positions,
  -- labels, or fog geometry can escape via history (including after revocation).
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',hist.operation_id,'description',case when hist.kind='move' then 'Move token' else 'Edit fog' end
  ) order by hist.sequence desc),'[]'::jsonb) into history
    from public.tabletop_history hist where hist.game_id=p_game and hist.user_id=uid
      and hist.scene_id=sid and not hist.undone and
      ((hist.kind='fog' and public.is_gm(p_game)) or
       (hist.kind='move' and exists(select 1 from public.tokens tok where tok.id=hist.target_id and
         (public.is_gm(p_game) or (tok.controller_id=uid and public.can_read_token(tok.id))))));
  return jsonb_build_object('history',history::text);
end; $$;

create or replace function public.onboarding_command(p_game uuid,p_command text,p jsonb)
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
  if s.id is null or not exists(select 1 from public.games where id=p_game and case when coalesce((p->>'preparing')::boolean,false) then public.is_gm(p_game) and active_scene_id is distinct from s.id else active_scene_id=s.id end) then
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

create or replace function public.configure_scene_grid(p_game uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.scenes; previous jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  if not public.is_gm(p_game) then raise exception 'GM required'; end if;
  if p is null or pg_column_size(p)>2000 or not public.valid_scene_grid(p->'grid')
    or p->>'operation_id' is null then raise exception 'Invalid grid request'; end if;
  select request into previous from public.grid_receipts
    where game_id=p_game and user_id=auth.uid() and operation_id=(p->>'operation_id')::uuid;
  if found then
    if previous<>p then raise exception 'Operation already used'; end if;
    return '{"confirmed":"true"}'::jsonb;
  end if;
  select * into s from public.scenes where id=(p->>'scene_id')::uuid and game_id=p_game;
  if s.id is null or not exists(select 1 from public.games where id=p_game and case when coalesce((p->>'preparing')::boolean,false) then public.is_gm(p_game) and active_scene_id is distinct from s.id else active_scene_id=s.id end)
    then raise exception 'Active scene changed'; end if;
  if p->>'revision' is null or s.revision<>(p->>'revision')::integer
    then raise exception 'Scene changed. Review the latest map.'; end if;
  if p ? 'feet_per_cell' and not coalesce((p->>'feet_per_cell')::float8 between 0.001 and 100000,false) then raise exception 'Invalid grid scale'; end if;
  update public.scenes set grid=p->'grid',revision=revision+1,
    calibrated=calibrated or p ? 'feet_per_cell',
    units_per_pixel=coalesce((p->>'feet_per_cell')::float8/(p->'grid'->>'size')::float8,units_per_pixel),
    unit=case when p ? 'feet_per_cell' then 'ft' else unit end where id=s.id;
  insert into public.grid_receipts values(p_game,auth.uid(),(p->>'operation_id')::uuid,p);
  return '{"confirmed":"true"}'::jsonb;
end; $$;
