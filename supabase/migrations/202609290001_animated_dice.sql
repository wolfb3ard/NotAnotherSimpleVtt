-- Announcements contain no roller identity, expression, die type, or outcome.
-- Private GM rolls intentionally produce no announcement.
create table public.roll_cues (
  roll_id uuid primary key references public.rolls(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  private boolean not null,
  created_at timestamptz not null default now()
);
create index roll_cues_game_time on public.roll_cues(game_id,created_at desc);
alter table public.roll_cues enable row level security;
create policy roll_cues_read on public.roll_cues for select to authenticated using (public.is_member(game_id));
revoke all on public.roll_cues from public,anon,authenticated;
grant select on public.roll_cues to authenticated;

create function public.announce_roll() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'public' or (new.visibility = 'private' and not exists (
    select 1 from public.games where id = new.game_id and gm_id = new.author_id
  )) then
    insert into public.roll_cues(roll_id,game_id,private,created_at)
    values(new.id,new.game_id,new.visibility='private',new.created_at);
  end if;
  return null;
end; $$;
create trigger rolls_announce after insert on public.rolls for each row execute function public.announce_roll();

create table public.dice_styles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  style jsonb not null,
  updated_at timestamptz not null default now()
);
create function public.valid_dice_style(s jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare key text;
begin
  if s is null or jsonb_typeof(s) <> 'object' or (select count(*) from jsonb_object_keys(s)) <> 6 then return false; end if;
  foreach key in array array['faceColor','numberColor','outlineColor'] loop
    if jsonb_typeof(s->key) is distinct from 'string' or (s->>key) !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
  end loop;
  foreach key in array array['opacity','glossiness','shimmer'] loop
    if jsonb_typeof(s->key) is distinct from 'number' or (s->>key)::numeric not between 0 and 1 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;
alter table public.dice_styles add constraint valid_style check (public.valid_dice_style(style));
create function public.shares_game(other_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships mine join public.memberships theirs on mine.game_id=theirs.game_id
    where mine.user_id=auth.uid() and theirs.user_id=other_user);
$$;
alter table public.dice_styles enable row level security;
create policy dice_styles_read on public.dice_styles for select to authenticated
  using (user_id=auth.uid() or public.shares_game(user_id));
revoke all on public.dice_styles from public,anon,authenticated;
grant select on public.dice_styles to authenticated;

create function public.save_dice_style(p_style jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if not public.valid_dice_style(p_style) then raise exception 'Invalid dice style'; end if;
  insert into public.dice_styles(user_id,style) values(auth.uid(),p_style)
    on conflict(user_id) do update set style=excluded.style,updated_at=now();
end; $$;
revoke all on function public.save_dice_style(jsonb) from public,anon;
grant execute on function public.save_dice_style(jsonb) to authenticated;
