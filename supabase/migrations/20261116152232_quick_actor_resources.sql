-- No client table access: receipts are checked only after current edit authorization.
create table public.actor_resource_receipts (
  actor_id uuid not null references public.actors on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key (actor_id,user_id,operation_id)
);
create index actor_resource_receipts_user_idx on public.actor_resource_receipts(user_id);
alter table public.actor_resource_receipts enable row level security;
revoke all on public.actor_resource_receipts from public,anon,authenticated;

-- Like mutate_game, this boundary needs definer privileges: clients have no direct writes.
-- Lock order matches all other room/permission mutations.
create function public.adjust_actor_resources(
  p_game uuid,p_actor uuid,p_revision integer,p_operation uuid,p_changes jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.actors; receipt public.actor_resource_receipts; doc jsonb; change jsonb;
  f jsonb; si integer; fi integer; n numeric; seen text[]:='{}'; result jsonb;
  request jsonb:=jsonb_build_object('revision',p_revision,'changes',p_changes);
  grouped text[]:=array[
    '5e202024-0000-4000-8000-000032d8f81b','5e202024-0000-4000-8000-000030d8f4f5',
    '5e202024-0000-4000-8000-0000b49aaafe','5e202024-0000-4000-8000-0000b29aa7d8'];
  temp_id text:='5e202024-0000-4000-8000-0000472b6776';
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  if a.id is null or not public.can_edit_actor(a.id) then raise exception 'Resource edit denied'; end if;
  if p_operation is null or p_revision is null or p_revision<0 or
    jsonb_typeof(p_changes) is distinct from 'array' or
    jsonb_array_length(p_changes) not between 1 and 40 or pg_column_size(p_changes)>10000
    then raise exception 'Invalid resource adjustment'; end if;
  select * into receipt from public.actor_resource_receipts
    where actor_id=a.id and user_id=auth.uid() and operation_id=p_operation;
  if receipt.actor_id is not null then
    if receipt.request is distinct from request then raise exception 'Operation already used for another adjustment'; end if;
    return receipt.result;
  end if;
  if a.revision<>p_revision then raise exception 'Sheet changed. Reload before adjusting resources.'; end if;
  doc:=a.sheet;
  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) is distinct from 'object' or
      not (change ? 'id' and change ? 'value') or
      (change - 'id' - 'value' - 'target')<>'{}'::jsonb or
      (change ? 'target' and change->>'target' is distinct from 'feature') or
      jsonb_typeof(change->'value') is distinct from 'number' or
      coalesce(change->>'target','field')||':'||(change->>'id')=any(seen)
      then raise exception 'Invalid resource adjustment'; end if;
    perform (change->>'id')::uuid;
    seen:=array_append(seen,coalesce(change->>'target','field')||':'||(change->>'id'));
    n:=(change->>'value')::numeric;
    if change->>'target'='feature' then
      select x.ordinality::int-1,x.value into fi,f
        from jsonb_array_elements(doc->'character'->'features') with ordinality x
        where x.value->>'id'=change->>'id';
      if f is null or n<>trunc(n) or n<0 or n>(f->>'maxUses')::numeric then
        raise exception 'Feature uses must be between zero and maximum';
      end if;
      doc:=jsonb_set(doc,array['character','features',fi::text,'uses'],change->'value');
      continue;
    end if;
    select s.ordinality::int-1,x.ordinality::int-1,x.value into si,fi,f
      from jsonb_array_elements(doc->'sections') with ordinality s,
      lateral jsonb_array_elements(s.value->'fields') with ordinality x
      where x.value->>'id'=change->>'id';
    -- Temporary HP is optional for existing D&D sheets. Add only on explicit use.
    if f is null and change->>'id'=temp_id and exists(
      select 1 from jsonb_array_elements(doc->'sections') s
      where s->>'id'='5e202024-0000-4000-8000-00008b3aa710'
    ) then
      select s.ordinality::int-1,jsonb_array_length(s.value->'fields') into si,fi
        from jsonb_array_elements(doc->'sections') with ordinality s
        where exists(select 1 from jsonb_array_elements(s.value->'fields') x
          where x->>'id'='5e202024-0000-4000-8000-0000513ad265');
      f:=jsonb_build_object('id',temp_id,'label','Temporary HP','kind','resource','value',0,'max',1e12);
      doc:=jsonb_insert(doc,array['sections',si::text,'fields',fi::text],f);
    end if;
    n:=(change->>'value')::numeric;
    if f is null or f->>'kind'<>'resource' or n<0 or n>(f->>'max')::numeric or n>1e12 then
      raise exception 'Resource value must be between zero and its maximum';
    end if;
    doc:=jsonb_set(doc,array['sections',si::text,'fields',fi::text,'value'],change->'value');
  end loop;
  -- A grouped Hit Die counter is authoritative; its summary is not an independent pool.
  if exists(select 1 from jsonb_array_elements(doc->'sections') s,
    lateral jsonb_array_elements(s->'fields') x where x->>'id'=any(grouped)) then
    if 'field:5e202024-0000-4000-8000-0000fc19f796'=any(seen) then
      raise exception 'Adjust grouped Hit Dice instead of the summary';
    end if;
    select coalesce(sum((x->>'value')::numeric),0) into n
      from jsonb_array_elements(doc->'sections') s,
      lateral jsonb_array_elements(s->'fields') x where x->>'id'=any(grouped);
    select s.ordinality::int-1,x.ordinality::int-1,x.value into si,fi,f
      from jsonb_array_elements(doc->'sections') with ordinality s,
      lateral jsonb_array_elements(s.value->'fields') with ordinality x
      where x.value->>'id'='5e202024-0000-4000-8000-0000fc19f796';
    if f is not null then
      doc:=jsonb_set(doc,array['sections',si::text,'fields',fi::text,'value'],
        to_jsonb(least(n,(f->>'max')::numeric)));
    end if;
  end if;
  if not public.valid_sheet(doc) then raise exception 'Invalid resource result'; end if;
  update public.actors set sheet=doc,revision=revision+1 where id=a.id;
  result:=jsonb_build_object('revision',(a.revision+1)::text,'sheet',doc::text);
  insert into public.actor_resource_receipts values(a.id,auth.uid(),p_operation,request,result);
  return result;
end; $$;
revoke all on function public.adjust_actor_resources(uuid,uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.adjust_actor_resources(uuid,uuid,integer,uuid,jsonb) to authenticated;
