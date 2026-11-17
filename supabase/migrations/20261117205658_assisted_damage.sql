-- A receipt is private to the caller and never appears in a room snapshot.
create table vtt_private.assisted_damage (
  actor_id uuid not null references public.actors on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  reverse_changes jsonb not null,
  combat_before jsonb not null,
  sheet_revision integer not null,
  combat_revision integer not null,
  undone_revision integer,
  primary key (actor_id,user_id,operation_id)
);
create index assisted_damage_user_idx on vtt_private.assisted_damage(user_id);
alter table vtt_private.assisted_damage enable row level security;
revoke all on vtt_private.assisted_damage from public,anon,authenticated;

create function public.assist_damage(p_game uuid,p_token uuid,p_actor uuid,p_operation uuid,
  p_revision integer,p_combat_revision integer,p_amount bigint,p_undo boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  active_scene uuid; a public.actors; r vtt_private.assisted_damage;
  request jsonb:=jsonb_build_object('token',p_token,'revision',p_revision,
    'combat_revision',p_combat_revision,'amount',p_amount);
  hp jsonb; temp jsonb; hp_id text; temp_id text; hp_after numeric; absorbed numeric;
  changes jsonb; reverse_changes jsonb;
begin
  -- Same lock order as resource, permission and scene mutations.
  select active_scene_id into active_scene from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game)
    or not exists (select 1 from public.tokens t where t.id=p_token and t.game_id=p_game
      and t.actor_id=p_actor and t.scene_id=active_scene)
    or not public.can_read_token(p_token) or not public.can_edit_actor(p_actor)
    then raise exception 'Damage target unavailable'; end if;
  select * into a from public.actors where id=p_actor and game_id=p_game for update;
  if a.id is null then raise exception 'Damage target unavailable'; end if;
  select * into r from vtt_private.assisted_damage
    where actor_id=a.id and user_id=auth.uid() and operation_id=p_operation;
  if p_undo is true then
    if r.actor_id is null or r.request->>'token' is distinct from p_token::text
      then raise exception 'Damage operation unavailable'; end if;
    if r.undone_revision is not null then
      return jsonb_build_object('revision',r.undone_revision::text);
    end if;
    if a.revision<>r.sheet_revision or a.combat_revision<>r.combat_revision
      then raise exception 'Target changed after damage. Undo would overwrite newer edits.'; end if;
    perform public.adjust_actor_resources(p_game,a.id,a.revision,gen_random_uuid(),r.reverse_changes);
    if a.combat is distinct from r.combat_before then
      update public.actors set combat=r.combat_before,combat_revision=combat_revision+1 where id=a.id;
    end if;
    update vtt_private.assisted_damage set undone_revision=a.revision+1
      where actor_id=a.id and user_id=auth.uid() and operation_id=p_operation;
    return jsonb_build_object('revision',(a.revision+1)::text);
  end if;
  if p_undo is distinct from false or p_operation is null or p_revision is null
    or p_combat_revision is null or p_amount is null or p_amount not between 1 and 1000000000000
    then raise exception 'Invalid damage request'; end if;
  if r.actor_id is not null then
    if r.request is distinct from request then raise exception 'Damage operation already used'; end if;
    return jsonb_build_object('revision',r.sheet_revision::text);
  end if;
  if a.revision<>p_revision or a.combat_revision<>p_combat_revision
    then raise exception 'Target changed. Review a new damage preview.'; end if;
  -- Match the stable D&D and monster health counters, not user-entered labels.
  if exists(select 1 from jsonb_array_elements(a.sheet->'sections') s
    where s->>'id'='5e202024-0000-4000-8000-00008b3aa710') then
    hp_id:='5e202024-0000-4000-8000-0000513ad265';
    temp_id:='5e202024-0000-4000-8000-0000472b6776';
  elsif exists(select 1 from jsonb_array_elements(a.sheet->'sections') s,
    lateral jsonb_array_elements(s->'fields') f
    where f->>'id'='5e202024-0000-4000-8000-0000bf8b280c' and f->>'value' like 'monster-%') then
    hp_id:='5e202024-0000-4000-8000-00003012c171';
    temp_id:='5e202024-0000-4000-8000-0000f4460fb7';
  else
    raise exception 'No supported HP counter';
  end if;
  select f into hp from jsonb_array_elements(a.sheet->'sections') s,
    lateral jsonb_array_elements(s->'fields') f where f->>'id'=hp_id and f->>'kind'='resource';
  select f into temp from jsonb_array_elements(a.sheet->'sections') s,
    lateral jsonb_array_elements(s->'fields') f where f->>'id'=temp_id and f->>'kind'='resource';
  if hp is null then raise exception 'No supported HP counter'; end if;
  absorbed:=least(coalesce((temp->>'value')::numeric,0),p_amount);
  hp_after:=greatest(0,(hp->>'value')::numeric-(p_amount-absorbed));
  changes:='[]'::jsonb;
  reverse_changes:='[]'::jsonb;
  if absorbed>0 then
    changes:=changes||jsonb_build_array(jsonb_build_object('id',temp_id,
      'value',(temp->>'value')::numeric-absorbed));
    reverse_changes:=reverse_changes||jsonb_build_array(jsonb_build_object('id',temp_id,'value',temp->'value'));
  end if;
  if hp_after<>(hp->>'value')::numeric then
    changes:=changes||jsonb_build_array(jsonb_build_object('id',hp_id,'value',hp_after));
    reverse_changes:=reverse_changes||jsonb_build_array(jsonb_build_object('id',hp_id,'value',hp->'value'));
  end if;
  if changes='[]'::jsonb then raise exception 'No HP to reduce; adjudicate manually'; end if;
  perform public.adjust_actor_resources(p_game,a.id,a.revision,gen_random_uuid(),changes);
  insert into vtt_private.assisted_damage
    (actor_id,user_id,operation_id,request,reverse_changes,combat_before,sheet_revision,combat_revision)
    select a.id,auth.uid(),p_operation,request,reverse_changes,a.combat,x.revision,x.combat_revision
    from public.actors x where x.id=a.id;
  return jsonb_build_object('revision',(a.revision+1)::text);
end;
$$;
revoke all on function public.assist_damage(uuid,uuid,uuid,uuid,integer,integer,bigint,boolean) from public,anon;
grant execute on function public.assist_damage(uuid,uuid,uuid,uuid,integer,integer,bigint,boolean) to authenticated;
