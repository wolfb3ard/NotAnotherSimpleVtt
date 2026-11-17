-- Bounded ephemeral slots, not campaign history. No direct API reads/writes or
-- replication: every response rechecks membership, active scene and current fog.
create table public.room_leases (
  game_id uuid not null,
  user_id uuid not null,
  tab_id uuid not null,
  live boolean not null,
  seen_at timestamptz not null,
  primary key(game_id,user_id,tab_id),
  foreign key(game_id,user_id) references public.memberships(game_id,user_id) on delete cascade
);
create index room_leases_user_idx on public.room_leases(user_id);
create table public.attention_signals (
  game_id uuid not null,
  user_id uuid not null,
  kind text not null check(kind in ('ping','camera')),
  id uuid not null default gen_random_uuid(),
  scene_id uuid not null references public.scenes on delete cascade,
  scene_revision integer not null,
  x double precision not null,
  y double precision not null,
  created_at timestamptz not null,
  primary key(game_id,user_id,kind),
  foreign key(game_id,user_id) references public.memberships(game_id,user_id) on delete cascade
);
create index attention_signals_user_idx on public.attention_signals(user_id);
create index attention_signals_scene_idx on public.attention_signals(scene_id);
alter table public.room_leases enable row level security;
alter table public.attention_signals enable row level security;
revoke all on public.room_leases,public.attention_signals from public,anon,authenticated;

-- Leaving a scene permanently discards its ephemeral requests, including when
-- the GM returns to the same scene before their TTL would have elapsed.
create function public.clear_scene_attention() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.attention_signals where game_id=new.id;
  return new;
end; $$;
revoke all on function public.clear_scene_attention() from public,anon,authenticated;
create trigger clear_scene_attention after update of active_scene_id on public.games
  for each row when(old.active_scene_id is distinct from new.active_scene_id)
  execute function public.clear_scene_attention();

-- Definer is necessary for RPC-only tables. Authenticated identity is never
-- supplied by the client. Game-first serialization shares the fog/movement lock.
create function public.send_attention(
  p_game uuid,p_scene uuid,p_revision integer,p_kind text,p_x double precision,p_y double precision
) returns void language plpgsql security definer set search_path='' as $$
declare s public.scenes; stamp timestamptz:=clock_timestamp();
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  if p_kind is null or p_kind not in ('ping','camera') then raise exception 'Invalid attention request'; end if;
  if p_kind='camera' and not public.is_gm(p_game) then raise exception 'GM required'; end if;
  select s1.* into s from public.scenes s1 join public.games g on g.active_scene_id=s1.id
    where g.id=p_game and s1.game_id=p_game and s1.id=p_scene;
  -- Even GMs must explicitly reveal a point before sharing it. No token ID,
  -- inferred token position, hidden-space fallback or automatic scene switch.
  if s.id is null or p_revision is null or s.revision<>p_revision
    or p_x is null or p_y is null or not (p_x>=0 and p_x<s.width and p_y>=0 and p_y<s.height)
    or not public.point_visible(s.fog,p_x,p_y) then raise exception 'Target unavailable. Choose revealed space on the current map.'; end if;
  if exists(select 1 from public.attention_signals where game_id=p_game and user_id=auth.uid()
    and kind=p_kind and created_at>stamp-interval '2 seconds') then raise exception 'Slow down. Wait two seconds.'; end if;
  insert into public.attention_signals(game_id,user_id,kind,scene_id,scene_revision,x,y,created_at)
    values(p_game,auth.uid(),p_kind,p_scene,p_revision,p_x,p_y,stamp)
    on conflict(game_id,user_id,kind) do update set id=gen_random_uuid(),scene_id=excluded.scene_id,
      scene_revision=excluded.scene_revision,x=excluded.x,y=excluded.y,created_at=excluded.created_at;
end; $$;
revoke all on function public.send_attention(uuid,uuid,integer,text,double precision,double precision) from public,anon;
grant execute on function public.send_attention(uuid,uuid,integer,text,double precision,double precision) to authenticated;

create function public.room_pulse(p_game uuid,p_tab uuid,p_live boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); people jsonb; signals jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if auth.uid() is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  if p_tab is null or p_live is null then raise exception 'Invalid presence request'; end if;
  delete from public.room_leases where game_id=p_game and seen_at<stamp-interval '12 seconds';
  delete from public.attention_signals where game_id=p_game and created_at<stamp-interval '20 seconds';
  if not exists(select 1 from public.room_leases where game_id=p_game and user_id=auth.uid() and tab_id=p_tab)
    and (select count(*) from public.room_leases where game_id=p_game and user_id=auth.uid())>=8
    then raise exception 'Too many tabs. Close a room tab and wait twelve seconds.'; end if;
  insert into public.room_leases values(p_game,auth.uid(),p_tab,p_live,stamp)
    on conflict(game_id,user_id,tab_id) do update set live=excluded.live,seen_at=excluded.seen_at;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into people from (
    select user_id,bool_or(live) as live,count(*) as tabs from public.room_leases
      where game_id=p_game and seen_at>=stamp-interval '12 seconds' group by user_id
  ) m;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]') into signals from (
    select a.id,a.user_id,a.kind,a.scene_id,a.scene_revision,a.x,a.y,a.created_at,
      a.created_at+case when a.kind='ping' then interval '8 seconds' else interval '20 seconds' end as expires_at
    from public.attention_signals a join public.games g on g.id=a.game_id
      join public.scenes s on s.id=g.active_scene_id and s.id=a.scene_id
    where a.game_id=p_game and a.scene_revision=s.revision
      and a.created_at>stamp-case when a.kind='ping' then interval '8 seconds' else interval '20 seconds' end
      and public.point_visible(s.fog,a.x,a.y)
      and (a.kind='ping' or exists(select 1 from public.games where id=p_game and gm_id=a.user_id))
  ) a;
  return jsonb_build_object('now',stamp,'members',people,'signals',signals);
end; $$;
revoke all on function public.room_pulse(uuid,uuid,boolean) from public,anon;
grant execute on function public.room_pulse(uuid,uuid,boolean) to authenticated;
