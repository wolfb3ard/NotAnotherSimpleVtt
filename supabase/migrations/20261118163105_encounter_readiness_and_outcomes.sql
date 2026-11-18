alter table public.encounters drop constraint encounters_status_check;
alter table public.encounters add constraint encounters_status_check
  check (status in ('setup','active','paused','ended'));
alter table public.encounter_participants alter column initiative drop not null;
alter table public.encounter_participants add column outcome text not null default 'active'
  check (outcome in ('active','defeated','fled'));

create table vtt_private.encounter_outcome_archive (
  encounter_id uuid not null references public.encounters on delete cascade,
  token_id uuid not null,
  label text not null,
  outcome text not null check (outcome in ('defeated','fled')),
  primary key(encounter_id,token_id)
);
alter table vtt_private.encounter_outcome_archive enable row level security;

-- Only the GM sees historical rows after their live visibility context disappears.
create function vtt_private.archive_outcome_before_token_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into vtt_private.encounter_outcome_archive(encounter_id,token_id,label,outcome)
    select p.encounter_id,p.token_id,old.label,p.outcome
    from public.encounter_participants p where p.token_id=old.id and p.outcome<>'active';
  return old;
end; $$;
revoke all on function vtt_private.archive_outcome_before_token_removal() from public,anon,authenticated;
create trigger archive_outcome_before_token_removal before delete on public.tokens
  for each row execute function vtt_private.archive_outcome_before_token_removal();

alter function vtt_private.valid_encounter_request(jsonb) rename to valid_base_encounter_request;
create function vtt_private.valid_encounter_request(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  case p->>'action'
    when 'prepare' then return vtt_private.valid_base_encounter_request(p||'{"action":"start"}');
    when 'queue' then return vtt_private.valid_base_encounter_request(p||'{"action":"add"}');
    when 'begin' then return vtt_private.valid_base_encounter_request(p||'{"action":"resume"}');
    when 'outcome' then
      return coalesce(p->>'outcome' in ('active','defeated','fled')
        and (p->>'token_id')::uuid is not null and
        vtt_private.valid_base_encounter_request((p-'token_id'-'outcome')||'{"action":"resume"}'),false);
    else return vtt_private.valid_base_encounter_request(p);
  end case;
exception when others then return false;
end; $$;
revoke all on function vtt_private.valid_encounter_request(jsonb) from public,anon,authenticated;

create or replace function vtt_private.sort_encounter(e uuid) returns void language sql set search_path = '' as $$
  update public.encounter_participants p set position=ranked.position
  from (select token_id,row_number() over(
    order by (outcome='active') desc,initiative desc nulls last,position,token_id
  )::integer position from public.encounter_participants where encounter_id=e) ranked
  where p.encounter_id=e and p.token_id=ranked.token_id and p.position<>ranked.position;
$$;

-- One turn-selection rule for advancing, removal, and the visibility-filtered preview.
create function vtt_private.next_combatant(e uuid, after_position integer)
returns table(token_id uuid,turn_position integer) language sql stable set search_path = '' as $$
  select p.token_id,p.position from public.encounter_participants p
  where p.encounter_id=e and p.outcome='active' and p.initiative is not null
  order by (p.position>after_position) desc,p.position limit 1;
$$;
revoke all on function vtt_private.next_combatant(uuid,integer) from public,anon,authenticated;

create or replace function vtt_private.encounter_participant_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.encounters; next_token uuid; next_position integer;
begin
  select * into e from public.encounters where id=old.encounter_id;
  if e.id is null then return old; end if;
  if e.active_token_id=old.token_id then
    select token_id,turn_position into next_token,next_position from vtt_private.next_combatant(e.id,old.position);
    update public.encounters set active_token_id=next_token,
      round=round+case when next_position<=old.position then 1 else 0 end,
      status=case when next_token is null and status='active' then 'paused' else status end,
      revision=revision+1 where id=e.id;
  else
    update public.encounters set revision=revision+1 where id=e.id;
  end if;
  return old;
end; $$;

create or replace function public.encounter_snapshot(p_game uuid,p_scene uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.encounters; g public.games; gm boolean; people jsonb; current_token uuid; next_token uuid;
  archived jsonb:='[]';
begin
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select * into g from public.games where id=p_game for share;
  if g.id is null or g.active_scene_id is distinct from p_scene then return null; end if;
  gm:=public.is_gm(p_game);
  select * into e from public.encounters where game_id=p_game and scene_id=p_scene
    order by (status='ended'),created_at desc,id limit 1;
  if e.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('token_id',t.id,'label',t.label,
    'initiative',p.initiative,'outcome',p.outcome) order by p.position),'[]'::jsonb) into people
    from public.encounter_participants p join public.tokens t on t.id=p.token_id
    where p.encounter_id=e.id and (gm or public.can_read_token(t.id));
  if exists(select 1 from jsonb_array_elements(people) x where x->>'token_id'=e.active_token_id::text)
    then current_token:=e.active_token_id; end if;
  if e.status='active' and current_token is not null then
    select n.token_id into next_token from public.encounter_participants p
      cross join lateral vtt_private.next_combatant(e.id,p.position) n
      where p.encounter_id=e.id and p.token_id=current_token;
    if not (gm or public.can_read_token(next_token)) then next_token:=null; end if;
  end if;
  if gm then
    select coalesce(jsonb_agg(jsonb_build_object('token_id',a.token_id,'label',a.label,'outcome',a.outcome)
      order by a.label,a.token_id),'[]') into archived
      from vtt_private.encounter_outcome_archive a where a.encounter_id=e.id;
  end if;
  return jsonb_build_object('id',e.id,'scene_id',e.scene_id,'status',e.status,'round',e.round,
    'revision',case when gm then e.revision else 0 end,'active_token_id',current_token,
    'next_token_id',next_token,'participants',people,'archived_outcomes',archived);
