alter table public.tabletop_history drop constraint tabletop_history_kind_check;
alter table public.tabletop_history add constraint tabletop_history_kind_check
  check (kind in ('move','fog','group'));

create or replace function public.tabletop_command(p_game uuid,p_command text,p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid:=auth.uid(); sid uuid:=(p->>'scene_id')::uuid;
  op uuid:=(p->>'operation_id')::uuid;
  h public.tabletop_history; t public.tokens; s public.scenes;
  gm boolean; target uuid; kind text; item jsonb; moves jsonb;
  inverse jsonb; next_revision integer; prior_revision integer; history jsonb;
begin
  perform 1 from public.games where id=p_game for update;
  if uid is null or not public.is_member(p_game) then raise exception 'Game access denied'; end if;
  gm:=public.is_gm(p_game);
  if sid is null or not exists(select 1 from public.games where id=p_game and
    case when coalesce((p->>'preparing')::boolean,false) then gm and active_scene_id is distinct from sid
    else active_scene_id=sid end) then
    raise exception 'Scene changed. Switch back before editing or undoing.';
  end if;
  if p_command not in ('tabletop_move','tabletop_move_group','tabletop_fog','tabletop_undo','tabletop_history')
    or p is null or pg_column_size(p)>200000 then raise exception 'Invalid tabletop operation'; end if;

  delete from public.tabletop_history where game_id=p_game and user_id=uid
    and created_at<now()-interval '24 hours';
  if p_command<>'tabletop_history' then
    if op is null then raise exception 'Operation identifier required'; end if;
    select * into h from public.tabletop_history
      where game_id=p_game and user_id=uid and operation_id=op;
    if p_command='tabletop_undo' then
      if h.sequence is null or h.scene_id<>sid then
        raise exception 'Undo expired or unsupported. Only the last 20 moves/fog edits within 24 hours are retained.';
      end if;
      p:=h.request;
      kind:=h.kind;
    else
      kind:=case p_command when 'tabletop_fog' then 'fog' when 'tabletop_move_group' then 'group' else 'move' end;
      if h.sequence is not null and (h.request is distinct from p or h.kind<>kind) then
        raise exception 'Operation identifier already used';
      end if;
    end if;

    target:=(p->>'id')::uuid;
    if kind='fog' then
      if not gm then raise exception 'GM required'; end if;
      select * into s from public.scenes where id=target and id=sid and game_id=p_game;
      if s.id is null then raise exception 'Scene access denied'; end if;
      if p_command='tabletop_undo' and not h.undone then
        if s.revision<>h.expected_revision then
          raise exception 'Undo blocked: a later change would be overwritten. Adjust manually.';
        end if;
        perform public.mutate_game(p_game,'scene_update',h.inverse||jsonb_build_object('id',target,'revision',s.revision));
        update public.tabletop_history set expected_revision=s.revision+1
          where game_id=p_game and user_id=uid and target_id=target and tabletop_history.kind='fog'
            and not undone and expected_revision=(p->>'revision')::integer;
      elsif h.sequence is null then
        if not (p ?& array['fog','revision']) or jsonb_typeof(p->'fog') is distinct from 'array' or
          (p-'id'-'scene_id'-'operation_id'-'preparing'-'revision'-'fog')<>'{}'::jsonb then
          raise exception 'Invalid fog edit';
        end if;
        inverse:=jsonb_build_object('fog',s.fog);
        next_revision:=s.revision+1;
        perform public.mutate_game(p_game,'scene_update',p-'scene_id'-'operation_id'-'preparing');
      end if;
    else
      if kind='group' then
        moves:=p->'moves';
        if jsonb_typeof(moves) is distinct from 'array' or
          (p-'moves'-'scene_id'-'operation_id'-'preparing')<>'{}'::jsonb then
          raise exception 'Invalid group move';
        end if;
        if jsonb_array_length(moves) not between 2 and 1000 or
          (select count(distinct (entry->>'id')::uuid) from jsonb_array_elements(moves) entry)<>jsonb_array_length(moves) then
          raise exception 'Invalid group move';
        end if;
        inverse:='{}'::jsonb;
        next_revision:=0;
      else
        moves:=jsonb_build_array(p-'scene_id'-'operation_id'-'preparing');
      end if;

      -- All members use the same checks as a single move. Any error rolls back the entire group.
      for item in select value from jsonb_array_elements(moves) loop
        if not (item ?& array['id','x','y','revision']) or
          jsonb_typeof(item->'x') is distinct from 'number' or
          jsonb_typeof(item->'y') is distinct from 'number' or
          jsonb_typeof(item->'revision') is distinct from 'number' or
          (item-'id'-'x'-'y'-'revision')<>'{}'::jsonb then raise exception 'Invalid move'; end if;
        select * into t from public.tokens where id=(item->>'id')::uuid and scene_id=sid and game_id=p_game;
        if t.id is null or (not gm and
          (t.controller_id is distinct from uid or not public.can_read_token(t.id))) then
          raise exception 'Token control denied';
        end if;
        if p_command='tabletop_undo' and not h.undone then
          if t.revision is distinct from (case when kind='group' then (h.inverse->(t.id::text)->>'revision')::integer
            else h.expected_revision end) then
            raise exception 'Undo blocked: a later change would be overwritten. Adjust manually.';
          end if;
          perform public.mutate_game(p_game,'token_update',
            (case when kind='group' then h.inverse->(t.id::text) else h.inverse end)||
            jsonb_build_object('id',t.id,'revision',t.revision));
          -- Rebase only a preceding edit whose post-move revision was this move's starting revision.
          prior_revision:=(item->>'revision')::integer;
          update public.tabletop_history set expected_revision=t.revision+1
            where game_id=p_game and user_id=uid and target_id=t.id and tabletop_history.kind='move'
              and not undone and expected_revision=prior_revision;
          update public.tabletop_history
            set inverse=jsonb_set(tabletop_history.inverse,array[t.id::text,'revision'],to_jsonb(t.revision+1))
            where game_id=p_game and user_id=uid and tabletop_history.kind='group' and not undone
              and (tabletop_history.inverse->(t.id::text)->>'revision')::integer=prior_revision;
        elsif h.sequence is null then
          if kind='group' then
            target:=coalesce(target,t.id);
            inverse:=inverse||jsonb_build_object(t.id,jsonb_build_object('x',t.x,'y',t.y,'revision',t.revision+1));
          else
            inverse:=jsonb_build_object('x',t.x,'y',t.y);
            next_revision:=t.revision+1;
          end if;
          perform public.mutate_game(p_game,'token_update',item);
        end if;
      end loop;
    end if;
    if p_command='tabletop_undo' then
      update public.tabletop_history set undone=true where sequence=h.sequence and not undone;
    elsif h.sequence is null then
      insert into public.tabletop_history(game_id,user_id,operation_id,scene_id,target_id,kind,request,inverse,expected_revision)
        values(p_game,uid,op,sid,target,kind,p,inverse,next_revision);
      delete from public.tabletop_history where sequence in (
        select sequence from public.tabletop_history where game_id=p_game and user_id=uid
        order by sequence desc offset 20);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',hist.operation_id,'description',
    case hist.kind when 'move' then 'Move token' when 'group' then 'Move tokens' else 'Edit fog' end
  ) order by hist.sequence desc),'[]'::jsonb) into history
    from public.tabletop_history hist where hist.game_id=p_game and hist.user_id=uid
      and hist.scene_id=sid and not hist.undone and
      ((hist.kind='fog' and gm) or
       (hist.kind='move' and exists(select 1 from public.tokens tok where tok.id=hist.target_id and
         (gm or (tok.controller_id=uid and public.can_read_token(tok.id))))) or
       (hist.kind='group' and not exists(
         select 1 from jsonb_object_keys(hist.inverse) member(id)
         where not exists(select 1 from public.tokens tok where tok.id=member.id::uuid and
           (gm or (tok.controller_id=uid and public.can_read_token(tok.id)))))));
  return jsonb_build_object('history',history::text);
end; $$;
