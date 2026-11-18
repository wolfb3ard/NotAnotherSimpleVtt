alter table public.encounters
  add column turn_nonce uuid not null default gen_random_uuid(),
  add column undo_count integer not null default 0;

create table vtt_private.encounter_turn_undo (
  encounter_id uuid primary key references public.encounters on delete cascade,
  revision integer not null,
  previous_token_id uuid not null,
  previous_round integer not null
);
alter table vtt_private.encounter_turn_undo enable row level security;

-- A rewind changes the cursor, not combat bookkeeping or condition prompts.
drop trigger combat_turn_prompts on public.encounters;
create trigger combat_turn_prompts after update on public.encounters
  for each row when (old.undo_count=new.undo_count)
  execute function vtt_private.combat_turn_prompts();

create function vtt_private.can_end_turn(e public.encounters) returns boolean
language sql stable set search_path = '' as $$
  select e.status='active' and exists(
    select 1 from public.tokens t where t.id=e.active_token_id and t.game_id=e.game_id
      and t.controller_id=auth.uid() and public.can_read_token(t.id)
  );
$$;
revoke all on function vtt_private.can_end_turn(public.encounters) from public,anon,authenticated;

-- Keep the filtered baseline projection intact. Only a controller receives
-- an opaque key for their turn; the player revision remains redacted.
alter function public.encounter_snapshot(uuid,uuid) set schema vtt_private;
revoke all on function vtt_private.encounter_snapshot(uuid,uuid) from public,anon,authenticated;
create function public.encounter_snapshot(p_game uuid,p_scene uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb; e public.encounters;
begin
  result:=vtt_private.encounter_snapshot(p_game,p_scene);
  if result is null then return null; end if;
  select * into e from public.encounters where id=(result->>'id')::uuid and game_id=p_game;
  if public.is_gm(p_game) then
    return result||jsonb_build_object('can_undo_turn',e.status='active' and exists(
      select 1 from vtt_private.encounter_turn_undo h where h.encounter_id=e.id and h.revision=e.revision
    ));
  elsif vtt_private.can_end_turn(e) then
    return result||jsonb_build_object('end_turn_key',md5(e.turn_nonce::text||':'||e.revision::text));
  end if;
  return result;
end; $$;
revoke all on function public.encounter_snapshot(uuid,uuid) from public,anon;
grant execute on function public.encounter_snapshot(uuid,uuid) to authenticated;

create function vtt_private.change_turn(p_game uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.encounters; h vtt_private.encounter_turn_undo; receipt public.encounter_receipts;
  uid uuid:=auth.uid(); gm boolean; action text:=p->>'action';
  operation uuid; old_pos integer; next_pos integer; next_token uuid; result jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if uid is null or not public.is_member(p_game) then
    if action='end_turn' then raise exception 'Game access denied'; end if;
    raise exception 'GM required';
  end if;
  gm:=public.is_gm(p_game);
  if action in ('next','undo_turn') then
    if not gm then raise exception 'GM required'; end if;
    if not vtt_private.valid_encounter_request(p||'{"action":"next"}') then
      raise exception 'Invalid encounter request';
    end if;
  elsif action='end_turn' then
    if not coalesce(jsonb_typeof(p->'turn_key')='string' and p->>'turn_key' ~ '^[0-9a-f]{32}$'
      and vtt_private.valid_encounter_request((p-'turn_key')||'{"action":"next","revision":0}'),false)
      or p ? 'revision' then raise exception 'Invalid encounter request'; end if;
  else
    raise exception 'Invalid encounter request';
  end if;
  operation:=(p->>'operation_id')::uuid;
  select * into receipt from public.encounter_receipts
    where game_id=p_game and user_id=uid and operation_id=operation;
  if receipt.game_id is not null then
    if receipt.request is distinct from p then raise exception 'Operation already used for another encounter change'; end if;
    return receipt.result;
  end if;
  if not exists(select 1 from public.games where id=p_game and active_scene_id=(p->>'scene_id')::uuid)
    then raise exception 'Active scene changed. Reload the encounter.'; end if;
  select * into e from public.encounters where game_id=p_game and scene_id=(p->>'scene_id')::uuid
    and id=(p->>'id')::uuid;
  if action='end_turn' then
    if not coalesce(vtt_private.can_end_turn(e) and p->>'turn_key'=md5(e.turn_nonce::text||':'||e.revision::text),false)
      then raise exception 'Turn changed or you do not control this token'; end if;
  else
    if e.id is null then raise exception 'Encounter unavailable'; end if;
    if e.revision<>(p->>'revision')::integer then raise exception 'Encounter changed. Reload before trying again.'; end if;
    if e.status='ended' then raise exception 'Encounter has ended'; end if;
    if e.status<>'active' or e.active_token_id is null then
      raise exception 'Resume an encounter with participants first';
    end if;
  end if;
  if action='undo_turn' then
    delete from vtt_private.encounter_turn_undo where encounter_id=e.id and revision=e.revision
      returning * into h;
    if h.encounter_id is null then raise exception 'No turn to undo after the latest encounter change'; end if;
    update public.encounters set active_token_id=h.previous_token_id,round=h.previous_round,
      revision=revision+1,undo_count=undo_count+1 where id=e.id returning * into e;
  else
    select position into old_pos from public.encounter_participants
      where encounter_id=e.id and token_id=e.active_token_id;
    select token_id,turn_position into next_token,next_pos from vtt_private.next_combatant(e.id,old_pos);
    insert into vtt_private.encounter_turn_undo(encounter_id,revision,previous_token_id,previous_round)
      values(e.id,e.revision+1,e.active_token_id,e.round)
      on conflict (encounter_id) do update set revision=excluded.revision,
        previous_token_id=excluded.previous_token_id,previous_round=excluded.previous_round;
    update public.encounters set active_token_id=next_token,revision=revision+1,
      round=round+case when next_pos<=old_pos then 1 else 0 end where id=e.id returning * into e;
  end if;
  result:=jsonb_build_object('id',e.id::text,'revision',case when gm and action<>'end_turn' then e.revision::text else '0' end);
  insert into public.encounter_receipts values(p_game,uid,operation,p,result);
  return result;
end; $$;
revoke all on function vtt_private.change_turn(uuid,jsonb) from public,anon,authenticated;

create or replace function public.encounter_command(p_game uuid,p jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select case when p->>'action' in ('next','end_turn','undo_turn')
    then vtt_private.change_turn(p_game,p)
    else vtt_private.apply_encounter(auth.uid(),p_game,p,'[]'::jsonb) end;
$$;
