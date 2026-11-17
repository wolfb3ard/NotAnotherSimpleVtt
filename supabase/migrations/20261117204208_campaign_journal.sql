-- Journal content never enters room events, snapshots or the realtime publication.
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  kind text not null check (kind in ('note','handout','recap','clue','objective')),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 8000),
  search_text text generated always as (title || ' ' || kind || ' ' || body) stored,
  scene_id uuid,
  encounter_id uuid,
  party boolean not null default false,
  recipient_id uuid,
  image bytea check (image is null or (kind='handout' and octet_length(image) between 1 and 524288)),
  has_image boolean generated always as (image is not null) stored,
  created_at timestamptz not null default now(),
  check (not party or recipient_id is null),
  check (kind <> 'note' or (not party and recipient_id is null)),
  check (encounter_id is null or scene_id is not null),
  foreign key (game_id,recipient_id) references public.memberships(game_id,user_id) on delete set null (recipient_id),
  foreign key (scene_id,game_id) references public.scenes(id,game_id) on delete set null (scene_id),
  foreign key (encounter_id,scene_id,game_id) references public.encounters(id,scene_id,game_id) on delete set null (encounter_id)
);
-- A scene deletion unlinks its journal history rather than deleting the prose.
create function vtt_private.unlink_journal_encounter() returns trigger
language plpgsql set search_path='' as $$
begin
  new.encounter_id := null;
  return new;
end;
$$;
create trigger journal_scene_unlinked before update of scene_id on public.journal_entries
  for each row when (new.scene_id is null) execute function vtt_private.unlink_journal_encounter();
create index journal_game_date on public.journal_entries(game_id,created_at desc);
alter table public.journal_entries enable row level security;
revoke all on public.journal_entries from public,anon,authenticated;
grant select, insert(game_id,kind,title,body,scene_id,encounter_id,image),
  update(title,body,party,recipient_id) on public.journal_entries to authenticated;
create policy journal_read on public.journal_entries for select to authenticated using (
  public.is_gm(game_id) or (public.is_member(game_id) and (party or recipient_id=(select auth.uid())))
);
create policy journal_create on public.journal_entries for insert to authenticated
  with check (public.is_gm(game_id) and not party and recipient_id is null);
create policy journal_change on public.journal_entries for update to authenticated
  using (public.is_gm(game_id)) with check (public.is_gm(game_id));

-- Only the GM can enumerate encounter labels for the context picker.
grant select(id,game_id,scene_id,status,created_at) on public.encounters to authenticated;
create policy gm_encounter_labels on public.encounters for select to authenticated using(public.is_gm(game_id));
