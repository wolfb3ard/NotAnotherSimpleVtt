create schema if not exists vtt_private;
revoke all on schema vtt_private from public,anon,authenticated;

create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  scene_id uuid not null,
  status text not null default 'active' check (status in ('active','paused','ended')),
  round integer not null default 1 check (round>=1),
  active_token_id uuid,
  revision integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,scene_id,game_id),
  foreign key(scene_id,game_id) references public.scenes(id,game_id) on delete cascade
);
create unique index encounters_live_scene_idx on public.encounters(scene_id) where status<>'ended';
create index encounters_game_idx on public.encounters(game_id);
create index encounters_scene_history_idx on public.encounters(scene_id,created_at desc);
alter table public.tokens add constraint tokens_scene_game_unique unique(id,scene_id,game_id);
create table public.encounter_participants (
  encounter_id uuid not null,
  game_id uuid not null,
  scene_id uuid not null,
  token_id uuid not null,
  initiative numeric not null check (initiative between -1000000 and 1000000),
  position integer not null check (position>0),
  primary key(encounter_id,token_id),
  unique(encounter_id,position) deferrable initially deferred,
  foreign key(encounter_id,scene_id,game_id) references public.encounters(id,scene_id,game_id) on delete cascade,
  foreign key(token_id,scene_id,game_id) references public.tokens(id,scene_id,game_id) on delete cascade
);
create index encounter_participants_token_idx on public.encounter_participants(token_id);
create index encounter_participants_game_idx on public.encounter_participants(game_id);
create index encounter_participants_scene_idx on public.encounter_participants(scene_id);
alter table public.encounters add constraint encounter_current_participant
  foreign key(id,active_token_id) references public.encounter_participants(encounter_id,token_id)
  deferrable initially deferred;
create table public.encounter_receipts (
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key(game_id,user_id,operation_id)
);
create index encounter_receipts_user_idx on public.encounter_receipts(user_id);
-- No raw SELECT, even for GMs: a single filtered projection is the read API.
alter table public.encounters enable row level security;
alter table public.encounter_participants enable row level security;
alter table public.encounter_receipts enable row level security;
revoke all on public.encounters,public.encounter_participants,public.encounter_receipts from public,anon,authenticated;
create trigger encounters_notify after insert or update or delete on public.encounters
  for each row execute function public.notify_room();
create trigger encounter_participants_notify after insert or update or delete on public.encounter_participants
  for each row execute function public.notify_room();

create function vtt_private.valid_encounter_request(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare action text:=p->>'action'; item jsonb; ids uuid[]:='{}'; ident uuid; allowed text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or pg_column_size(p)>30000 then return false; end if;
  if (p->>'scene_id')::uuid is null or (p->>'operation_id')::uuid is null then return false; end if;
  allowed:=array['action','scene_id','operation_id'];
  if action<>'start' then
    if (p->>'id')::uuid is null or jsonb_typeof(p->'revision') is distinct from 'number' or
      (p->>'revision')::numeric<>trunc((p->>'revision')::numeric) or
      (p->>'revision')::numeric not between 0 and 2147483647 then return false; end if;
    allowed:=allowed||array['id','revision'];
  end if;
  if action in ('start','add') then
    allowed:=array_append(allowed,'participants');
    if jsonb_typeof(p->'participants') is distinct from 'array' or
      jsonb_array_length(p->'participants') not between 1 and 50 then return false; end if;
    for item in select value from jsonb_array_elements(p->'participants') loop
      if jsonb_typeof(item) is distinct from 'object' or
        not (item ? 'token_id' and item ? 'initiative') or
        item-'token_id'-'initiative'<>'{}'::jsonb or
        (item->'initiative'<>'null'::jsonb and (jsonb_typeof(item->'initiative') is distinct from 'number' or
        (item->>'initiative')::numeric not between -1000000 and 1000000)) then return false; end if;
      ident:=(item->>'token_id')::uuid;
      if ident is null or ident=any(ids) then return false; end if;
      ids:=array_append(ids,ident);
    end loop;
  elsif action in ('roll','remove','reorder') then
    allowed:=array_append(allowed,'token_ids');
    if jsonb_typeof(p->'token_ids') is distinct from 'array' or
      jsonb_array_length(p->'token_ids') not between 1 and 50 then return false; end if;
    for item in select value from jsonb_array_elements(p->'token_ids') loop
      ident:=(item#>>'{}')::uuid;
      if ident is null or ident=any(ids) then return false; end if;
      ids:=array_append(ids,ident);
    end loop;
  elsif action='initiative' then
    allowed:=array_append(allowed,'changes');
    if jsonb_typeof(p->'changes') is distinct from 'array' or
      jsonb_array_length(p->'changes') not between 1 and 50 then return false; end if;
    for item in select value from jsonb_array_elements(p->'changes') loop
      if jsonb_typeof(item) is distinct from 'object' or item-'token_id'-'value'<>'{}'::jsonb or
        jsonb_typeof(item->'value') is distinct from 'number' or
        (item->>'value')::numeric not between -1000000 and 1000000 then return false; end if;
      ident:=(item->>'token_id')::uuid;
      if ident is null or ident=any(ids) then return false; end if;
      ids:=array_append(ids,ident);
    end loop;
  elsif action not in ('next','pause','resume','end') or action is null then return false;
  end if;
  return not exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed));
