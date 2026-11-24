-- Keep guided generation strict while accepting manually entered base scores.
create or replace function public.valid_srd_builder(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
#variable_conflict use_column
declare
 refs jsonb:=public.srd_builder_reference(); bg jsonb; scores jsonb:='[]'; counts jsonb:='{}'; known jsonb; permanent jsonb; expert jsonb:='[]';
 step jsonb; class_doc jsonb; spec jsonb; choice jsonb; e jsonb; v jsonb; item jsonb; before_step jsonb:='{}';
 previous jsonb; selected jsonb; allowed jsonb; automatic jsonb; boosts jsonb; score integer; cost integer:=0; amount integer:=0;
 n integer; i integer; total integer:=0; lvl integer; needed integer; extra integer; index integer; cantrip boolean;
 name text; key text; id text; feat_ids text[]:='{}'; feat_key text; first_class text; feature_keys text[];
begin
 if jsonb_typeof(doc) is distinct from 'object' or doc->'version' is distinct from '1'::jsonb or doc->>'source' is distinct from 'SRD-5.2.1' then return false; end if;
 for key in select jsonb_object_keys(doc) loop
  if key not in ('version','source','alignment','abilityMethod','baseScores','rolls','background','backgroundBoosts','backgroundEquipment','classEquipment','equipment','companions','species','lineage','size','speciesSpellAbility','speciesCantrip','speciesSkill','replacementSkills','originFeat','humanFeat','languages','tools','levels') then return false; end if;
 end loop;
 bg:=refs->'backgrounds'->(doc->>'background');
 if not (refs->'alignments' @> jsonb_build_array(doc->>'alignment')) then return false; end if;
 if bg is null or not (refs->'species' @> jsonb_build_array(doc->>'species')) then return false; end if;
 if doc->>'backgroundEquipment' is null or doc->>'backgroundEquipment' not in ('A','B') or
    doc->>'classEquipment' is null or doc->>'classEquipment' not in ('A','B','C') or
    jsonb_typeof(doc->'speciesSpellAbility') is distinct from 'number' or doc->>'speciesSpellAbility' not in ('3','4','5') then return false; end if;
 if jsonb_typeof(doc->'baseScores') is distinct from 'array' or jsonb_array_length(doc->'baseScores')<>6 or
    jsonb_typeof(doc->'backgroundBoosts') is distinct from 'array' or jsonb_array_length(doc->'backgroundBoosts')<>6 then return false; end if;
 for i in 0..5 loop
  if jsonb_typeof(doc->'baseScores'->i) is distinct from 'number' or jsonb_typeof(doc->'backgroundBoosts'->i) is distinct from 'number' then return false; end if;
  score:=(doc->'baseScores'->>i)::integer; n:=(doc->'backgroundBoosts'->>i)::integer;
   if (doc->'baseScores'->>i)::numeric<>score or (doc->'backgroundBoosts'->>i)::numeric<>n or n not between 0 and 2 then return false; end if;
   if doc->>'abilityMethod'='manual' then
    if score not between 1 and 30 or score+n>30 then return false; end if;
   elsif score not between 3 and 18 or score+n>20 then return false;
   end if;
  if n>0 and not (bg->'abilities' @> jsonb_build_array(i)) then return false; end if;
  amount:=amount+n;
  scores:=scores||jsonb_build_array(score+n);
  if doc->>'abilityMethod'='point-buy' then
   if score not between 8 and 15 then return false; end if;
   cost:=cost+case score when 8 then 0 when 9 then 1 when 10 then 2 when 11 then 3 when 12 then 4 when 13 then 5 when 14 then 7 when 15 then 9 end;
  end if;
 end loop;
 if amount<>3 then return false; end if;
 if doc->>'abilityMethod'='standard' then
  if (select jsonb_agg(v order by v) from jsonb_array_elements(doc->'baseScores') t(v))<>'[8,10,12,13,14,15]'::jsonb then return false; end if;
 elsif doc->>'abilityMethod'='point-buy' then if cost<>27 then return false; end if;
 elsif doc->>'abilityMethod'='rolled' then
  if jsonb_typeof(doc->'rolls') is distinct from 'array' or jsonb_array_length(doc->'rolls')<>6 then return false; end if;
  selected:='[]';
  for item in select value from jsonb_array_elements(doc->'rolls') loop
   if jsonb_typeof(item) is distinct from 'array' or jsonb_array_length(item)<>4 then return false; end if;
   for v in select value from jsonb_array_elements(item) loop
    if jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric<>trunc((v#>>'{}')::numeric) or (v#>>'{}')::integer not between 1 and 6 then return false; end if;
   end loop;
   select sum((v#>>'{}')::integer)-min((v#>>'{}')::integer) into n from jsonb_array_elements(item) t(v);
   selected:=selected||jsonb_build_array(n);
  end loop;
  if (select jsonb_agg(v order by v) from jsonb_array_elements(selected) t(v)) is distinct from (select jsonb_agg(v order by v) from jsonb_array_elements(doc->'baseScores') t(v)) then return false; end if;
  elsif doc->>'abilityMethod' is distinct from 'manual' then return false; end if;
 if doc->>'abilityMethod'<>'rolled' and doc ? 'rolls' then return false; end if;
 if refs->'lineages' ? (doc->>'species') then
  if not (refs->'lineages'->(doc->>'species') @> jsonb_build_array(doc->>'lineage')) then return false; end if;
 elsif doc->>'lineage' is distinct from '' then return false; end if;
 if doc->>'lineage'='High Elf' then
  e:=refs->'catalog'->(doc->>'speciesCantrip');
  if e->>'category' is distinct from 'spell' or e->>'level' is distinct from '0' or not (e->'classes' @> '["Wizard"]'::jsonb) then return false; end if;
 elsif doc->>'speciesCantrip' is distinct from '' then return false; end if;
 if doc->>'size' is null or doc->>'size' not in ('Small','Medium') or
  (doc->>'species' in ('Gnome','Halfling') and doc->>'size'<>'Small') or
  (doc->>'species' not in ('Gnome','Halfling','Human','Tiefling') and doc->>'size'<>'Medium') then return false; end if;
 known:=bg->'skills';
 needed:=case when known @> jsonb_build_array(doc->>'speciesSkill') then 1 else 0 end;
 if doc->>'species' in ('Human','Elf') then
  allowed:=case when doc->>'species'='Human' then refs->'skills' else '["Insight","Perception","Survival"]'::jsonb end;
  if not (allowed @> jsonb_build_array(doc->>'speciesSkill')) then return false; end if;
  known:=known||jsonb_build_array(doc->>'speciesSkill');
 elsif doc->>'speciesSkill' is distinct from '' then return false; end if;
 if not public.srd_string_choices(doc->'replacementSkills',refs->'skills',needed) then return false; end if;
 for item in select value from jsonb_array_elements(doc->'replacementSkills') loop
  if known @> jsonb_build_array(item) then return false; end if;
 end loop;
 known:=known||(doc->'replacementSkills');
 if not public.srd_string_choices(doc->'languages', refs->'languages',2) then return false; end if;
 if not public.srd_string_choices(doc->'tools',refs->'gamingSets',case when doc->>'background'='Soldier' then 1 else 0 end) then return false; end if;
 if not public.valid_srd_feat(doc->'originFeat',0,scores,'Origin',bg->>'feat',bg->>'magicList') then return false; end if;
 if doc->>'species'='Human' then
  if not public.valid_srd_feat(doc->'humanFeat',0,scores,'Origin') then return false; end if;
 elsif doc ? 'humanFeat' then return false; end if;
 for item in select value from jsonb_array_elements(jsonb_build_array(doc->'originFeat',doc->'humanFeat')) where value<>'null'::jsonb loop
  known:=known||(item->'skills'); feat_key:=item->>'id'||coalesce(':'||(item->>'spellList'),'');
  e:=refs->'catalog'->(item->>'id');
  if feat_key=any(feat_ids) and e->>'name' not in ('Skilled','Ability Score Improvement') then return false; end if;
  feat_ids:=array_append(feat_ids,feat_key);
 end loop;
 permanent:=known;
 if jsonb_typeof(doc->'levels') is distinct from 'array' or jsonb_array_length(doc->'levels') not between 1 and 20 then return false; end if;
 if not public.valid_srd_equipment(doc) then return false; end if;
 for step in select value from jsonb_array_elements(doc->'levels') loop
  total:=total+1; name:=step->>'className'; class_doc:=refs->'classes'->name;
  if class_doc is null or jsonb_typeof(step) is distinct from 'object' then return false; end if;
  if total=1 and doc->>'classEquipment'='C' and name<>'Fighter' then return false; end if;
  for key in select jsonb_object_keys(step) loop
   if key not in ('className','hp','skills','replacementSkills','expertise','cantrips','spells','spellbook','options','mastery','invocationFeats','feat','choices') then return false; end if;
  end loop;
  lvl:=coalesce((counts->>name)::integer,0)+1; counts:=jsonb_set(counts,array[name],to_jsonb(lvl));
  spec:=class_doc->'levels'->(lvl-1); previous:=before_step->name;
  automatic:=public.srd_automatic_prepared(doc,name,total);
  known:=permanent;
  for item in select value from jsonb_each(before_step) t(key,value) where key<>name loop
   for choice in select value from jsonb_array_elements(item->'invocationFeats') loop known:=known||(choice->'skills'); end loop;
  end loop;
  for choice in select value from jsonb_array_elements(step->'invocationFeats') loop known:=known||(choice->'skills'); end loop;
  select jsonb_agg(distinct v) into known from jsonb_array_elements(known) t(v) where refs->'skills' @> jsonb_build_array(v);
  if jsonb_typeof(step->'hp') is distinct from 'number' or (step->>'hp')::numeric<>trunc((step->>'hp')::numeric) or
     (step->>'hp')::integer not between 1 and (class_doc->>'die')::integer or (total=1 and step->>'hp' is distinct from class_doc->>'die') then return false; end if;
  if lvl=1 and total>1 then
   for key in select jsonb_object_keys(counts) loop
    selected:=refs->'classes'->key->'primary'; n:=0;
    for v in select value from jsonb_array_elements(selected) loop
     if (scores->>(v#>>'{}')::integer)::integer>=13 then n:=n+1; end if;
    end loop;
    if (key='Fighter' and n=0) or (key<>'Fighter' and n<>jsonb_array_length(selected)) then return false; end if;
   end loop;
  end if;
  needed:=(spec->>case when total=1 then 'skillsFirst' else 'skillsMulti' end)::integer;
  allowed:=case when name='Bard' and lvl=3 then refs->'skills' else class_doc->'skills' end;
  if not public.srd_string_choices(step->'skills',allowed,needed) then return false; end if;
  select count(*) into needed from jsonb_array_elements(step->'skills') t(v) where known @> jsonb_build_array(v);
  known:=known||(step->'skills');
  if not public.srd_string_choices(step->'replacementSkills',refs->'skills',needed) then return false; end if;
  for item in select value from jsonb_array_elements(step->'replacementSkills') loop
   if known @> jsonb_build_array(item) then return false; end if;
  end loop;
  known:=known||(step->'replacementSkills');
  if not public.srd_string_choices(step->'expertise',known,(spec->>'expertise')::integer) then return false; end if;
  for v in select value from jsonb_array_elements(step->'expertise') loop
   if expert @> jsonb_build_array(v) then return false; end if;
   if name='Wizard' and not ('["Arcana","History","Investigation","Medicine","Nature","Religion"]'::jsonb @> jsonb_build_array(v)) then return false; end if;
  end loop;
  expert:=expert||(step->'expertise');
  if jsonb_typeof(step->'choices') is distinct from 'object' then return false; end if;
  extra:=0;
  for item in select value from jsonb_array_elements(doc->'levels') with ordinality t(value,ord) where ord<=total loop
   if item->>'className'=name and ((item->'choices'->'divine-order') @> '["Thaumaturge"]'::jsonb or (item->'choices'->'primal-order') @> '["Magician"]'::jsonb) then extra:=1; end if;
  end loop;
  foreach key in array array['cantrips','spells','spellbook'] loop
   needed:=case key when 'cantrips' then (spec->>'cantrips')::integer+extra when 'spells' then (spec->>'prepared')::integer else null end;
   if jsonb_typeof(step->key) is distinct from 'array' or jsonb_array_length(step->key)>100 or
      (needed is not null and jsonb_array_length(step->key)<>needed) or
      (select count(distinct value) from jsonb_array_elements(step->key))<>jsonb_array_length(step->key) then return false; end if;
   if key='spellbook' and ((name='Wizard' and jsonb_array_length(step->key)<(spec->>'spellbook')::integer) or (name<>'Wizard' and jsonb_array_length(step->key)<>0)) then return false; end if;
   for v in select value from jsonb_array_elements(step->key) loop
    if key<>'spellbook' and automatic @> jsonb_build_array(v) then return false; end if;
    e:=refs->'catalog'->(v#>>'{}');
    if e->>'category' is distinct from 'spell' then return false; end if;
    if key='cantrips' then
     if e->>'level' is distinct from '0' or not (e->'classes' @> jsonb_build_array(name)) then return false; end if;
    else
     if (e->>'level')::integer not between 1 and (spec->>'maxLevel')::integer or not (
       e->'classes' @> jsonb_build_array(name) or (name='Bard' and lvl>=10 and e->'classes' ?| array['Cleric','Druid','Wizard'])) then return false; end if;
     if name='Wizard' and key='spells' and not (step->'spellbook' @> jsonb_build_array(v)) then return false; end if;
    end if;
   end loop;
  end loop;
  if previous is not null then
   select coalesce(sum(greatest(c.n-coalesce(p.n,0),0)),0)::integer into n
     from (select value as id,count(*) as n from jsonb_array_elements(step->'options') group by value) c
     left join (select value as id,count(*) as n from jsonb_array_elements(previous->'options') group by value) p on c.id=p.id;
   if n>jsonb_array_length(step->'options')-jsonb_array_length(previous->'options')+1 then return false; end if;
   if name='Wizard' and not (step->'spellbook' @> (previous->'spellbook')) then return false; end if;
   if name in ('Bard','Sorcerer','Warlock') then
    foreach key in array array['spells'] loop
     select count(*) into n from jsonb_array_elements(step->key) t(v) where not (previous->key @> jsonb_build_array(v));
     select count(*) into needed from jsonb_array_elements(previous->key) t(v) where not (automatic @> jsonb_build_array(v));
     if n>jsonb_array_length(step->key)-needed+1 then return false; end if;
    end loop;
   end if;
   if name<>'Wizard' then
    select count(*) into n from jsonb_array_elements(step->'cantrips') t(v) where not (previous->'cantrips' @> jsonb_build_array(v));
    if n>jsonb_array_length(step->'cantrips')-jsonb_array_length(previous->'cantrips')+1 then return false; end if;
   end if;
  end if;
  if not public.srd_string_choices(step->'mastery',refs->'weapons',(spec->>'mastery')::integer) then return false; end if;
  if name='Barbarian' and not public.srd_string_choices(step->'mastery',refs->'meleeWeapons',(spec->>'mastery')::integer) then return false; end if;
  if name='Rogue' and not (counts ?| array['Barbarian','Fighter','Paladin','Ranger']) and not public.srd_string_choices(step->'mastery',refs->'rogueWeapons',(spec->>'mastery')::integer) then return false; end if;
  if jsonb_typeof(step->'options') is distinct from 'array' or jsonb_array_length(step->'options')<>(spec->>'options')::integer then return false; end if;
  for v in select value from jsonb_array_elements(step->'options') loop
   e:=refs->'catalog'->(v#>>'{}');
   if e->>'category' is distinct from 'option' or e->>'className' is distinct from name or (e->>'minimum')::integer>lvl then return false; end if;
   if not (e->>'repeatable')::boolean and (select count(*) from jsonb_array_elements(step->'options') t(x) where x=v)>1 then return false; end if;
   if e->>'requiresInvocation' is not null and not exists (select 1 from jsonb_array_elements(step->'options') t(x) where refs->'catalog'->(x#>>'{}')->>'name'=e->>'requiresInvocation') then return false; end if;
   if (e->>'cantripInvocation')::boolean then
    select count(*) into needed from jsonb_array_elements(step->'options') t(x) where x=v;
    select coalesce(jsonb_agg(value),'[]'::jsonb) into allowed from jsonb_array_elements(automatic) where refs->'catalog'->(value#>>'{}')->>'level'='0';
    allowed:=(step->'cantrips')||allowed;
    if not public.srd_string_choices(step->'choices'->(v#>>'{}'),allowed,needed) then return false; end if;
    for item in select value from jsonb_array_elements(step->'choices'->(v#>>'{}')) loop
     if not (refs->'catalog'->(item#>>'{}')->>'damage')::boolean then return false; end if;
     if e->>'name'='Eldritch Spear' and (refs->'catalog'->(item#>>'{}')->>'range')::integer<10 then return false; end if;
     if e->>'name'='Repelling Blast' and not (refs->'catalog'->(item#>>'{}')->>'attackRoll')::boolean then return false; end if;
    end loop;
   end if;
   if e->>'name'='Pact of the Tome' then
    selected:=step->'choices'->(v#>>'{}');
    if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)<>5 or (select count(distinct value) from jsonb_array_elements(selected))<>5 then return false; end if;
    n:=0; needed:=0;
    for item in select value from jsonb_array_elements(selected) loop
     if step->'cantrips' @> jsonb_build_array(item) or step->'spells' @> jsonb_build_array(item) or spec->'alwaysPrepared' @> jsonb_build_array(item) or doc->'originFeat'->'spells' @> jsonb_build_array(item) or doc->'humanFeat'->'spells' @> jsonb_build_array(item) then return false; end if;
     for choice in select value from jsonb_each(before_step) t(key,value) where key<>name loop
      if choice->'cantrips' @> jsonb_build_array(item) or choice->'spells' @> jsonb_build_array(item) then return false; end if;
     end loop;
     e:=refs->'catalog'->(item#>>'{}');
     if e->>'category' is distinct from 'spell' then return false; end if;
     if e->>'level'='0' then n:=n+1; elsif e->>'level'='1' and (e->>'ritual')::boolean then needed:=needed+1; else return false; end if;
    end loop;
    if n<>3 or needed<>2 then return false; end if;
   end if;
  end loop;
  select count(*) into needed from jsonb_array_elements(step->'options') t(x) where refs->'catalog'->(x#>>'{}')->>'name'='Lessons of the First Ones';
  if jsonb_typeof(step->'invocationFeats') is distinct from 'array' or jsonb_array_length(step->'invocationFeats')<>needed then return false; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(step->'invocationFeats'))<>needed then return false; end if;
  for item in select value from jsonb_array_elements(step->'invocationFeats') loop
   if not public.valid_srd_feat(item,total,scores,'Origin') then return false; end if;
   known:=known||(item->'skills');
  end loop;
  if (spec->>'feat')::boolean then
   if not public.valid_srd_feat(step->'feat',total,scores) then return false; end if;
   item:=step->'feat'; feat_key:=item->>'id'||coalesce(':'||(item->>'spellList'),'');
   e:=refs->'catalog'->(item->>'id');
   if feat_key=any(feat_ids) and e->>'name' not in ('Skilled','Ability Score Improvement') then return false; end if;
   feat_ids:=array_append(feat_ids,feat_key); known:=known||(item->'skills');
   if e->>'featCategory'='Fighting Style' and not exists (select 1 from jsonb_array_elements(doc->'levels') with ordinality t(v,ord) where ord<=total and v->'choices' ? 'fighting-style') then return false; end if;
   if e->>'name'='Boon of Spell Recall' and not (counts ?| array['Bard','Cleric','Druid','Paladin','Ranger','Sorcerer','Wizard']) then return false; end if;
   for i in 0..5 loop scores:=jsonb_set(scores,array[i::text],to_jsonb((scores->>i)::integer+(item->'increases'->>i)::integer)); end loop;
  elsif step ? 'feat' then return false; end if;
  selected:=spec->case when total=1 then 'choicesFirst' else 'choicesMulti' end; feature_keys:='{}';
  for choice in select value from jsonb_array_elements(selected) loop
   key:=choice->>'key'; feature_keys:=array_append(feature_keys,key);
   if key in ('wild-shape-forms','land') and name='Druid' and coalesce(step->'choices'->key,'[]'::jsonb)='[]'::jsonb and exists(select 1 from jsonb_array_elements(doc->'levels') with ordinality t(v,ord) where ord>total and v->>'className'='Druid') then continue; end if;
   if not public.srd_string_choices(step->'choices'->key,choice->'options',(choice->>'count')::integer) then return false; end if;
   if key in ('spell-mastery','signature-spells') and not (step->'spellbook' @> (step->'choices'->key)) then return false; end if;
   if key='spell-mastery' and refs->'catalog'->(step->'choices'->key->>0)->>'level'=refs->'catalog'->(step->'choices'->key->>1)->>'level' then return false; end if;
   if key='evocation-savant' then
    if not (step->'spellbook' @> (step->'choices'->key)) then return false; end if;
    for item in select value from jsonb_array_elements(step->'choices'->key) loop
     if previous->'spellbook' @> jsonb_build_array(item) then return false; end if;
    end loop;
   end if;
   if key='magical-discoveries' and previous->'choices' ? key then
    select count(*) into n from jsonb_array_elements(step->'choices'->key) t(v) where not (previous->'choices'->key @> jsonb_build_array(v));
    if n>1 then return false; end if;
   end if;
   if key='fighting-style' then
    for item in select value from jsonb_array_elements(step->'choices'->key) loop
     select c.key into feat_key from jsonb_each(refs->'catalog') c where c.value->>'name'=item#>>'{}' and c.value->>'category'='feat';
     if feat_key is not null then
      if feat_key=any(feat_ids) then return false; end if;
      feat_ids:=array_append(feat_ids,feat_key);
     end if;
    end loop;
   end if;
  end loop;
  if step->'choices'->'fighting-style' @> '["Blessed Warrior"]'::jsonb or step->'choices'->'fighting-style' @> '["Druidic Warrior"]'::jsonb then
   selected:=step->'choices'->'warrior-cantrips'; feature_keys:=array_append(feature_keys,'warrior-cantrips');
   if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)<>2 or selected->0=selected->1 then return false; end if;
   for item in select value from jsonb_array_elements(selected) loop
    e:=refs->'catalog'->(item#>>'{}');
    if e->>'category' is distinct from 'spell' or e->>'level' is distinct from '0' or not (e->'classes' @> jsonb_build_array(case when name='Paladin' then 'Cleric' else 'Druid' end)) then return false; end if;
   end loop;
  end if;
  for key in select jsonb_object_keys(step->'choices') loop
   if not key=any(feature_keys) then
    e:=refs->'catalog'->key;
    if not (step->'options' @> jsonb_build_array(key)) or not (coalesce((e->>'cantripInvocation')::boolean,false) or e->>'name'='Pact of the Tome') then return false; end if;
   end if;
  end loop;
  permanent:=permanent||(step->'skills')||(step->'replacementSkills')||coalesce(step->'feat'->'skills','[]'::jsonb);
  before_step:=jsonb_set(before_step,array[name],step);
 end loop;
 if not public.valid_srd_companions(doc) then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function public.valid_srd_transition(before_doc jsonb, after_doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
#variable_conflict use_column
declare refs jsonb:=public.srd_builder_reference(); pairs jsonb; pair jsonb; old_feat jsonb; new_feat jsonb; old_step jsonb; n integer; idx integer:=0; delta integer;
begin
 if before_doc is null or after_doc is null then return true; end if; -- explicit detach/homebrew is allowed
 delta:=jsonb_array_length(after_doc->'levels')-jsonb_array_length(before_doc->'levels');
 if delta<0 then return false; end if;
 pairs:=jsonb_build_array(jsonb_build_array(before_doc->'originFeat',after_doc->'originFeat'),jsonb_build_array(before_doc->'humanFeat',after_doc->'humanFeat'));
 for old_step in select value from jsonb_array_elements(before_doc->'levels') loop
  if old_step->'className' is distinct from after_doc->'levels'->idx->'className' then return false; end if;
  pairs:=pairs||jsonb_build_array(jsonb_build_array(old_step->'feat',after_doc->'levels'->idx->'feat')); idx:=idx+1;
 end loop;
  -- Corrections without a level gain still pass the full sheet validator.
  if delta=0 then return true; end if;
  for pair in select value from jsonb_array_elements(pairs) loop
  old_feat:=pair->0; new_feat:=pair->1;
  if old_feat='null'::jsonb and new_feat='null'::jsonb then continue; end if;
  if refs->'catalog'->(old_feat->>'id')->>'name'='Magic Initiate' then
   if (old_feat-'spells') is distinct from (new_feat-'spells') then return false; end if;
   select count(*) into n from jsonb_array_elements(new_feat->'spells') t(v) where not (old_feat->'spells' @> jsonb_build_array(v));
   if n>delta then return false; end if;
  elsif old_feat is distinct from new_feat then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create or replace function public.guard_srd_progression() returns trigger
language plpgsql set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.valid_srd_transition(old.sheet->'character'->'builder',new.sheet->'character'->'builder') then
   raise exception 'Illegal SRD progression: applied classes cannot change or be removed; save feat corrections before leveling up';
  end if;
 return new;
end $$;