end; $$;

create function vtt_private.queued_initiative(p_token uuid,p_revision integer,p_controller uuid,p_gm uuid)
returns numeric language sql stable set search_path = '' as $$
  select (r.result->>'total')::numeric
  from vtt_private.sheet_initiative si join public.rolls r on r.id=si.roll_id
  where si.token_id=p_token and si.actor_revision=p_revision
    and r.author_id in (p_controller,p_gm) and r.created_at>=now()-interval '24 hours';
$$;
revoke all on function vtt_private.queued_initiative(uuid,integer,uuid,uuid) from public,anon,authenticated;

create or replace function public.commit_sheet_initiative(
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
      from public.tokens t where ep.encounter_id=e.id and ep.outcome='active'
        and t.id=ep.token_id and t.actor_id=a.id and (gm or t.controller_id=p_user);
    if found then
      perform vtt_private.sort_encounter(e.id);
      update public.encounters set revision=revision+1 where id=e.id;
    end if;
  end if;
  insert into vtt_private.sheet_initiative(token_id,roll_id,actor_revision)
    select t.id,p_id,a.revision from public.tokens t
    where t.game_id=p_game and t.scene_id=p_scene and t.actor_id=a.id and (gm or t.controller_id=p_user)
      and not exists(select 1 from public.encounter_participants ep where ep.encounter_id=e.id and ep.token_id=t.id)
    on conflict (token_id) do update set roll_id=excluded.roll_id,actor_revision=excluded.actor_revision;
  return p_result;
end; $$;

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
  if action in ('start','prepare') then
    if exists(select 1 from public.encounters where game_id=p_game and scene_id=(p->>'scene_id')::uuid and status<>'ended')
      then raise exception 'A live encounter already exists in this scene'; end if;
    insert into public.encounters(game_id,scene_id,status)
      values(p_game,(p->>'scene_id')::uuid,case when action='prepare' then 'setup' else 'active' end)
      returning * into e;
  else
    select * into e from public.encounters where id=(p->>'id')::uuid and game_id=p_game and scene_id=(p->>'scene_id')::uuid;
    if e.id is null then raise exception 'Encounter unavailable'; end if;
    if e.revision<>(p->>'revision')::integer then raise exception 'Encounter changed. Reload before trying again.'; end if;
    if e.status='ended' then raise exception 'Encounter has ended'; end if;
    if action='queue' and e.status<>'setup' then raise exception 'Only a setup encounter can queue unrolled participants'; end if;
  end if;
  if action in ('start','prepare','add','queue','roll') then
    if action='roll' then
      select jsonb_agg(jsonb_build_object('token_id',x,'initiative',null)) into work
        from jsonb_array_elements_text(p->'token_ids') x;
    else work:=p->'participants'; end if;
    select coalesce(max(position),0),count(*) into pos,n from public.encounter_participants where encounter_id=e.id;
    if action<>'roll' and n+jsonb_array_length(work)>50 then raise exception 'Maximum 50 participants'; end if;
    for item in select value from jsonb_array_elements(work) loop
      ident:=(item->>'token_id')::uuid;
      select * into t from public.tokens where id=ident and game_id=p_game and scene_id=e.scene_id;
      if t.id is null then raise exception 'Token unavailable in this scene'; end if;
      if action='roll' and not exists(select 1 from public.encounter_participants
        where encounter_id=e.id and token_id=ident and outcome='active')
        then raise exception 'Active participant unavailable'; end if;
      score:=(item->>'initiative')::numeric;
      if score is null then
        select * into a from public.actors where id=t.actor_id and game_id=p_game;
        if action<>'roll' then
          score:=vtt_private.queued_initiative(ident,a.revision,t.controller_id,p_user);
        end if;
        if action not in ('prepare','queue') then
          select value into packet from jsonb_array_elements(p_rolls) where value->>'token_id'=ident::text;
          if packet is null or ident=any(seen) then raise exception 'Server initiative roll required'; end if;
          seen:=array_append(seen,ident); used_rolls:=used_rolls+1;
          if (packet->>'actor_id')::uuid is distinct from a.id or
            (packet->>'actor_revision')::integer is distinct from a.revision or
            (packet->>'token_revision')::integer is distinct from t.revision
            then raise exception 'Initiative source changed. Retry with the saved sheet.'; end if;
          if score is null then
            if jsonb_typeof(packet->'result'->'total') is distinct from 'number' or
              (packet->'result'->>'total')::numeric not between -1000000 and 1000000
              then raise exception 'Invalid initiative total'; end if;
            score:=(packet->'result'->>'total')::numeric;
            perform public.record_roll(p_user,p_game,(packet->>'roll_id')::uuid,a.id,
              packet->>'expression','private',packet->'result','Encounter initiative');
          end if;
        end if;
      end if;
      if action='roll' then
        update public.encounter_participants set initiative=score where encounter_id=e.id and token_id=ident;
      else
        if exists(select 1 from public.encounter_participants where encounter_id=e.id and token_id=ident)
          then raise exception 'Token already participates'; end if;
        delete from vtt_private.sheet_initiative where token_id=ident;
        pos:=pos+1;
        insert into public.encounter_participants(encounter_id,game_id,scene_id,token_id,initiative,position)
          values(e.id,p_game,e.scene_id,ident,score,pos);
      end if;
    end loop;
    perform vtt_private.sort_encounter(e.id);
    if e.status<>'setup' and e.active_token_id is null then
      select token_id into next_token from vtt_private.next_combatant(e.id,0);
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
        where encounter_id=e.id and token_id=(item->>'token_id')::uuid and outcome='active';
      if not found then raise exception 'Active participant unavailable'; end if;
    end loop;
    perform vtt_private.sort_encounter(e.id);
  elsif action='outcome' then
    if e.status='setup' then raise exception 'Begin combat before marking an outcome'; end if;
    ident:=(p->>'token_id')::uuid;
    update public.encounter_participants set outcome=p->>'outcome'
      where encounter_id=e.id and token_id=ident and initiative is not null
      returning position into old_pos;
    if not found then raise exception 'Participant unavailable or missing initiative'; end if;
    if e.active_token_id=ident and p->>'outcome'<>'active' then
      select token_id,turn_position into next_token,pos from vtt_private.next_combatant(e.id,old_pos);
      update public.encounters set active_token_id=next_token,
        round=round+case when pos<=old_pos then 1 else 0 end,
        status=case when next_token is null then 'paused' else status end where id=e.id;
    elsif e.status='paused' and e.active_token_id is null and p->>'outcome'='active' then
      update public.encounters set active_token_id=ident where id=e.id;
    end if;
    perform vtt_private.sort_encounter(e.id);
  elsif action='begin' then
    if e.status<>'setup' then raise exception 'Encounter is not in setup'; end if;
    if exists(select 1 from public.encounter_participants where encounter_id=e.id
      and outcome='active' and initiative is null) then raise exception 'Waiting for initiative'; end if;
    select token_id into next_token from vtt_private.next_combatant(e.id,0);
    if next_token is null then raise exception 'Add participants before starting'; end if;
    update public.encounters set status='active',active_token_id=next_token where id=e.id;
  elsif action='next' then
    if e.status<>'active' or e.active_token_id is null then raise exception 'Resume an encounter with participants first'; end if;
    select position into old_pos from public.encounter_participants where encounter_id=e.id and token_id=e.active_token_id;
    select token_id,turn_position into next_token,pos from vtt_private.next_combatant(e.id,old_pos);
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
