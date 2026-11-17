-- One shared area per member/scene. Previews are browser-memory only.
-- RPC-only tables prevent unfiltered reads/realtime payloads.
create table public.tactical_templates (
  game_id uuid not null,
  owner_id uuid not null,
  scene_id uuid not null references public.scenes on delete cascade,
  scene_revision integer not null,
  revision integer not null,
  area jsonb,
  primary key(game_id,owner_id,scene_id),
  foreign key(game_id,owner_id) references public.memberships(game_id,user_id) on delete cascade
);
create index tactical_templates_owner_idx on public.tactical_templates(owner_id);
create index tactical_templates_scene_idx on public.tactical_templates(scene_id);
create table public.tactical_template_receipts (
  game_id uuid not null,
  user_id uuid not null,
  operation_id uuid not null,
  request jsonb not null,
  primary key(game_id,user_id,operation_id),
  foreign key(game_id,user_id) references public.memberships(game_id,user_id) on delete cascade
);
create index tactical_template_receipts_user_idx on public.tactical_template_receipts(user_id);
alter table public.tactical_templates enable row level security;
alter table public.tactical_template_receipts enable row level security;
revoke all on public.tactical_templates,public.tactical_template_receipts from public,anon,authenticated;
create trigger tactical_templates_notify after insert or update or delete on public.tactical_templates
  for each row execute function public.notify_room();

-- Definer required for RPC-only state; identity, membership, ownership, scene
-- and fog are checked here under the same game-first lock as fog/navigation.
create function public.tactical_template_command(p_game uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.scenes; old public.tactical_templates; previous jsonb; a jsonb;
  owner uuid; op uuid; expected integer;
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>2000
    or not (p ?& array['scene_id','scene_revision','owner_id','revision','operation_id','area'])
    then raise exception 'Invalid template request'; end if;
  owner:=(p->>'owner_id')::uuid; op:=(p->>'operation_id')::uuid;
  expected:=(p->>'revision')::integer;
  if owner is null or op is null or expected is null or expected<0 then raise exception 'Invalid template request'; end if;
  if owner<>auth.uid() and not public.is_gm(p_game) then raise exception 'Template owner or GM required'; end if;
  if not exists(select 1 from public.memberships where game_id=p_game and user_id=owner)
    then raise exception 'Template owner unavailable'; end if;
  select request into previous from public.tactical_template_receipts
    where game_id=p_game and user_id=auth.uid() and operation_id=op;
  if found then
    if previous<>p then raise exception 'Operation already used'; end if;
    return '{"confirmed":"true"}';
  end if;
  select * into s from public.scenes where id=(p->>'scene_id')::uuid and game_id=p_game;
  if s.id is null or not exists(select 1 from public.games where id=p_game and active_scene_id=s.id)
    then raise exception 'Active scene changed'; end if;
  if p->>'scene_revision' is null or s.revision<>(p->>'scene_revision')::integer
    then raise exception 'Scene changed. Review the latest map.'; end if;
  select * into old from public.tactical_templates where game_id=p_game and owner_id=owner and scene_id=s.id;
  if coalesce(old.revision,0)<>expected then raise exception 'Template changed. Review the latest area.'; end if;
  a:=nullif(p->'area','null'::jsonb);
  if a is not null then
    if not s.calibrated then raise exception 'Calibrate the map before sharing templates'; end if;
    if jsonb_typeof(a)<>'object' or not (a ?& array['kind','x','y','size','width','rotation'])
      or (a-array['kind','x','y','size','width','rotation'])<>'{}'
      or a->>'kind' not in ('circle','cone','line','cube')
      or jsonb_typeof(a->'kind')<>'string'
      or jsonb_typeof(a->'x')<>'number' or jsonb_typeof(a->'y')<>'number'
      or jsonb_typeof(a->'size')<>'number' or jsonb_typeof(a->'width')<>'number'
      or jsonb_typeof(a->'rotation')<>'number'
      then raise exception 'Invalid template area'; end if;
    if not ((a->>'x')::numeric>=0 and (a->>'x')::numeric<s.width
      and (a->>'y')::numeric>=0 and (a->>'y')::numeric<s.height
      and (a->>'size')::numeric>0 and (a->>'size')::numeric<=10000
      and (a->>'width')::numeric>0 and (a->>'width')::numeric<=10000
      and (a->>'rotation')::numeric between 0 and 360)
      or not public.point_visible(s.fog,(a->>'x')::double precision,(a->>'y')::double precision)
      then raise exception 'Choose a valid area anchored in revealed map space'; end if;
  end if;
  insert into public.tactical_templates values(p_game,owner,s.id,s.revision,expected+1,a)
    on conflict(game_id,owner_id,scene_id) do update set
      area=excluded.area,scene_revision=excluded.scene_revision,revision=excluded.revision;
  insert into public.tactical_template_receipts values(p_game,auth.uid(),op,p);
  return '{"confirmed":"true"}';
end; $$;
revoke all on function public.tactical_template_command(uuid,jsonb) from public,anon;
grant execute on function public.tactical_template_command(uuid,jsonb) to authenticated;

create function public.tactical_template_snapshot(p_game uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'owner_id',t.owner_id,'scene_id',t.scene_id,'scene_revision',s.revision,'revision',t.revision,
    'area',case when t.scene_revision=s.revision and t.area is not null
      and public.point_visible(s.fog,(t.area->>'x')::double precision,(t.area->>'y')::double precision)
      then t.area else null end
  )),'[]') into result from public.tactical_templates t
    join public.games g on g.id=t.game_id and g.active_scene_id=t.scene_id
    join public.scenes s on s.id=t.scene_id and s.game_id=t.game_id
    where t.game_id=p_game and (t.owner_id=auth.uid() or (
      t.area is not null and t.scene_revision=s.revision
      and public.point_visible(s.fog,(t.area->>'x')::double precision,(t.area->>'y')::double precision)));
  return result;
end; $$;
revoke all on function public.tactical_template_snapshot(uuid) from public,anon;
grant execute on function public.tactical_template_snapshot(uuid) to authenticated;
