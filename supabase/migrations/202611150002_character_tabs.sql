-- Preserve legacy sheets; validate new character collections at the RPC boundary too.
alter function public.valid_sheet(jsonb) rename to valid_sheet_v1;
create function public.valid_sheet(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  details jsonb := doc->'character';
  collection text;
  entry jsonb;
  key text;
  ids text[] := '{}';
  attuned integer := 0;
  n numeric;
begin
  if not public.valid_sheet_v1(doc) then return false; end if;
  if not (doc ? 'character') then return true; end if;
  if jsonb_typeof(details) is distinct from 'object' then return false; end if;
  foreach collection in array array['spells','items','features'] loop
    if jsonb_typeof(details->collection) is distinct from 'array'
      or jsonb_array_length(details->collection)>200 then return false; end if;
    for entry in select value from jsonb_array_elements(details->collection) loop
      if jsonb_typeof(entry) is distinct from 'object'
        or jsonb_typeof(entry->'id') is distinct from 'string'
        or jsonb_typeof(entry->'name') is distinct from 'string'
        or length(entry->>'name') not between 1 and 80
        or jsonb_typeof(entry->'description') is distinct from 'string'
        or length(entry->>'description')>4000 then return false; end if;
      key := (entry->>'id')::uuid::text;
      if key=any(ids) then return false; end if;
      ids:=array_append(ids,key);
      if collection in ('spells','features') then
        if entry->>'actionType' is null or entry->>'actionType' not in
          ('Action','Bonus action','Reaction','Other','Passive') then return false; end if;
      end if;
      if collection='spells' then
        if jsonb_typeof(entry->'level') is distinct from 'number'
          or jsonb_typeof(entry->'prepared') is distinct from 'boolean' then return false; end if;
        n := (entry->>'level')::numeric;
        if n<>trunc(n) or n<0 or n>9 then return false; end if;
      elsif collection='items' then
        if entry->>'rarity' is null or entry->>'rarity' not in
          ('Common','Uncommon','Rare','Very rare','Legendary','Artifact')
          or jsonb_typeof(entry->'quantity') is distinct from 'number'
          or jsonb_typeof(entry->'requiresAttunement') is distinct from 'boolean'
          or jsonb_typeof(entry->'attuned') is distinct from 'boolean' then return false; end if;
        n := (entry->>'quantity')::numeric;
        if n<>trunc(n) or n<0 or n>999 then return false; end if;
        if (entry->>'attuned')::boolean then
          if not (entry->>'requiresAttunement')::boolean then return false; end if;
          attuned := attuned+1;
        end if;
      else
        if entry->>'source' is null or entry->>'source' not in
          ('Class','Species','Background','Feat','Other')
          or jsonb_typeof(entry->'uses') is distinct from 'number'
          or jsonb_typeof(entry->'maxUses') is distinct from 'number' then return false; end if;
        n := (entry->>'uses')::numeric;
        if n<>trunc(n) or n<0 or n>(entry->>'maxUses')::numeric then return false; end if;
        n := (entry->>'maxUses')::numeric;
        if n<>trunc(n) or n<0 or n>999 then return false; end if;
      end if;
    end loop;
  end loop;
  if attuned>3 or jsonb_typeof(details->'biography') is distinct from 'object' then return false; end if;
  foreach key in array array['physical','personality','history'] loop
    if jsonb_typeof(details->'biography'->key) is distinct from 'string'
      or length(details->'biography'->>key)>4000 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;

-- Constraints depend on the original function's OID; rebind to the extended validator.
alter table public.actors drop constraint actors_valid_sheet;
alter table public.templates drop constraint templates_valid_sheet;
alter table public.actors add constraint actors_valid_sheet check (public.valid_sheet(sheet));
alter table public.templates add constraint templates_valid_sheet check (public.valid_sheet(sheet));
