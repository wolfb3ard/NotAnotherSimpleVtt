alter table public.tokens add column folder text
  check (folder is null or (char_length(folder) between 1 and 60 and folder=btrim(folder)));

create function public.organize_scene_token(
  p_game uuid,p_scene uuid,p_token uuid,p_revision integer,p_remove boolean,p_folder text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.tokens;
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) or not public.is_gm(p_game)
    then raise exception 'GM required'; end if;
  select * into t from public.tokens where game_id=p_game and scene_id=p_scene and id=p_token;
  if t.id is null then raise exception 'Token unavailable in this scene'; end if;
  if t.revision is distinct from p_revision then raise exception 'Token changed. Reload and try again.'; end if;
  if p_remove then
    -- Existing encounter foreign keys reconcile the turn; the linked actor is untouched.
    delete from public.tokens where id=t.id;
  else
    update public.tokens set folder=nullif(btrim(p_folder),''),revision=revision+1 where id=t.id;
  end if;
  return jsonb_build_object('id',t.id);
end; $$;
revoke all on function public.organize_scene_token(uuid,uuid,uuid,integer,boolean,text) from public,anon;
grant execute on function public.organize_scene_token(uuid,uuid,uuid,integer,boolean,text) to authenticated;

create table vtt_private.sheet_initiative (
  token_id uuid primary key references public.tokens on delete cascade,
  roll_id uuid not null references public.rolls on delete cascade,
  actor_revision integer not null
);
create index sheet_initiative_roll_idx on vtt_private.sheet_initiative(roll_id);
alter table vtt_private.sheet_initiative enable row level security;

