-- Keep attribution after a character is renamed or deleted.
alter table public.rolls
  add column actor_name text,
  add column roll_type text not null default 'Manual roll'
    check (length(btrim(roll_type)) between 1 and 160);
update public.rolls r set actor_name=a.name from public.actors a where a.id=r.actor_id;
-- Older records did not store their purpose; do not guess from the dice expression.
update public.rolls set roll_type='Unspecified roll';
alter table public.rolls drop constraint rolls_actor_id_game_id_fkey;
alter table public.rolls add constraint rolls_actor_id_game_id_fkey
  foreign key (actor_id,game_id) references public.actors(id,game_id)
  on delete set null (actor_id);

create function public.delete_actor(p_game uuid, p_actor uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.actors;
begin
  perform 1 from public.games where id=p_game for update;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  if a.id is null or not public.is_member(p_game) or
    not (public.is_gm(p_game) or a.owner_id=auth.uid()) then
    raise exception 'Character deletion denied';
  end if;
  if p_revision is null or a.revision<>p_revision then
    raise exception 'Sheet changed. Reload before deleting.';
  end if;
  -- Tokens and grants cascade; templates and roll history remain independent.
  delete from public.actors where id=a.id;
  return '{}'::jsonb;
end; $$;
revoke all on function public.delete_actor(uuid,uuid,integer) from public,anon;
grant execute on function public.delete_actor(uuid,uuid,integer) to authenticated;

drop function public.record_roll(uuid,uuid,uuid,uuid,text,text,jsonb);
create function public.record_roll(
  p_user uuid, p_game uuid, p_id uuid, p_actor uuid, p_expression text,
  p_visibility text, p_result jsonb, p_roll_type text default 'Manual roll'
) returns void language plpgsql security definer set search_path = '' as $$
declare m public.memberships; previous public.rolls; character_name text;
begin
  perform 1 from public.games where id=p_game for update;
  select * into m from public.memberships where game_id=p_game and user_id=p_user;
  if m.user_id is null then raise exception 'Game access denied'; end if;
  if p_actor is not null then
    select a.name into character_name from public.actors a
      where a.id=p_actor and a.game_id=p_game and
        (m.role='gm' or a.owner_id=p_user or exists(
          select 1 from public.tokens t where t.actor_id=p_actor and t.controller_id=p_user));
    if character_name is null then raise exception 'Character control required'; end if;
  end if;
  if exists(select 1 from jsonb_array_elements(p_result->'dice') d where not
    ((d->>'sides')::integer = any((select dice from public.games where id=p_game)::integer[]))) then
    raise exception 'Dice settings changed. Roll again.';
  end if;
  select * into previous from public.rolls where id=p_id;
  if previous.id is not null then
    if previous.author_id<>p_user or previous.game_id<>p_game then
      raise exception 'Invalid roll identifier';
    end if;
    return;
  end if;
  insert into public.rolls(
    id,game_id,author_id,author_name,actor_id,actor_name,roll_type,expression,visibility,result
  ) values(
    p_id,p_game,p_user,m.display_name,p_actor,character_name,btrim(p_roll_type),
    p_expression,p_visibility,p_result
  );
end; $$;
revoke all on function public.record_roll(uuid,uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_roll(uuid,uuid,uuid,uuid,text,text,jsonb,text) to service_role;
