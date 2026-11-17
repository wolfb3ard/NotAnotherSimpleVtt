-- Grid configuration is shared, never a source of token positions or GM-private state.
alter table public.scenes add column grid jsonb not null
  default '{"enabled":false,"size":50,"origin_x":0,"origin_y":0}'::jsonb;
create function public.valid_scene_grid(g jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(
    jsonb_typeof(g)='object' and g ?& array['enabled','size','origin_x','origin_y']
    and (g - array['enabled','size','origin_x','origin_y'])='{}'::jsonb
    and jsonb_typeof(g->'enabled')='boolean'
    and jsonb_typeof(g->'size')='number'
    and jsonb_typeof(g->'origin_x')='number'
    and jsonb_typeof(g->'origin_y')='number'
    and (g->>'size')::numeric between 8 and 1024
    and (g->>'origin_x')::numeric between 0 and 4096
    and (g->>'origin_y')::numeric between 0 and 4096, false);
$$;
revoke all on function public.valid_scene_grid(jsonb) from public,anon;
grant execute on function public.valid_scene_grid(jsonb) to authenticated;
alter table public.scenes add constraint scenes_grid_valid check(public.valid_scene_grid(grid));

create table public.grid_receipts (
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  primary key(game_id,user_id,operation_id)
);
create index grid_receipts_user_idx on public.grid_receipts(user_id);
alter table public.grid_receipts enable row level security;
revoke all on public.grid_receipts from public,anon,authenticated;

-- Same game-first serialization as movement, undo, fog and placement. Definer
-- is required because direct client writes are denied; authority is checked here.
create function public.configure_scene_grid(p_game uuid,p jsonb) returns jsonb
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
  if s.id is null or not exists(select 1 from public.games where id=p_game and active_scene_id=s.id)
    then raise exception 'Active scene changed'; end if;
  if p->>'revision' is null or s.revision<>(p->>'revision')::integer
    then raise exception 'Scene changed. Review the latest map.'; end if;
  update public.scenes set grid=p->'grid',revision=revision+1 where id=s.id;
  insert into public.grid_receipts values(p_game,auth.uid(),(p->>'operation_id')::uuid,p);
  return '{"confirmed":"true"}'::jsonb;
end; $$;
revoke all on function public.configure_scene_grid(uuid,jsonb) from public,anon;
grant execute on function public.configure_scene_grid(uuid,jsonb) to authenticated;
