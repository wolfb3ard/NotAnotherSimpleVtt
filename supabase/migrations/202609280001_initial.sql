create extension if not exists pgcrypto with schema extensions;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  gm_id uuid not null references auth.users(id),
  active_scene_id uuid,
  dice integer[] not null default '{4,6,8,10,12,20,100}',
  created_at timestamptz not null default now()
);
create table public.memberships (
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('gm','player')),
  display_name text not null check (length(display_name) between 1 and 80),
  primary key (game_id, user_id)
);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  revoked boolean not null default false
);
create table public.actors (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  owner_id uuid not null references auth.users,
  name text not null check (length(name) between 1 and 100),
  kind text not null check (kind in ('character','npc','enemy')),
  sheet jsonb not null default '{"version":1,"sections":[]}',
  revision integer not null default 0,
  unique (id, game_id),
  foreign key (game_id, owner_id) references public.memberships(game_id,user_id)
);
create table public.sheet_grants (
  actor_id uuid not null references public.actors on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  can_edit boolean not null default false,
  primary key (actor_id, user_id)
);
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  creator_id uuid not null references auth.users,
  name text not null check (length(name) between 1 and 100),
  sheet jsonb not null
);
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  owner_id uuid not null references auth.users,
  kind text not null check (kind in ('background','token')),
  path text not null unique,
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  unique (id, game_id)
);
create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  name text not null check (length(name) between 1 and 100),
  asset_id uuid not null,
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  units_per_pixel double precision not null default 1 check (units_per_pixel > 0 and units_per_pixel < 1e9),
  unit text not null default 'units' check (length(unit) between 1 and 20),
  fog jsonb not null default '[]' check (jsonb_typeof(fog) = 'array' and jsonb_array_length(fog) <= 500),
  revision integer not null default 0,
  unique (id,game_id),
  foreign key (asset_id,game_id) references public.assets(id,game_id)
);
alter table public.games add constraint active_scene_same_game foreign key (active_scene_id,id) references public.scenes(id,game_id) deferrable initially deferred;
create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  scene_id uuid not null,
  actor_id uuid not null,
  controller_id uuid not null,
  label text not null check (length(label) between 1 and 100),
  asset_id uuid,
  x double precision not null default 100 check (x >= 0 and x <= 4096),
  y double precision not null default 100 check (y >= 0 and y <= 4096),
  size double precision not null default 48 check (size between 16 and 256),
  hidden boolean not null default false,
  revision integer not null default 0,
  foreign key (scene_id,game_id) references public.scenes(id,game_id) on delete cascade,
  foreign key (actor_id,game_id) references public.actors(id,game_id) on delete cascade,
  foreign key (asset_id,game_id) references public.assets(id,game_id),
  foreign key (game_id,controller_id) references public.memberships(game_id,user_id)
);
create table public.rolls (
  id uuid primary key,
  game_id uuid not null references public.games on delete cascade,
  author_id uuid not null references auth.users,
  author_name text not null,
  actor_id uuid,
  expression text not null check (length(expression) between 1 and 500),
  visibility text not null check (visibility in ('public','private')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (actor_id,game_id) references public.actors(id,game_id)
);
create index actors_game_idx on public.actors(game_id);
create index tokens_scene_idx on public.tokens(scene_id);
create index scenes_game_idx on public.scenes(game_id);
create index templates_game_idx on public.templates(game_id);
create index rolls_game_time_idx on public.rolls(game_id,created_at desc);
create index memberships_user_idx on public.memberships(user_id);

create function public.is_member(g uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships where game_id=g and user_id=auth.uid());
$$;
create function public.is_gm(g uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.games where id=g and gm_id=auth.uid());
$$;
create function public.can_read_actor(a uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.actors x where x.id=a and public.is_member(x.game_id) and
    (public.is_gm(x.game_id) or x.owner_id=auth.uid() or exists(select 1 from public.sheet_grants where actor_id=a and user_id=auth.uid())));
$$;
create function public.can_edit_actor(a uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.actors x where x.id=a and public.is_member(x.game_id) and
    (public.is_gm(x.game_id) or x.owner_id=auth.uid() or exists(select 1 from public.sheet_grants where actor_id=a and user_id=auth.uid() and can_edit)));
$$;
create function public.point_visible(fog jsonb, px double precision, py double precision) returns boolean language plpgsql immutable set search_path = '' as $$
declare r jsonb; visible boolean := false;
begin
  for r in select value from jsonb_array_elements(fog) loop
    if px >= (r->>'x')::float8 and px < (r->>'x')::float8+(r->>'width')::float8 and py >= (r->>'y')::float8 and py < (r->>'y')::float8+(r->>'height')::float8 then
      visible := (r->>'reveal')::boolean;
    end if;
  end loop;
  return visible;
end; $$;
create function public.can_read_token(t uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tokens x join public.scenes s on s.id=x.scene_id join public.games g on g.id=x.game_id
    where x.id=t and public.is_member(x.game_id) and (public.is_gm(x.game_id) or
    (not x.hidden and g.active_scene_id=s.id and public.point_visible(s.fog,x.x,x.y))));
$$;

alter table public.games enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.actors enable row level security;
alter table public.sheet_grants enable row level security;
alter table public.templates enable row level security;
alter table public.assets enable row level security;
alter table public.scenes enable row level security;
alter table public.tokens enable row level security;
alter table public.rolls enable row level security;
create policy games_read on public.games for select to authenticated using (public.is_member(id));
create policy memberships_read on public.memberships for select to authenticated using (public.is_member(game_id));
create policy invitations_read on public.invitations for select to authenticated using (public.is_gm(game_id));
create policy actors_read on public.actors for select to authenticated using (public.can_read_actor(id));
create policy grants_read on public.sheet_grants for select to authenticated using (public.can_read_actor(actor_id));
create policy templates_read on public.templates for select to authenticated using (public.is_member(game_id));
create policy assets_read on public.assets for select to authenticated using (public.is_member(game_id) and (public.is_gm(game_id) or (kind='token' and (owner_id=auth.uid() or exists(select 1 from public.tokens where asset_id=assets.id and public.can_read_token(id))))));
create policy scenes_read on public.scenes for select to authenticated using (public.is_gm(game_id) or (public.is_member(game_id) and exists(select 1 from public.games where id=game_id and active_scene_id=scenes.id)));
create policy tokens_read on public.tokens for select to authenticated using (public.can_read_token(id));
create policy rolls_read on public.rolls for select to authenticated using (public.is_member(game_id) and (visibility='public' or author_id=auth.uid() or public.is_gm(game_id)));

-- All writes go through validated RPCs or the server-only service role.
revoke all on public.games,public.memberships,public.invitations,public.actors,public.sheet_grants,public.templates,public.assets,public.scenes,public.tokens,public.rolls from anon, authenticated;
grant select on public.games,public.memberships,public.invitations,public.actors,public.sheet_grants,public.templates,public.assets,public.scenes,public.tokens,public.rolls to authenticated;

create function public.create_game(p_name text, p_display_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  insert into public.games(name,gm_id) values(trim(p_name),auth.uid()) returning id into g;
  insert into public.memberships values(g,auth.uid(),'gm',trim(p_display_name));
  return g;
end; $$;

create function public.accept_invite(p_token text, p_display_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  select game_id into g from public.invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and not revoked and expires_at>now() for update;
  if g is null then raise exception 'Invitation is invalid, expired, or revoked'; end if;
  insert into public.memberships values(g,auth.uid(),'player',trim(p_display_name)) on conflict do nothing;
  return g;
end; $$;

-- Single authorization boundary for game mutations; optimistic revisions reject stale edits.
create function public.mutate_game(p_game uuid, p_command text, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare gm boolean; uid uuid := auth.uid(); a public.actors; s public.scenes; t public.tokens; asset public.assets; tpl public.templates; new_id uuid; invitation_token text; n integer; fog_item jsonb;
begin
  -- Serialize room mutations, invitations, and permission changes.
  perform 1 from public.games where id=p_game for update;
  if not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  gm := public.is_gm(p_game);
  if pg_column_size(p)>200000 then raise exception 'Request too large'; end if;
  case p_command
  when 'invite' then
    if not gm then raise exception 'GM required'; end if;
    invitation_token := encode(extensions.gen_random_bytes(24),'hex');
    insert into public.invitations(game_id,token_hash) values(p_game,encode(extensions.digest(invitation_token,'sha256'),'hex'));
    return jsonb_build_object('token',invitation_token);
  when 'revoke_invites' then
    if not gm then raise exception 'GM required'; end if;
    update public.invitations set revoked=true where game_id=p_game;
  when 'dice' then
    if not gm then raise exception 'GM required'; end if;
    if jsonb_typeof(p->'dice') <> 'array' or jsonb_array_length(p->'dice') not between 1 and 30 then raise exception 'Choose 1–30 die types'; end if;
    if exists(select 1 from jsonb_array_elements_text(p->'dice') v where v::integer not between 2 and 1000000) then raise exception 'Invalid die size'; end if;
    update public.games set dice=array(select distinct v::integer from jsonb_array_elements_text(p->'dice') v order by v::integer) where id=p_game;
  when 'actor_create' then
    if not gm and (p->>'kind'<>'character' or (p->>'owner_id')::uuid<>uid) then raise exception 'Only your characters may be created'; end if;
    insert into public.actors(game_id,owner_id,name,kind,sheet) values(p_game,(p->>'owner_id')::uuid,p->>'name',p->>'kind',coalesce(p->'sheet','{"version":1,"sections":[]}'::jsonb)) returning id into new_id;
    return jsonb_build_object('id',new_id);
  when 'actor_save' then
    select * into a from public.actors where id=(p->>'id')::uuid and game_id=p_game;
    if a.id is null or not public.can_edit_actor(a.id) then raise exception 'Sheet edit denied'; end if;
    update public.actors set name=p->>'name',sheet=p->'sheet',revision=revision+1 where id=a.id and revision=(p->>'revision')::integer;
    if not found then raise exception 'Sheet changed. Reload before saving again.'; end if;
  when 'grant' then
    if not gm then raise exception 'GM required'; end if;
    select * into a from public.actors where id=(p->>'actor_id')::uuid and game_id=p_game;
    if a.id is null or not exists(select 1 from public.memberships where game_id=p_game and user_id=(p->>'user_id')::uuid) then raise exception 'Invalid sheet or member'; end if;
    delete from public.sheet_grants where actor_id=a.id and user_id=(p->>'user_id')::uuid;
    if p->>'access'<>'none' then insert into public.sheet_grants values(a.id,(p->>'user_id')::uuid,p->>'access'='edit'); end if;
  when 'template_create' then
    select * into a from public.actors where id=(p->>'actor_id')::uuid and game_id=p_game;
    if a.id is null or not public.can_edit_actor(a.id) then raise exception 'Sheet edit access required'; end if;
    insert into public.templates(game_id,creator_id,name,sheet) values(p_game,uid,p->>'name',a.sheet);
  when 'template_copy' then
    select * into tpl from public.templates where id=(p->>'id')::uuid and creator_id=uid;
    if tpl.id is null or not public.is_member(tpl.game_id) then raise exception 'Only your templates can be copied'; end if;
    insert into public.templates(game_id,creator_id,name,sheet) values(p_game,uid,tpl.name,tpl.sheet);
  when 'scene_create' then
    if not gm then raise exception 'GM required'; end if;
    select * into asset from public.assets where id=(p->>'asset_id')::uuid and game_id=p_game and kind='background';
    if asset.id is null then raise exception 'Invalid background'; end if;
    insert into public.scenes(game_id,name,asset_id,width,height) values(p_game,p->>'name',asset.id,asset.width,asset.height) returning id into new_id;
    update public.games set active_scene_id=coalesce(active_scene_id,new_id) where id=p_game;
  when 'scene_activate' then
    if not gm then raise exception 'GM required'; end if;
    update public.games set active_scene_id=(p->>'id')::uuid where id=p_game;
  when 'scene_update' then
    if not gm then raise exception 'GM required'; end if;
    select * into s from public.scenes where id=(p->>'id')::uuid and game_id=p_game;
    if s.id is null then raise exception 'Scene not found'; end if;
    if p ? 'fog' then
      if jsonb_typeof(p->'fog')<>'array' or jsonb_array_length(p->'fog')>500 then raise exception 'Too many fog areas'; end if;
      for fog_item in select value from jsonb_array_elements(p->'fog') loop
        if not (fog_item ?& array['x','y','width','height','reveal']) or
          (fog_item->>'x')::float8 not between 0 and 4096 or (fog_item->>'y')::float8 not between 0 and 4096 or
          (fog_item->>'width')::float8 not between 0.01 and 4096 or (fog_item->>'height')::float8 not between 0.01 and 4096 or
          jsonb_typeof(fog_item->'reveal')<>'boolean' then raise exception 'Invalid fog area'; end if;
      end loop;
    end if;
    update public.scenes set fog=coalesce(p->'fog',fog),units_per_pixel=coalesce((p->>'units_per_pixel')::float8,units_per_pixel),unit=coalesce(p->>'unit',unit),revision=revision+1 where id=s.id and revision=(p->>'revision')::integer;
    if not found then raise exception 'Scene changed. Try again with the latest scene.'; end if;
  when 'token_create' then
    select * into a from public.actors where id=(p->>'actor_id')::uuid and game_id=p_game;
    select * into s from public.scenes where id=(p->>'scene_id')::uuid and game_id=p_game;
    if a.id is null or s.id is null or (not gm and (a.owner_id<>uid or a.kind<>'character' or not exists(select 1 from public.games where id=p_game and active_scene_id=s.id))) then raise exception 'Token creation denied'; end if;
    if p->>'asset_id' is not null and not exists(select 1 from public.assets where id=(p->>'asset_id')::uuid and game_id=p_game and kind='token' and (gm or owner_id=uid)) then raise exception 'Invalid token image'; end if;
    insert into public.tokens(game_id,scene_id,actor_id,controller_id,label,asset_id,x,y) values(p_game,s.id,a.id,a.owner_id,a.name,(p->>'asset_id')::uuid,least(s.width/2,100),least(s.height/2,100));
  when 'token_update' then
    select * into t from public.tokens where id=(p->>'id')::uuid and game_id=p_game;
    if t.id is null or (not gm and (t.controller_id<>uid or not public.can_read_token(t.id))) then raise exception 'Token control denied'; end if;
    if not gm and (p ? 'hidden' or p ? 'controller_id' or p ? 'size') then raise exception 'GM required'; end if;
    select * into s from public.scenes where id=t.scene_id;
    if coalesce((p->>'x')::float8,t.x) not between 0 and s.width or coalesce((p->>'y')::float8,t.y) not between 0 and s.height then raise exception 'Position is outside the scene'; end if;
    if not gm and not public.point_visible(s.fog,coalesce((p->>'x')::float8,t.x),coalesce((p->>'y')::float8,t.y)) then raise exception 'Destination is concealed'; end if;
    update public.tokens set x=coalesce((p->>'x')::float8,x),y=coalesce((p->>'y')::float8,y),size=coalesce((p->>'size')::float8,size),hidden=coalesce((p->>'hidden')::boolean,hidden),controller_id=coalesce((p->>'controller_id')::uuid,controller_id),revision=revision+1 where id=t.id and revision=(p->>'revision')::integer;
    if not found then raise exception 'Token changed. Try again.'; end if;
  else raise exception 'Unknown command';
  end case;
  return '{}'::jsonb;
end; $$;

-- Server-generated outcomes only. Locks keep permission checks and writes atomic.
create function public.record_roll(p_user uuid, p_game uuid, p_id uuid, p_actor uuid, p_expression text, p_visibility text, p_result jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare m public.memberships; previous public.rolls;
begin
  perform 1 from public.games where id=p_game for update;
  select * into m from public.memberships where game_id=p_game and user_id=p_user;
  if m.user_id is null then raise exception 'Game access denied'; end if;
  if p_actor is not null and not exists(select 1 from public.actors where id=p_actor and game_id=p_game and (m.role='gm' or owner_id=p_user or exists(select 1 from public.tokens where actor_id=p_actor and controller_id=p_user))) then raise exception 'Character control required'; end if;
  if exists(select 1 from jsonb_array_elements(p_result->'dice') d where not ((d->>'sides')::integer = any((select dice from public.games where id=p_game)::integer[]))) then raise exception 'Dice settings changed. Roll again.'; end if;
  select * into previous from public.rolls where id=p_id;
  if previous.id is not null then
    if previous.author_id<>p_user or previous.game_id<>p_game then raise exception 'Invalid roll identifier'; end if;
    return;
  end if;
  insert into public.rolls(id,game_id,author_id,author_name,actor_id,expression,visibility,result) values(p_id,p_game,p_user,m.display_name,p_actor,p_expression,p_visibility,p_result);
end; $$;

revoke all on function public.record_roll(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_roll(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.create_game(text,text),public.accept_invite(text,text),public.mutate_game(uuid,text,jsonb) from public,anon;
grant execute on function public.create_game(text,text),public.accept_invite(text,text),public.mutate_game(uuid,text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('tabletop','tabletop',false,6291456,array['image/webp']);
-- No browser storage policies: all uploads and image delivery are authorized by server routes.

-- Only non-secret room changes are published. Tokens/rolls/sheets use authorized snapshot
-- reconciliation, so an UPDATE that hides a row cannot leave a stale visible client row.
alter publication supabase_realtime add table public.games,public.scenes,public.memberships;
