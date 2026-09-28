-- RPCs are callable independently of the Next.js forms. Validate structured documents
-- at the database boundary as well, so malformed sheets cannot break another client.
create function public.valid_sheet(doc jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare s jsonb; f jsonb; a jsonb; ids text[] := '{}'; key text; n numeric;
begin
  if doc is null or doc->'version' is distinct from '1'::jsonb or jsonb_typeof(doc->'sections') is distinct from 'array' or jsonb_array_length(doc->'sections')>20 or pg_column_size(doc)>180000 then return false; end if;
  for s in select value from jsonb_array_elements(doc->'sections') loop
    if s->>'id' is null or length(s->>'title') not between 1 and 80 or jsonb_typeof(s->'title') is distinct from 'string' or
      jsonb_typeof(s->'fields') is distinct from 'array' or jsonb_typeof(s->'abilities') is distinct from 'array' or
      jsonb_array_length(s->'fields')>40 or jsonb_array_length(s->'abilities')>30 then return false; end if;
    key := (s->>'id')::uuid::text;
    if key=any(ids) then return false; end if; ids:=array_append(ids,key);
    for f in select value from jsonb_array_elements(s->'fields') loop
      if f->>'id' is null or jsonb_typeof(f->'label') is distinct from 'string' or length(f->>'label') not between 1 and 80 or f->>'kind' is null or f->>'kind' not in ('text','number','resource') then return false; end if;
      key := (f->>'id')::uuid::text;
      if key=any(ids) then return false; end if; ids:=array_append(ids,key);
      if f->>'kind'='text' then
        if jsonb_typeof(f->'value') is distinct from 'string' or length(f->>'value')>4000 then return false; end if;
      else
        if jsonb_typeof(f->'value') is distinct from 'number' then return false; end if;
        n := (f->>'value')::numeric;
        if abs(n)>1e12 then return false; end if;
        if f->>'kind'='resource' and (jsonb_typeof(f->'max') is distinct from 'number' or n<0 or (f->>'max')::numeric<n or (f->>'max')::numeric>1e12) then return false; end if;
      end if;
    end loop;
    for a in select value from jsonb_array_elements(s->'abilities') loop
      if a->>'id' is null or jsonb_typeof(a->'name') is distinct from 'string' or length(a->>'name') not between 1 and 80 or jsonb_typeof(a->'description') is distinct from 'string' or length(a->>'description')>4000 or jsonb_typeof(a->'expression') is distinct from 'string' or length(a->>'expression')>500 then return false; end if;
      key := (a->>'id')::uuid::text;
      if key=any(ids) then return false; end if; ids:=array_append(ids,key);
    end loop;
  end loop;
  return true;
exception when others then return false;
end; $$;
alter table public.actors add constraint actors_valid_sheet check (public.valid_sheet(sheet));
alter table public.templates add constraint templates_valid_sheet check (public.valid_sheet(sheet));