exception when others then return false;
end; $$;

create function vtt_private.sort_encounter(e uuid) returns void language sql set search_path = '' as $$
  update public.encounter_participants p set position=ranked.position
  from (select token_id,row_number() over(order by initiative desc,position,token_id)::integer position
    from public.encounter_participants where encounter_id=e) ranked
  where p.encounter_id=e and p.token_id=ranked.token_id;
$$;

-- Token/actor deletion and explicit removal use the same turn-reconciliation path.
create function vtt_private.encounter_participant_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.encounters; next_token uuid; next_position integer;
begin
  select * into e from public.encounters where id=old.encounter_id;
  if e.id is null then return old; end if;
  if e.active_token_id=old.token_id then
    select token_id,position into next_token,next_position from public.encounter_participants
      where encounter_id=e.id
      order by (position>old.position) desc,position limit 1;
    update public.encounters set active_token_id=next_token,
      round=round+case when next_position<=old.position then 1 else 0 end,
      status=case when next_token is null and status<>'ended' then 'paused' else status end,
      revision=revision+1 where id=e.id;
  else
    update public.encounters set revision=revision+1 where id=e.id;
  end if;
  return old;
end; $$;
create trigger encounter_participant_removed after delete on public.encounter_participants
  for each row execute function vtt_private.encounter_participant_removed();

create function public.encounter_snapshot(p_game uuid,p_scene uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.encounters; g public.games; gm boolean; people jsonb; current_token uuid;
begin
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select * into g from public.games where id=p_game for share;
  if g.id is null or g.active_scene_id is distinct from p_scene then return null; end if;
  gm:=public.is_gm(p_game);
  select * into e from public.encounters where game_id=p_game and scene_id=p_scene
    order by (status='ended'),created_at desc,id limit 1;
  if e.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('token_id',t.id,'label',t.label,'initiative',p.initiative)
    order by p.position),'[]'::jsonb) into people
    from public.encounter_participants p join public.tokens t on t.id=p.token_id
    where p.encounter_id=e.id and (gm or public.can_read_token(t.id));
  if exists(select 1 from jsonb_array_elements(people) x where x->>'token_id'=e.active_token_id::text)
    then current_token:=e.active_token_id; end if;
  -- No hidden token IDs, gaps, modifiers, actor/sheet data, total counts, current
  -- index or private revision are exposed to players, including hidden turns.
  return jsonb_build_object('id',e.id,'scene_id',e.scene_id,'status',e.status,'round',e.round,
    'revision',case when gm then e.revision else 0 end,
    'active_token_id',current_token,'participants',people);
end; $$;
revoke all on function public.encounter_snapshot(uuid,uuid) from public,anon;
grant execute on function public.encounter_snapshot(uuid,uuid) to authenticated;

create function public.encounter_receipt(p_game uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare receipt public.encounter_receipts;
begin
  if auth.uid() is null or not public.is_member(p_game) or not public.is_gm(p_game)
    then raise exception 'GM required'; end if;
  if not vtt_private.valid_encounter_request(p) then raise exception 'Invalid encounter request'; end if;
  select * into receipt from public.encounter_receipts
    where game_id=p_game and user_id=auth.uid() and operation_id=(p->>'operation_id')::uuid;
  if receipt.game_id is not null then
    if receipt.request is distinct from p then raise exception 'Operation already used for another encounter change'; end if;
    return receipt.result;
  end if;
  return null;
end; $$;
revoke all on function public.encounter_receipt(uuid,jsonb) from public,anon;
grant execute on function public.encounter_receipt(uuid,jsonb) to authenticated;

create function vtt_private.apply_encounter(
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
        if jsonb_typeof(packet->'result'->'total') is distinct from 'number' or
          (packet->'result'->>'total')::numeric not between -1000000 and 1000000
          then raise exception 'Invalid initiative total'; end if;
        score:=(packet->'result'->>'total')::numeric;
        perform public.record_roll(p_user,p_game,(packet->>'roll_id')::uuid,a.id,
          packet->>'expression','private',packet->'result','Encounter initiative');
      end if;
      if action='roll' then
        update public.encounter_participants set initiative=score where encounter_id=e.id and token_id=ident;
      else
        if exists(select 1 from public.encounter_participants where encounter_id=e.id and token_id=ident)
          then raise exception 'Token already participates'; end if;
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
      -- Delete in existing order so removing several participants, including the
      -- current one, advances through the same sequence as individual removals.
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

-- Browser roles can supply manual totals, never authenticated dice results.
create function public.encounter_command(p_game uuid,p jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select vtt_private.apply_encounter(auth.uid(),p_game,p,'[]'::jsonb);
$$;
revoke all on function public.encounter_command(uuid,jsonb) from public,anon;
grant execute on function public.encounter_command(uuid,jsonb) to authenticated;
create function public.commit_encounter_rolls(p_user uuid,p_game uuid,p jsonb,p_rolls jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select vtt_private.apply_encounter(p_user,p_game,p,p_rolls);
$$;
revoke all on function public.commit_encounter_rolls(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_encounter_rolls(uuid,uuid,jsonb,jsonb) to service_role;
revoke all on function vtt_private.valid_encounter_request(jsonb),
  vtt_private.sort_encounter(uuid),vtt_private.encounter_participant_removed(),
  vtt_private.apply_encounter(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