-- One transaction for the dice log and tracker. This is callable only by the
-- server that evaluated the saved sheet, never by a browser supplying a total.
create function public.commit_sheet_initiative(
  p_user uuid,p_game uuid,p_id uuid,p_actor uuid,p_revision integer,p_scene uuid,
  p_expression text,p_visibility text,p_result jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.games; a public.actors; previous public.rolls; e public.encounters;
        gm boolean; total numeric;
begin
  select * into g from public.games where id=p_game for update;
  if p_user is null or not exists(select 1 from public.memberships where game_id=p_game and user_id=p_user)
    then raise exception 'Game access denied'; end if;
  gm:=g.gm_id=p_user;
  select * into previous from public.rolls where id=p_id;
  if previous.id is not null then
    if previous.author_id is distinct from p_user or previous.game_id<>p_game or
       previous.roll_type<>'Sheet initiative' then raise exception 'Invalid roll identifier'; end if;
    return previous.result;
  end if;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  if a.id is null or (not gm and a.owner_id<>p_user and not exists(
    select 1 from public.tokens where actor_id=a.id and scene_id=p_scene and controller_id=p_user))
    then raise exception 'Character control required'; end if;
  if a.revision is distinct from p_revision or g.active_scene_id is distinct from p_scene
    then raise exception 'Sheet or scene changed. Roll again.'; end if;
  total:=(p_result->>'total')::numeric;
  if jsonb_typeof(p_result->'total') is distinct from 'number' or total not between -1000000 and 1000000
    then raise exception 'Invalid initiative total'; end if;
  perform public.record_roll(p_user,p_game,p_id,p_actor,p_expression,p_visibility,p_result,'Sheet initiative');

  select * into e from public.encounters where scene_id=p_scene and game_id=p_game and status<>'ended';
  if e.id is not null then
    update public.encounter_participants ep set initiative=total
      from public.tokens t where ep.encounter_id=e.id and t.id=ep.token_id and t.actor_id=a.id
        and (gm or t.controller_id=p_user);
    if found then
      perform vtt_private.sort_encounter(e.id);
      update public.encounters set revision=revision+1 where id=e.id;
    end if;
  end if;
  -- Only placed, controlled tokens are eligible. The roll never adds a token.
  insert into vtt_private.sheet_initiative(token_id,roll_id,actor_revision)
    select t.id,p_id,a.revision from public.tokens t
    where t.game_id=p_game and t.scene_id=p_scene and t.actor_id=a.id and (gm or t.controller_id=p_user)
      and not exists(select 1 from public.encounter_participants ep where ep.encounter_id=e.id and ep.token_id=t.id)
    on conflict (token_id) do update set roll_id=excluded.roll_id,actor_revision=excluded.actor_revision;
  return p_result;
end; $$;
revoke all on function public.commit_sheet_initiative(uuid,uuid,uuid,uuid,integer,uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.commit_sheet_initiative(uuid,uuid,uuid,uuid,integer,uuid,text,text,jsonb)
  to service_role;

-- Normalize preexisting custom orders as well.
select vtt_private.sort_encounter(id) from public.encounters where status<>'ended';

create or replace function vtt_private.apply_encounter(
  p_user uuid,p_game uuid,p jsonb,p_rolls jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.encounters; t public.tokens; a public.actors; receipt public.encounter_receipts;
  action text:=p->>'action'; item jsonb; packet jsonb; work jsonb; result jsonb;
  ident uuid; score numeric; n integer; pos integer; old_pos integer; next_token uuid;
  seen uuid[]:='{}'; used_rolls integer:=0; total_rolls integer;
begin
  perform 1 from public.games where id=p_game for update;
  if p_user is null or not exists(select 1 from public.games g join public.memberships m on m.game_id=g.id
    where g.id=p_game and g.gm_id=p_user and m.user_id=p_user) then raise exception 'GM required'; end if;
  if not vtt_private.valid_encounter_request(p) then raise exception 'Invalid encounter request'; end if;
  select * into receipt from public.encounter_receipts
    where game_id=p_game and user_id=p_user and operation_id=(p->>'operation_id')::uuid;
  if receipt.game_id is not null then
    if receipt.request is distinct from p then raise exception 'Operation already used for another encounter change'; end if;
    return receipt.result;
  end if;
  if not exists(select 1 from public.games where id=p_game and active_scene_id=(p->>'scene_id')::uuid)
    then raise exception 'Active scene changed. Reload the encounter.'; end if;
  if jsonb_typeof(p_rolls) is distinct from 'array' or pg_column_size(p_rolls)>500000 then raise exception 'Invalid initiative rolls'; end if;
  total_rolls:=jsonb_array_length(p_rolls);
  if action='start' then
    if exists(select 1 from public.encounters where game_id=p_game and scene_id=(p->>'scene_id')::uuid and status<>'ended')
      then raise exception 'A live encounter already exists in this scene'; end if;
    insert into public.encounters(game_id,scene_id) values(p_game,(p->>'scene_id')::uuid) returning * into e;
  else
    select * into e from public.encounters where id=(p->>'id')::uuid and game_id=p_game and scene_id=(p->>'scene_id')::uuid;
    if e.id is null then raise exception 'Encounter unavailable'; end if;
    if e.revision<>(p->>'revision')::integer then raise exception 'Encounter changed. Reload before trying again.'; end if;
    if e.status='ended' then raise exception 'Encounter has ended'; end if;
  end if;
  if action in ('start','add','roll') then
    if action='roll' then
      select jsonb_agg(jsonb_build_object('token_id',x,'initiative',null)) into work
        from jsonb_array_elements_text(p->'token_ids') x;
    else work:=p->'participants'; end if;
    select coalesce(max(position),0),count(*) into pos,n from public.encounter_participants where encounter_id=e.id;
    if action in ('start','add') and n+jsonb_array_length(work)>50 then raise exception 'Maximum 50 participants'; end if;
    for item in select value from jsonb_array_elements(work) loop
      ident:=(item->>'token_id')::uuid;
      select * into t from public.tokens where id=ident and game_id=p_game and scene_id=e.scene_id;
      if t.id is null then raise exception 'Token unavailable in this scene'; end if;
      if action='roll' and not exists(select 1 from public.encounter_participants where encounter_id=e.id and token_id=ident)
        then raise exception 'Participant unavailable'; end if;
      score:=(item->>'initiative')::numeric;
      if score is null then
        select value into packet from jsonb_array_elements(p_rolls) where value->>'token_id'=ident::text;
        if packet is null or ident=any(seen) then raise exception 'Server initiative roll required'; end if;
        seen:=array_append(seen,ident); used_rolls:=used_rolls+1;
        select * into a from public.actors where id=t.actor_id and game_id=p_game;
        if (packet->>'actor_id')::uuid is distinct from a.id or
          (packet->>'actor_revision')::integer is distinct from a.revision or
          (packet->>'token_revision')::integer is distinct from t.revision
          then raise exception 'Initiative source changed. Retry with the saved sheet.'; end if;
        if action<>'roll' then
          select (r.result->>'total')::numeric into score
            from vtt_private.sheet_initiative si join public.rolls r on r.id=si.roll_id
            where si.token_id=ident and si.actor_revision=a.revision
              and r.author_id in (t.controller_id,p_user)
              and r.created_at>=now()-interval '24 hours';
        end if;
        if score is null then
          if jsonb_typeof(packet->'result'->'total') is distinct from 'number' or
            (packet->'result'->>'total')::numeric not between -1000000 and 1000000
            then raise exception 'Invalid initiative total'; end if;
          score:=(packet->'result'->>'total')::numeric;
          perform public.record_roll(p_user,p_game,(packet->>'roll_id')::uuid,a.id,
            packet->>'expression','private',packet->'result','Encounter initiative');
        end if;
      end if;
      if action='roll' then
        update public.encounter_participants set initiative=score where encounter_id=e.id and token_id=ident;
      else
        if exists(select 1 from public.encounter_participants where encounter_id=e.id and token_id=ident)
          then raise exception 'Token already participates'; end if;
        delete from vtt_private.sheet_initiative where token_id=ident;
        pos:=pos+1;
        insert into public.encounter_participants values(e.id,p_game,e.scene_id,ident,score,pos);
      end if;
    end loop;
    perform vtt_private.sort_encounter(e.id);
    if action='start' or e.active_token_id is null then
      select token_id into next_token from public.encounter_participants where encounter_id=e.id order by position limit 1;
      update public.encounters set active_token_id=next_token where id=e.id;
    end if;
  elsif action in ('remove','reorder') then
    if exists(select 1 from jsonb_array_elements_text(p->'token_ids') x where not exists(
      select 1 from public.encounter_participants where encounter_id=e.id and token_id=x::uuid))
      then raise exception 'Participant unavailable'; end if;
    if action='remove' then
      for ident in select token_id from public.encounter_participants where encounter_id=e.id
        and token_id in (select x::uuid from jsonb_array_elements_text(p->'token_ids') x) order by position loop
        delete from public.encounter_participants where encounter_id=e.id and token_id=ident;
      end loop;
    else
      if (select count(*) from public.encounter_participants where encounter_id=e.id)<>jsonb_array_length(p->'token_ids')
        then raise exception 'Reorder must include every participant'; end if;
      update public.encounter_participants q set position=x.ordinality::integer
        from jsonb_array_elements_text(p->'token_ids') with ordinality x
        where q.encounter_id=e.id and q.token_id=x.value::uuid;
      perform vtt_private.sort_encounter(e.id);
    end if;
  elsif action='initiative' then
    for item in select value from jsonb_array_elements(p->'changes') loop
      update public.encounter_participants set initiative=(item->>'value')::numeric
        where encounter_id=e.id and token_id=(item->>'token_id')::uuid;
      if not found then raise exception 'Participant unavailable'; end if;
    end loop;
    perform vtt_private.sort_encounter(e.id);
  elsif action='next' then
    if e.status<>'active' or e.active_token_id is null then raise exception 'Resume an encounter with participants first'; end if;
    select position into old_pos from public.encounter_participants where encounter_id=e.id and token_id=e.active_token_id;
    select token_id,position into next_token,pos from public.encounter_participants where encounter_id=e.id
      order by (position>old_pos) desc,position limit 1;
    update public.encounters set active_token_id=next_token,round=round+case when pos<=old_pos then 1 else 0 end where id=e.id;
  elsif action='pause' then
    if e.status<>'active' then raise exception 'Encounter is not active'; end if;
    update public.encounters set status='paused' where id=e.id;
  elsif action='resume' then
    if e.status<>'paused' or e.active_token_id is null then raise exception 'Add participants before resuming'; end if;
    update public.encounters set status='active' where id=e.id;
  elsif action='end' then
    update public.encounters set status='ended',active_token_id=null where id=e.id;
  end if;
  if total_rolls<>used_rolls then raise exception 'Unexpected initiative roll'; end if;
  update public.encounters set revision=revision+1 where id=e.id returning * into e;
  result:=jsonb_build_object('id',e.id::text,'revision',e.revision::text);
  insert into public.encounter_receipts values(p_game,p_user,(p->>'operation_id')::uuid,p,result);
  return result;
end; $$;
