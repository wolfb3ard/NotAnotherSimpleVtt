create table public.room_events (
  game_id uuid primary key references public.games on delete cascade,
  revision bigint not null default 0
);
alter table public.room_events enable row level security;
create policy room_events_read on public.room_events for select to authenticated using (public.is_member(game_id));
revoke all on public.room_events from anon, authenticated;
grant select on public.room_events to authenticated;

create function public.notify_room() returns trigger language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  if tg_table_name='games' then g:=coalesce(new.id,old.id);
  elsif tg_table_name='sheet_grants' then select game_id into g from public.actors where id=coalesce(new.actor_id,old.actor_id);
  else g:=coalesce(new.game_id,old.game_id);
  end if;
  if exists(select 1 from public.games where id=g) then
    insert into public.room_events(game_id,revision) values(g,1) on conflict(game_id) do update set revision=public.room_events.revision+1;
  end if;
  return null;
end; $$;
create trigger games_notify after insert or update on public.games for each row execute function public.notify_room();
create trigger members_notify after insert or update or delete on public.memberships for each row execute function public.notify_room();
create trigger actors_notify after insert or update or delete on public.actors for each row execute function public.notify_room();
create trigger grants_notify after insert or update or delete on public.sheet_grants for each row execute function public.notify_room();
create trigger templates_notify after insert or update or delete on public.templates for each row execute function public.notify_room();
create trigger scenes_notify after insert or update or delete on public.scenes for each row execute function public.notify_room();
create trigger tokens_notify after insert or update or delete on public.tokens for each row execute function public.notify_room();
create trigger rolls_notify after insert or update or delete on public.rolls for each row execute function public.notify_room();
alter publication supabase_realtime drop table public.games,public.scenes,public.memberships;
alter publication supabase_realtime add table public.room_events;
