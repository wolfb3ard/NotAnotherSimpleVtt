-- Actor RLS already restricts these private fields to GM/owner/sheet grantees.
-- Combat revisions are independent of configuration/resources/appearance.
alter table public.actors
  add column combat jsonb not null default '{"conditions":[],"concentration":null,"death":{"successes":0,"failures":0,"stable":false}}',
  add column combat_revision integer not null default 0;

create function vtt_private.valid_combat(s jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare c jsonb; e jsonb; n text; ids text[]:='{}';
begin
  if jsonb_typeof(s) is distinct from 'object' or pg_column_size(s)>70000 or
    not(s ?& array['conditions','concentration','death']) or
    s-'conditions'-'concentration'-'death'<>'{}'::jsonb or
    jsonb_typeof(s->'conditions') is distinct from 'array' or
    jsonb_array_length(s->'conditions')>30 then return false; end if;
  for c in select value from jsonb_array_elements(s->'conditions') loop
    if jsonb_typeof(c) is distinct from 'object' or
      not(c ?& array['id','name','source','notes','expiry','due']) or
      c-'id'-'name'-'source'-'notes'-'expiry'-'due'<>'{}'::jsonb or
      (c->>'id')::uuid is null or c->>'id'=any(ids) or
      jsonb_typeof(c->'name') is distinct from 'string' or length(trim(c->>'name')) not between 1 and 80 or
      jsonb_typeof(c->'source') is distinct from 'string' or length(c->>'source')>160 or
      jsonb_typeof(c->'notes') is distinct from 'string' or length(c->>'notes')>1000 or
      jsonb_typeof(c->'due') is distinct from 'boolean' then return false; end if;
    ids:=array_append(ids,c->>'id'); e:=c->'expiry';
    if e<>'null'::jsonb then
      if jsonb_typeof(e) is distinct from 'object' or
        not(e ?& array['encounter_id','round','phase']) or
        e-'encounter_id'-'round'-'phase'<>'{}'::jsonb or
        (e->>'encounter_id')::uuid is null or
        jsonb_typeof(e->'round') is distinct from 'number' or
        (e->>'round')::numeric<>trunc((e->>'round')::numeric) or
        (e->>'round')::numeric not between 1 and 1000000 or
        coalesce(e->>'phase','') not in ('start','end') then return false; end if;
    end if;
  end loop;
  c:=s->'death';
  if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['successes','failures','stable']) or
    c-'successes'-'failures'-'stable'<>'{}'::jsonb or
    jsonb_typeof(c->'stable') is distinct from 'boolean' then return false; end if;
  foreach n in array array['successes','failures'] loop
    if jsonb_typeof(c->n) is distinct from 'number' or (c->>n)::numeric<>trunc((c->>n)::numeric) or
      (c->>n)::numeric not between 0 and 3 then return false; end if;
  end loop;
  c:=s->'concentration';
  if c<>'null'::jsonb then
    if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['source','notes','checks']) or
      c-'source'-'notes'-'checks'<>'{}'::jsonb or
      jsonb_typeof(c->'source') is distinct from 'string' or length(trim(c->>'source')) not between 1 and 160 or
      jsonb_typeof(c->'notes') is distinct from 'string' or length(c->>'notes')>1000 or
      jsonb_typeof(c->'checks') is distinct from 'array' or jsonb_array_length(c->'checks')>100 then return false; end if;
    ids:='{}';
    for e in select value from jsonb_array_elements(c->'checks') loop
      if jsonb_typeof(e) is distinct from 'object' or not(e ?& array['id','damage','dc']) or
        e-'id'-'damage'-'dc'<>'{}'::jsonb or (e->>'id')::uuid is null or e->>'id'=any(ids) or
        jsonb_typeof(e->'damage') is distinct from 'number' or (e->>'damage')::numeric not between 0 and 2e12 or
        jsonb_typeof(e->'dc') is distinct from 'number' or (e->>'dc')::numeric<>trunc((e->>'dc')::numeric) or
        (e->>'dc')::numeric not between 10 and 30 then return false; end if;
      ids:=array_append(ids,e->>'id');
    end loop;
  end if;
  return true;
exception when others then return false;
end; $$;
alter table public.actors add constraint actors_valid_combat check(vtt_private.valid_combat(combat));

create table vtt_private.combat_receipts (
  actor_id uuid not null references public.actors on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key(actor_id,user_id,operation_id)
);
create index combat_receipts_user_idx on vtt_private.combat_receipts(user_id);
alter table vtt_private.combat_receipts enable row level security;
revoke all on vtt_private.combat_receipts from public,anon,authenticated;

