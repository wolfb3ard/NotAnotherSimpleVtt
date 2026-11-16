-- Private inverse data is never published or exposed through table access.
create table public.tabletop_history (
  sequence bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  operation_id uuid not null,
  scene_id uuid not null references public.scenes on delete cascade,
  target_id uuid not null,
  kind text not null check (kind in ('move','fog')),
  request jsonb not null,
  inverse jsonb not null,
  expected_revision integer not null,
  undone boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id,user_id,operation_id)
);
create index tabletop_history_user_idx on public.tabletop_history(user_id,game_id,sequence desc);
create index tabletop_history_scene_idx on public.tabletop_history(scene_id);
alter table public.tabletop_history enable row level security;
revoke all on public.tabletop_history from public,anon,authenticated;

-- Same serialized authorization boundary as mutate_game. Reuse its validation and
-- visibility checks for both forward and inverse writes; never trust a client inverse.
create function public.tabletop_command(p_game uuid,p_command text,p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid:=auth.uid(); sid uuid:=(p->>'scene_id')::uuid;
  h public.tabletop_history; t public.tokens; s public.scenes;
  target uuid; inverse jsonb; next_revision integer; history jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if uid is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  if sid is null or not exists(select 1 from public.games where id=p_game and active_scene_id=sid) then
    raise exception 'Scene changed. Switch back before editing or undoing.';
  end if;
  if p_command not in ('tabletop_move','tabletop_fog','tabletop_undo','tabletop_history') or
    p is null or pg_column_size(p)>200000 then raise exception 'Invalid tabletop operation'; end if;

  -- Hard bound: twenty receipts/inverses per user/game, retained for at most 24h.
  delete from public.tabletop_history where game_id=p_game and user_id=uid
    and created_at<now()-interval '24 hours';
  if p_command<>'tabletop_history' then
    if p->>'operation_id' is null then raise exception 'Operation identifier required'; end if;
    select * into h from public.tabletop_history
      where game_id=p_game and user_id=uid and operation_id=(p->>'operation_id')::uuid;
    if p_command='tabletop_undo' then
      if h.sequence is null or h.scene_id<>sid then
        raise exception 'Undo expired or unsupported. Only the last 20 moves/fog edits within 24 hours are retained.';
      end if;
      target:=h.target_id;
    else
      target:=(p->>'id')::uuid;
    end if;
    if p_command='tabletop_fog' or (p_command='tabletop_undo' and h.kind='fog') then
      if not public.is_gm(p_game) then raise exception 'GM required'; end if;
      select * into s from public.scenes where id=target and id=sid and game_id=p_game;
      if s.id is null then raise exception 'Scene access denied'; end if;
    else
      select * into t from public.tokens where id=target and scene_id=sid and game_id=p_game;
      if t.id is null or (not public.is_gm(p_game) and
        (t.controller_id<>uid or not public.can_read_token(t.id))) then
        raise exception 'Token control denied';
      end if;
    end if;
    if p_command='tabletop_undo' then
      if not h.undone then
        next_revision:=coalesce(t.revision,s.revision);
        if next_revision<>h.expected_revision then
          raise exception 'Undo blocked: a later change would be overwritten. Adjust manually.';
        end if;
        perform public.mutate_game(p_game,case when h.kind='move' then 'token_update' else 'scene_update' end,
          h.inverse||jsonb_build_object('id',target,'revision',next_revision));
        update public.tabletop_history set undone=true where sequence=h.sequence;
        -- Rebase only the immediately preceding state of this user's same target.
        -- An intervening write by anyone else breaks the revision chain.
        update public.tabletop_history set expected_revision=next_revision+1
          where game_id=p_game and user_id=uid and target_id=target and kind=h.kind
            and not undone and expected_revision=(h.request->>'revision')::integer;
      end if;
    elsif h.sequence is not null then
      if h.request is distinct from p then raise exception 'Operation identifier already used'; end if;
      -- Acknowledgement retry only: never reapply an already committed/undone edit.
    else
      if p_command='tabletop_move' then
        if not (p ?& array['x','y','revision']) or
          jsonb_typeof(p->'x') is distinct from 'number' or
          jsonb_typeof(p->'y') is distinct from 'number' or
          (p-'id'-'scene_id'-'operation_id'-'revision'-'x'-'y')<>'{}'::jsonb then
          raise exception 'Invalid move';
        end if;
        inverse:=jsonb_build_object('x',t.x,'y',t.y);
        next_revision:=t.revision+1;
        perform public.mutate_game(p_game,'token_update',p-'scene_id'-'operation_id');
      else
        if not (p ?& array['fog','revision']) or
          jsonb_typeof(p->'fog') is distinct from 'array' or
          (p-'id'-'scene_id'-'operation_id'-'revision'-'fog')<>'{}'::jsonb then
          raise exception 'Invalid fog edit';
        end if;
        inverse:=jsonb_build_object('fog',s.fog);
        next_revision:=s.revision+1;
        perform public.mutate_game(p_game,'scene_update',p-'scene_id'-'operation_id');
      end if;
      insert into public.tabletop_history(game_id,user_id,operation_id,scene_id,target_id,kind,request,inverse,expected_revision)
        values(p_game,uid,(p->>'operation_id')::uuid,sid,target,
          case when p_command='tabletop_move' then 'move' else 'fog' end,p,inverse,next_revision);
      delete from public.tabletop_history where sequence in (
        select sequence from public.tabletop_history where game_id=p_game and user_id=uid
        order by sequence desc offset 20);
    end if;
  end if;
  -- Metadata only, currently authorized, active scene only. No inverse, positions,
  -- labels, or fog geometry can escape via history (including after revocation).
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',hist.operation_id,'description',case when hist.kind='move' then 'Move token' else 'Edit fog' end
  ) order by hist.sequence desc),'[]'::jsonb) into history
    from public.tabletop_history hist where hist.game_id=p_game and hist.user_id=uid
      and hist.scene_id=sid and not hist.undone and
      ((hist.kind='fog' and public.is_gm(p_game)) or
       (hist.kind='move' and exists(select 1 from public.tokens tok where tok.id=hist.target_id and
         (public.is_gm(p_game) or (tok.controller_id=uid and public.can_read_token(tok.id))))));
  return jsonb_build_object('history',history::text);
end; $$;
revoke all on function public.tabletop_command(uuid,text,jsonb) from public,anon;
grant execute on function public.tabletop_command(uuid,text,jsonb) to authenticated;
