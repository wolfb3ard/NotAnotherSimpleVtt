-- Ownership is GM-only, game-scoped, serialized with other room mutations.
create function public.transfer_actor_owner(p_game uuid, p_actor uuid, p_owner uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.actors;
begin
  perform 1 from public.games where id=p_game for update;
  if not public.is_gm(p_game) then raise exception 'GM required'; end if;
  select * into a from public.actors where id=p_actor and game_id=p_game;
  if a.id is null or not exists(select 1 from public.memberships where game_id=p_game and user_id=p_owner) then
    raise exception 'Invalid sheet or member';
  end if;
  if p_revision is null or a.revision<>p_revision then raise exception 'Sheet changed. Reload before changing ownership.'; end if;
  if a.owner_id=p_owner then return '{}'::jsonb; end if;
  -- Ownership does not leave implicit access or token control with the former owner.
  delete from public.sheet_grants where actor_id=a.id and user_id in (a.owner_id,p_owner);
  update public.tokens set controller_id=p_owner,revision=revision+1
    where actor_id=a.id and controller_id=a.owner_id;
  update public.actors set owner_id=p_owner,revision=revision+1 where id=a.id;
  return '{}'::jsonb;
end; $$;
revoke all on function public.transfer_actor_owner(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.transfer_actor_owner(uuid,uuid,uuid,integer) to authenticated;