-- Same authorized mutation boundary and game-first serialization as resource writes.
create function public.save_actor_combat(p_game uuid,p_actor uuid,p_revision integer,p_operation uuid,p_state jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.actors; r vtt_private.combat_receipts; c jsonb; result jsonb;
  request jsonb:=jsonb_build_object('revision',p_revision,'state',p_state);
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  if a.id is null or not public.can_edit_actor(a.id) then raise exception 'Combat edit denied'; end if;
  if p_operation is null or p_revision is null or p_revision<0 or
    not coalesce(vtt_private.valid_combat(p_state),false) then raise exception 'Invalid combat state'; end if;
  select * into r from vtt_private.combat_receipts
    where actor_id=a.id and user_id=auth.uid() and operation_id=p_operation;
  if r.actor_id is not null then
    if r.request is distinct from request then raise exception 'Operation already used'; end if;
    return r.result;
  end if;
  if a.combat_revision<>p_revision then raise exception 'Combat changed. Reload before editing.'; end if;
  for c in select value from jsonb_array_elements(p_state->'conditions') loop
    -- Unchanged anchors may refer to an ended/deleted encounter; manual removal still works.
    if c->'expiry'<>'null'::jsonb and not exists(
      select 1 from jsonb_array_elements(a.combat->'conditions') old
      where old->>'id'=c->>'id' and old->'expiry'=c->'expiry'
    ) and not exists(
      select 1 from public.encounter_participants p join public.encounters e on e.id=p.encounter_id
        join public.tokens t on t.id=p.token_id
      where e.id=(c->'expiry'->>'encounter_id')::uuid and e.game_id=p_game and e.status<>'ended'
        and t.actor_id=a.id and public.can_read_token(p.token_id)
    ) then raise exception 'Expiry target unavailable'; end if;
  end loop;
  update public.actors set combat=p_state,combat_revision=combat_revision+1 where id=a.id;
  result:=jsonb_build_object('id',a.id::text,'revision',(a.combat_revision+1)::text);
  insert into vtt_private.combat_receipts values(a.id,auth.uid(),p_operation,request,result);
  return result;
end; $$;
revoke all on function public.save_actor_combat(uuid,uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.save_actor_combat(uuid,uuid,integer,uuid,jsonb) to authenticated;

-- Resource/configuration changes can warrant a check, but never adjudicate it.
create function vtt_private.combat_health_prompt() returns trigger
language plpgsql set search_path='' as $$
declare damage numeric; checks jsonb;
begin
  if new.sheet is not distinct from old.sheet or old.combat->'concentration'='null'::jsonb then return new; end if;
  select coalesce(sum(greatest(0,(o.f->>'value')::numeric-(n.f->>'value')::numeric)),0) into damage
    from jsonb_array_elements(old.sheet->'sections') os,
    lateral jsonb_array_elements(os->'fields') o(f),
    jsonb_array_elements(new.sheet->'sections') ns,
    lateral jsonb_array_elements(ns->'fields') n(f)
    where o.f->>'id'=n.f->>'id' and o.f->>'kind'='resource' and n.f->>'kind'='resource'
      and o.f->>'id' in ('5e202024-0000-4000-8000-0000513ad265','5e202024-0000-4000-8000-0000472b6776',
        '5e202024-0000-4000-8000-00003012c171','5e202024-0000-4000-8000-0000f4460fb7');
  if damage>0 then
    checks:=new.combat->'concentration'->'checks';
    -- Keep bookkeeping available even after prolonged unresolved damage.
    if jsonb_array_length(checks)>=100 then
      checks:=jsonb_set(checks,'{99,damage}',to_jsonb(least(2e12,damage+(checks->99->>'damage')::numeric)));
      checks:=jsonb_set(checks,'{99,dc}',to_jsonb(greatest((checks->99->>'dc')::numeric,
        least(30,greatest(10,floor(damage/2))))));
    else
      checks:=checks||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'damage',damage,
        'dc',least(30,greatest(10,floor(damage/2)))));
    end if;
    new.combat:=jsonb_set(new.combat,'{concentration,checks}',checks);
    new.combat_revision:=old.combat_revision+1;
  end if;
  return new;
end; $$;
create trigger combat_health_prompt before update of sheet on public.actors
  for each row execute function vtt_private.combat_health_prompt();

-- Persist due prompts so missed turns/reconnects never silently remove a marker.
create function vtt_private.combat_turn_prompts() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status<>'active' or new.status='ended' or
    (new.active_token_id is not distinct from old.active_token_id and new.round=old.round) then return new; end if;
  update public.actors a set combat=jsonb_set(a.combat,'{conditions}',(
    select jsonb_agg(case when not (c->>'due')::boolean and c->'expiry'->>'encounter_id'=new.id::text and (
      (c->'expiry'->>'phase'='end' and exists(select 1 from public.tokens t where t.id=old.active_token_id and t.actor_id=a.id) and
        (c->'expiry'->>'round')::int<=old.round) or
      (c->'expiry'->>'phase'='start' and exists(select 1 from public.tokens t where t.id=new.active_token_id and t.actor_id=a.id) and
        (c->'expiry'->>'round')::int<=new.round)
      ) then jsonb_set(c,'{due}','true') else c end order by ord)
    from jsonb_array_elements(a.combat->'conditions') with ordinality x(c,ord)
  )),combat_revision=combat_revision+1
  where a.game_id=new.game_id and exists(
    select 1 from jsonb_array_elements(a.combat->'conditions') c
    where not (c->>'due')::boolean and c->'expiry'->>'encounter_id'=new.id::text and (
      (c->'expiry'->>'phase'='end' and exists(select 1 from public.tokens t where t.id=old.active_token_id and t.actor_id=a.id) and
        (c->'expiry'->>'round')::int<=old.round) or
      (c->'expiry'->>'phase'='start' and exists(select 1 from public.tokens t where t.id=new.active_token_id and t.actor_id=a.id) and
        (c->'expiry'->>'round')::int<=new.round)
    )
  );
  return new;
end; $$;
create trigger combat_turn_prompts after update on public.encounters
  for each row execute function vtt_private.combat_turn_prompts();
