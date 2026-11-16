/* eslint-disable @typescript-eslint/no-require-imports -- Build-time CommonJS hook loads local TypeScript without adding a runtime dependency. */
/* Reproduce database reference metadata from the SAME TypeScript rules used by
 * server validation. Run after scripts/import-srd.py. No service access needed. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
};
const rules = require('../src/lib/srd-rules.ts');
const state = require('../src/lib/srd-state.ts');
const catalog = require('../src/lib/srd-catalog.ts').srdCatalog;
const shapes = require('../src/lib/srd-shapes.ts');
const { dndId } = require('../src/lib/dnd.ts');
const equipment = require('../src/lib/srd-equipment.ts');
const casting = require('../src/lib/srd-casting.ts');
const spellIds = (names) =>
  names
    .map((name) => catalog.find((entry) => entry.category === 'spell' && entry.name === name)?.id)
    .filter(Boolean);
const reference = {
  classes: Object.fromEntries(
    rules.srdClasses.map((name) => [
      name,
      {
        ...rules.classRules[name],
        levels: Array.from({ length: 20 }, (_, i) => ({
          ...rules.classSpellLimits(name, i + 1),
          alwaysPrepared: spellIds(rules.alwaysPrepared(name, i + 1)),
          ...(name === 'Druid'
            ? {
                landSpells: Object.fromEntries(
                  ['Arid', 'Polar', 'Temperate', 'Tropical'].map((land) => [
                    land,
                    spellIds(rules.alwaysPrepared(name, i + 1, land)),
                  ]),
                ),
              }
            : {}),
          skillsFirst: state.skillChoicesAt(name, i + 1, true),
          skillsMulti: state.skillChoicesAt(name, i + 1, false),
          expertise: state.expertiseChoicesAt(name, i + 1),
          mastery: state.masteryCount(name, i + 1),
          options: state.optionCount(name, i + 1),
          feat: state.featAt(name, i + 1),
          choicesFirst: state.featureChoicesAt(name, i + 1, true),
          choicesMulti: state.featureChoicesAt(name, i + 1, false),
        })),
      },
    ]),
  ),
  species: rules.srdSpecies,
  shapes: Object.fromEntries(
    shapes.srdShapes.map((shape) => [
      shape.id,
      { cr: shape.cr, beast: shape.beast, swarm: shape.swarm, pactChain: shape.pactChain },
    ]),
  ),
  familiarSpellId: spellIds(['Find Familiar'])[0],
  steedSpellId: spellIds(['Find Steed'])[0],
  backgrounds: rules.backgrounds,
  lineages: rules.lineages,
  alignments: rules.srdAlignments,
  skills: rules.allSkills,
  tools: rules.toolNames,
  languages: rules.standardLanguages,
  gamingSets: rules.gamingSets,
  weapons: state.weaponNames,
  equipment: {
    pactItemId: equipment.pactConjuredId,
    acModes: equipment.acModes,
    armorProfiles: equipment.armorProfiles,
    weaponProfiles: Object.fromEntries(
      state.weaponNames.map((name) => {
        const p = equipment.weaponProfile(name);
        return [
          name,
          {
            dice: p.dice,
            finesse: p.finesse,
            ranged: p.ranged,
            monkWeapon:
              !p.ranged && (state.weaponNames.indexOf(name) < 10 || /\bLight\b/.test(p.entry.text)),
          },
        ];
      }),
    ),
    offers: Object.fromEntries(equipment.equipmentShop.map((offer) => [offer.key, offer])),
    classGold: equipment.classStartingGold,
    backgroundGold: { Acolyte: 8, Criminal: 16, Sage: 8, Soldier: 14 },
    instruments: rules.instruments,
    packs: Object.fromEntries(
      Object.entries(equipment.equipmentPacks).map(([name, pack]) => [
        name,
        pack.items.map((item) => item.name),
      ]),
    ),
    classStock: Object.fromEntries(
      rules.srdClasses.map((name) => [
        name,
        Object.fromEntries(
          ['A', 'B', 'C'].map((choice) => [
            choice,
            equipment
              .classLots({
                levels: [{ className: name, choices: { 'monk-tool': ['$monk-tool'] } }],
                classEquipment: choice,
                equipment: {
                  ...equipment.defaultEquipment(),
                  instrument: '$instrument',
                  classSymbol: '$class-symbol',
                },
              })
              .map((item) => item.name),
          ]),
        ),
      ]),
    ),
    backgroundStock: Object.fromEntries(
      rules.srdBackgrounds.map((name) => [
        name,
        equipment
          .backgroundLots({
            background: name,
            backgroundEquipment: 'A',
            tools: ['$gaming-set'],
            equipment: { ...equipment.defaultEquipment(), backgroundSymbol: '$background-symbol' },
          })
          .map((item) => item.name),
      ]),
    ),
    startingIds: {},
  },
  invocationSpells: Object.fromEntries(
    Object.entries(casting.invocationSpellNames).map(([name, spell]) => [
      name,
      spellIds([spell])[0],
    ]),
  ),
  speciesSpells: Object.fromEntries(
    rules.srdSpecies.flatMap((species) =>
      (rules.lineages[species] ?? ['']).map((lineage) => [
        `${species}:${lineage}`,
        [1, 3, 5].map((level) =>
          casting.speciesSpellIds({
            species,
            lineage,
            levels: Array(level).fill({}),
            speciesCantrip: spellIds(['Prestidigitation'])[0],
          }),
        ),
      ]),
    ),
  ),
  meleeWeapons: state.weaponNames.filter(
    (name) =>
      ![
        'Dart',
        'Light Crossbow',
        'Shortbow',
        'Sling',
        'Blowgun',
        'Hand Crossbow',
        'Heavy Crossbow',
        'Longbow',
        'Musket',
        'Pistol',
      ].includes(name),
  ),
  rogueWeapons: state.weaponNames.filter(
    (name, index) =>
      index < 14 ||
      /\b(Finesse|Light)\b/.test(
        catalog.find((entry) => entry.kind === 'weapon' && entry.name === name)?.text ?? '',
      ),
  ),
  catalog: Object.fromEntries(
    catalog.map((e) => [
      e.id,
      {
        name: e.name,
        category: e.category,
        level: e.level,
        classes: e.classes,
        featCategory: e.featCategory,
        className: e.className,
        sheetId: dndId(`srd:${e.id}`),
        minimum: Number(/Prerequisite: Level (\d+)\+/.exec(e.text)?.[1] ?? 1),
        repeatable: e.text.includes('Repeatable.'),
        damage: /\bdamage\b/.test(e.text),
        range: Number(/Range: (\d+)\s*(?:feet|foot)/.exec(e.text)?.[1] ?? 0),
        attackRoll: /attack roll|(?:ranged|melee) spell attack|make one attack/.test(e.text),
        ritual: /Ritual/.test(e.text),
        cantripInvocation: /a Warlock Cantrip/.test(e.text),
        requiresInvocation:
          /(?:Pact of the (Blade|Chain|Tome)|Thirsting Blade)\s+Invocation/
            .exec(e.text.replace(/\n/g, ' '))?.[0]
            .replace(/\s+Invocation$/, '') ?? null,
      },
    ]),
  ),
};
const allNames = new Set([
  ...equipment.equipmentShop.map((offer) => offer.name),
  ...rules.toolNames,
  'Book (prayers)',
  'Book (history)',
  'Book (occult lore)',
  'Gold Pieces',
  'Silver Pieces',
  'Copper Pieces',
  ...Object.values(equipment.equipmentPacks).flatMap((pack) => pack.items.map((item) => item.name)),
]);
for (const stocks of Object.values(reference.equipment.classStock))
  for (const names of Object.values(stocks))
    for (const name of names) if (!name.includes('$')) allNames.add(name);
for (const names of Object.values(reference.equipment.backgroundStock))
  for (const name of names) if (!name.includes('$')) allNames.add(name);
reference.equipment.startingIds = Object.fromEntries(
  [...allNames].map((name) => [name, equipment.startingItemId(name)]),
);
const json = JSON.stringify(reference);
const sql = `-- Generated by scripts/generate-srd-migration.cjs; SRD 5.2.1, CC BY 4.0.
-- Optional extension only. Legacy/manual sheets continue through valid_sheet_v2.
create function public.srd_builder_reference() returns jsonb language sql immutable
set search_path = '' as $function$ select $srd$${json}$srd$::jsonb $function$;

create function public.srd_string_choices(doc jsonb, allowed jsonb, expected integer default null, distinct_only boolean default true)
returns boolean language plpgsql immutable set search_path = '' as $$
declare value jsonb;
begin
  if jsonb_typeof(doc) is distinct from 'array' or jsonb_array_length(doc)>100 then return false; end if;
  if expected is not null and jsonb_array_length(doc)<>expected then return false; end if;
  if distinct_only and (select count(distinct v) from jsonb_array_elements(doc) t(v))<>jsonb_array_length(doc) then return false; end if;
  for value in select v from jsonb_array_elements(doc) t(v) loop
    if jsonb_typeof(value) is distinct from 'string' or not (allowed @> jsonb_build_array(value)) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function public.valid_srd_feat(doc jsonb, total integer, scores jsonb, required_category text default null, required_name text default null, required_list text default null)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  refs jsonb:=public.srd_builder_reference(); entry jsonb; boosts jsonb; v jsonb;
  n integer; i integer; amount integer:=0; expected integer; spells integer:=0; cantrips integer:=0; key text;
begin
  if jsonb_typeof(doc) is distinct from 'object' then return false; end if;
  for key in select jsonb_object_keys(doc) loop
    if key not in ('id','increases','skills','spellList','spellAbility','spells') then return false; end if;
  end loop;
  entry:=refs->'catalog'->(doc->>'id'); boosts:=doc->'increases';
  if entry->>'category' is distinct from 'feat' or (required_category is not null and entry->>'featCategory' is distinct from required_category)
    or (required_name is not null and entry->>'name' is distinct from required_name) then return false; end if;
  if (entry->>'featCategory'='General' and total<4) or (entry->>'featCategory'='Epic Boon' and total<19) then return false; end if;
  if jsonb_typeof(boosts) is distinct from 'array' or jsonb_array_length(boosts)<>6 then return false; end if;
  for i in 0..5 loop
    if jsonb_typeof(boosts->i) is distinct from 'number' then return false; end if;
    n:=(boosts->>i)::integer;
    if (boosts->>i)::numeric<>n or n<0 or n>2 then return false; end if;
    amount:=amount+n;
    if n>0 and (scores->>i)::integer+n>(case when entry->>'featCategory'='Epic Boon' then 30 else 20 end) then return false; end if;
    if n>0 and entry->>'name' in ('Grappler','Boon of Irresistible Offense') and i not in (0,1) then return false; end if;
    if n>0 and entry->>'name'='Boon of Spell Recall' and i<3 then return false; end if;
  end loop;
  expected:=case when entry->>'name'='Ability Score Improvement' then 2 when entry->>'name'='Grappler' or entry->>'featCategory'='Epic Boon' then 1 else 0 end;
  if amount<>expected then return false; end if;
  if entry->>'name'='Grappler' and (scores->>0)::integer<13 and (scores->>1)::integer<13 then return false; end if;
  if not public.srd_string_choices(doc->'skills',(refs->'skills')||(refs->'tools'),case when entry->>'name'='Skilled' then 3 else 0 end) then return false; end if;
  if jsonb_typeof(doc->'spells') is distinct from 'array' or jsonb_array_length(doc->'spells')>3 then return false; end if;
  if entry->>'name'='Magic Initiate' then
    if doc->>'spellList' is null or doc->>'spellList' not in ('Cleric','Druid','Wizard') or
      (required_list is not null and doc->>'spellList' is distinct from required_list) or
      jsonb_typeof(doc->'spellAbility') is distinct from 'number' or doc->>'spellAbility' not in ('3','4','5') then return false; end if;
    if jsonb_array_length(doc->'spells')<>3 or (select count(distinct value) from jsonb_array_elements(doc->'spells'))<>3 then return false; end if;
    for v in select value from jsonb_array_elements(doc->'spells') loop
      entry:=refs->'catalog'->(v#>>'{}');
      if entry->>'category' is distinct from 'spell' or not (entry->'classes' @> jsonb_build_array(doc->>'spellList')) then return false; end if;
      if entry->>'level'='0' then cantrips:=cantrips+1; elsif entry->>'level'='1' then spells:=spells+1; else return false; end if;
    end loop;
    if cantrips<>2 or spells<>1 then return false; end if;
  elsif jsonb_array_length(doc->'spells')<>0 or doc ? 'spellAbility' or doc ? 'spellList' then return false;
  end if;
  return true;
exception when others then return false;
end $$;

create function public.srd_automatic_prepared(doc jsonb, class_name text, through_level integer) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare refs jsonb:=public.srd_builder_reference(); own jsonb:='[]'; row_doc jsonb; latest jsonb; result jsonb:='[]'; land text; v jsonb; spec jsonb;
begin
 for row_doc in select value from jsonb_array_elements(doc->'levels') with ordinality t(value,ord) where ord<=through_level loop
  if row_doc->>'className'=class_name then own:=own||jsonb_build_array(row_doc); latest:=row_doc; end if;
 end loop;
 spec:=refs->'classes'->class_name->'levels'->(jsonb_array_length(own)-1);
 result:=spec->'alwaysPrepared';
 if class_name='Druid' then
  for row_doc in select value from jsonb_array_elements(own) loop
   if row_doc->'choices' ? 'land' then land:=row_doc->'choices'->'land'->>0; end if;
  end loop;
  if land is not null then result:=spec->'landSpells'->land; end if;
 end if;
 if class_name='Bard' then result:=result||coalesce(latest->'choices'->'magical-discoveries','[]'::jsonb); end if;
 if class_name='Wizard' then
  for row_doc in select value from jsonb_array_elements(own) loop
   result:=result||coalesce(row_doc->'choices'->'spell-mastery','[]'::jsonb)||coalesce(row_doc->'choices'->'signature-spells','[]'::jsonb);
  end loop;
 end if;
 if class_name='Warlock' then
  for v in select value from jsonb_array_elements(latest->'options') loop
   if refs->'catalog'->(v#>>'{}')->>'name'='Pact of the Tome' then result:=result||coalesce(latest->'choices'->(v#>>'{}'),'[]'::jsonb); end if;
  end loop;
 end if;
 return result;
end $$;

create function public.valid_srd_equipment(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare refs jsonb:=public.srd_builder_reference()->'equipment'; gear jsonb:=doc->'equipment'; v jsonb; buy jsonb; offer jsonb; key text; n integer; budget numeric; spent numeric:=0; names text[]:='{}';
begin
 if gear is null then return true; end if; -- pre-equipment builder snapshots
 if jsonb_typeof(gear) is distinct from 'object' then return false; end if;
 for key in select jsonb_object_keys(gear) loop
  if key not in ('grantStarting','classSymbol','backgroundSymbol','instrument','purchases','armorId','shieldId','acMode','weaponIds','weaponAbilities','twoHanded','expandLegacyBundles','appliedAC','appliedSpeed','appliedWeaponBonuses','appliedDamageBonuses') then return false; end if;
 end loop;
 if gear->>'classSymbol' is null or gear->>'classSymbol' not in ('Amulet','Emblem','Reliquary') or gear->>'backgroundSymbol' is null or gear->>'backgroundSymbol' not in ('Amulet','Emblem','Reliquary') then return false; end if;
 if jsonb_typeof(gear->'instrument') is distinct from 'string' or (gear->>'instrument'<>'' and not (refs->'instruments' @> jsonb_build_array(gear->>'instrument'))) then return false; end if;
 if gear ? 'grantStarting' and jsonb_typeof(gear->'grantStarting') is distinct from 'boolean' then return false; end if;
 if gear->'grantStarting' is distinct from 'false'::jsonb and doc->'levels'->0->>'className'='Bard' and doc->>'classEquipment'='A' and not (refs->'instruments' @> jsonb_build_array(gear->>'instrument')) then return false; end if;
 if not (refs->'acModes' @> jsonb_build_array(gear->>'acMode')) or jsonb_typeof(gear->'expandLegacyBundles') is distinct from 'boolean' then return false; end if;
 if gear->'grantStarting'='false'::jsonb and gear->'expandLegacyBundles'='true'::jsonb then return false; end if;
 foreach key in array array['armorId','shieldId'] loop
  if jsonb_typeof(gear->key) is distinct from 'string' then return false; end if;
  if gear->>key not in ('','auto') then perform (gear->>key)::uuid; end if;
 end loop;
 foreach key in array array['weaponIds','weaponAbilities','twoHanded'] loop
  if jsonb_typeof(gear->key) is distinct from 'array' or jsonb_array_length(gear->key)<>3 then return false; end if;
  for v in select value from jsonb_array_elements(gear->key) loop
   if key='weaponIds' then
    if jsonb_typeof(v) is distinct from 'string' then return false; end if;
    if v#>>'{}' not in ('','auto') then perform (v#>>'{}')::uuid; end if;
   elsif key='twoHanded' then if jsonb_typeof(v) is distinct from 'boolean' then return false; end if;
   elsif jsonb_typeof(v) is distinct from 'number' or v#>>'{}' not in ('-1','0','1') then return false;
   end if;
  end loop;
 end loop;
 foreach key in array array['appliedAC','appliedSpeed'] loop
  if gear ? key then
   if jsonb_typeof(gear->key) is distinct from 'number' or (gear->>key)::numeric<>trunc((gear->>key)::numeric) or (gear->>key)::numeric not between 0 and 1000 then return false; end if;
  end if;
 end loop;
 foreach key in array array['appliedWeaponBonuses','appliedDamageBonuses'] loop
  if gear ? key then
   if jsonb_typeof(gear->key) is distinct from 'array' or jsonb_array_length(gear->key)<>3 then return false; end if;
   for v in select value from jsonb_array_elements(gear->key) loop
    if jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric<>trunc((v#>>'{}')::numeric) or (v#>>'{}')::numeric not between 0 and (case when key='appliedWeaponBonuses' then 5 else 3 end) then return false; end if;
   end loop;
  end if;
 end loop;
 if gear->>'acMode' in ('barbarian','monk','draconic') then
  select count(*) into n from jsonb_array_elements(doc->'levels') t(v) where v->>'className'=case gear->>'acMode' when 'barbarian' then 'Barbarian' when 'monk' then 'Monk' else 'Sorcerer' end;
  if n<(case when gear->>'acMode'='draconic' then 3 else 1 end) then return false; end if;
 end if;
 budget:=((refs->'classGold'->(doc->'levels'->0->>'className')->>(case doc->>'classEquipment' when 'A' then 0 when 'B' then 1 else 2 end))::numeric+case when doc->>'backgroundEquipment'='B' then 50 else (refs->'backgroundGold'->>(doc->>'background'))::numeric end)*100;
 if jsonb_typeof(gear->'purchases') is distinct from 'array' or jsonb_array_length(gear->'purchases')>100 then return false; end if;
 if gear->'grantStarting'='false'::jsonb and jsonb_array_length(gear->'purchases')<>0 then return false; end if;
 for buy in select value from jsonb_array_elements(gear->'purchases') loop
  if jsonb_typeof(buy) is distinct from 'object' or (select count(*) from jsonb_object_keys(buy))<>2 or not (buy ?& array['key','quantity']) then return false; end if;
  offer:=refs->'offers'->(buy->>'key');
  if offer is null or buy->>'key'=any(names) or jsonb_typeof(buy->'quantity') is distinct from 'number' or (buy->>'quantity')::numeric<>trunc((buy->>'quantity')::numeric) or (buy->>'quantity')::numeric not between 1 and 30000 then return false; end if;
  names:=array_append(names,buy->>'key'); spent:=spent+(offer->>'copper')::numeric*(buy->>'quantity')::numeric;
 end loop;
 return spent<=budget;
exception when others then return false;
end $$;

create function public.srd_starting_names(doc jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare refs jsonb:=public.srd_builder_reference()->'equipment'; gear jsonb:=doc->'equipment'; names jsonb; result jsonb:='[]'; v jsonb; x jsonb; name text; expanded jsonb;
begin
 if gear->'grantStarting'='false'::jsonb then return '[]'::jsonb; end if;
 names:=refs->'classStock'->(doc->'levels'->0->>'className')->(doc->>'classEquipment');
 if doc->>'backgroundEquipment'='A' then names:=names||(refs->'backgroundStock'->(doc->>'background')); end if;
 for v in select value from jsonb_array_elements(gear->'purchases') loop names:=names||jsonb_build_array(refs->'offers'->(v->>'key')->>'name'); end loop;
 for v in select value from jsonb_array_elements(names) loop
  name:=replace(replace(replace(replace(replace(v#>>'{}','$instrument',coalesce(gear->>'instrument','')),'$class-symbol',coalesce(gear->>'classSymbol','Amulet')),'$background-symbol',coalesce(gear->>'backgroundSymbol','Amulet')),'$gaming-set',coalesce(doc->'tools'->>0,'')),'$monk-tool',coalesce(doc->'levels'->0->'choices'->'monk-tool'->>0,''));
  expanded:=case when refs->'packs' ? name then refs->'packs'->name else jsonb_build_array(name) end;
  for x in select value from jsonb_array_elements(expanded) loop if x<>'""'::jsonb and not (result @> jsonb_build_array(x)) then result:=result||jsonb_build_array(x); end if; end loop;
 end loop;
 return result;
end $$;

create function public.valid_srd_loadout(sheet jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare doc jsonb:=sheet->'character'->'builder'; gear jsonb:=doc->'equipment'; refs jsonb:=public.srd_builder_reference()->'equipment'; companion jsonb:=doc->'companions'; pact_id text;
 item jsonb; v jsonb; worn jsonb; shield jsonb; weapons jsonb:='[]'; names jsonb; base text; key text; id text; idx integer; profile jsonb;
begin
 if gear is null then return true; end if;
 names:=public.srd_starting_names(doc);
 if coalesce(companion->>'pactOwnedId','')<>'' then
  select x into item from jsonb_array_elements(sheet->'character'->'items') x where x->>'id'=companion->>'pactOwnedId' and (x->>'quantity')::numeric>0;
  base:=regexp_replace(regexp_replace(item->>'name',' \\+[1-3]$',''),' \\(.*\\)$','');
  if item is null or not (refs->'weaponProfiles' ? base) or not (item->>'rarity'<>'Common' or item->'requiresAttunement'='true'::jsonb or item->>'name' ~ ' \\+[1-3]$') then return false; end if;
 end if;
 if companion->'pactActive'='true'::jsonb then
  pact_id:=coalesce(nullif(companion->>'pactOwnedId',''),refs->>'pactItemId');
  select x into item from jsonb_array_elements(sheet->'character'->'items') x where x->>'id'=pact_id and (x->>'quantity')::numeric>0;
  if item is null then return false; end if;
  if coalesce(companion->>'pactOwnedId','')<>'' and not (item->>'rarity'<>'Common' or item->'requiresAttunement'='true'::jsonb or item->>'name' ~ ' \\+[1-3]$') then return false; end if;
  if coalesce(companion->>'pactOwnedId','')='' and (item->>'quantity')::integer<>1 then return false; end if;
  weapons:=weapons||jsonb_build_array(item);
 end if;
 foreach key in array array['armorId','shieldId'] loop
  item:=null; id:=gear->>key;
  if id='auto' then
   for v in select value from jsonb_array_elements(names) loop
    if (key='armorId' and refs->'armorProfiles' ? (v#>>'{}')) or (key='shieldId' and v#>>'{}'='Shield') then
     select x into item from jsonb_array_elements(sheet->'character'->'items') x where x->>'id'=refs->'startingIds'->>(v#>>'{}') and (x->>'quantity')::numeric>0;
     if item is not null then exit; end if;
    end if;
   end loop;
  elsif id<>'' then
   select x into item from jsonb_array_elements(sheet->'character'->'items') x where x->>'id'=id and (x->>'quantity')::numeric>0;
   if item is null then return false; end if;
  end if;
  if item is not null then
   base:=regexp_replace(regexp_replace(item->>'name',' \\([0-9,]+ (GP|SP|CP)\\)$',''),' \\+[1-3]$','');
   if key='armorId' and not (refs->'armorProfiles' ? base) and gear->>'acMode'<>'manual' then return false; end if;
   if key='shieldId' and base<>'Shield' and gear->>'acMode'<>'manual' then return false; end if;
  end if;
  if key='armorId' then worn:=item; else shield:=item; end if;
 end loop;
 if gear->>'acMode'='armor' and worn is null then return false; end if;
 if gear->>'acMode' in ('standard','barbarian','monk','draconic') and worn is not null then return false; end if;
 if gear->>'acMode'='monk' and shield is not null then return false; end if;
 for v in select value from jsonb_array_elements(names) loop
  base:=regexp_replace(v#>>'{}',' \\(.*\\)$','');
  if refs->'weaponProfiles' ? base then
   select x into item from jsonb_array_elements(sheet->'character'->'items') x where x->>'id'=refs->'startingIds'->>(v#>>'{}') and (x->>'quantity')::numeric>0;
   if item is not null and not exists(select 1 from jsonb_array_elements(weapons) t(v) where v->>'id'=item->>'id') then weapons:=weapons||jsonb_build_array(item); end if;
  end if;
 end loop;
 for idx in 0..2 loop
  id:=gear->'weaponIds'->>idx;
  if id='' then continue; end if;
  if id='auto' then item:=weapons->idx;
  else select x into item from jsonb_array_elements(sheet->'character'->'items') x where x->>'id'=id and (x->>'quantity')::numeric>0;
   if item is null then return false; end if;
  end if;
  if item is null then continue; end if;
  base:=regexp_replace(regexp_replace(item->>'name',' \\+[1-3]$',''),' \\(.*\\)$','');
  if item->>'id'=pact_id and coalesce(companion->>'pactOwnedId','')='' then base:=companion->>'pactWeapon'; end if;
  profile:=refs->'weaponProfiles'->base;
  if profile is null or not ((profile->>'dice') ~ '^[0-9]+d(4|6|8|10|12|20)$') then return false; end if;
  if not (coalesce(item->>'id'=pact_id,false) and companion->'pactCharisma' is distinct from 'false'::jsonb) and not (profile->>'finesse')::boolean and not (worn is null and shield is null and (profile->>'monkWeapon')::boolean and exists(select 1 from jsonb_array_elements(doc->'levels') t(x) where x->>'className'='Monk')) and gear->'weaponAbilities'->>idx<>'-1' and (gear->'weaponAbilities'->>idx)::integer<>(case when (profile->>'ranged')::boolean then 1 else 0 end) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.valid_srd_builder(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
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
  if (doc->'baseScores'->>i)::numeric<>score or score not between 3 and 18 or (doc->'backgroundBoosts'->>i)::numeric<>n or n not between 0 and 2 then return false; end if;
  if n>0 and not (bg->'abilities' @> jsonb_build_array(i)) then return false; end if;
  amount:=amount+n;
  if score+n>20 then return false; end if;
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
 else return false; end if;
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

create function public.srd_casting_sources(doc jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare refs jsonb:=public.srd_builder_reference(); result jsonb:='{}'; latest jsonb:='{}'; row_doc jsonb; step jsonb; spells jsonb; v jsonb; pair record; name text; id text; n integer; idx integer:=0; species_key text;
begin
 for row_doc in select value from jsonb_array_elements(doc->'levels') loop latest:=jsonb_set(latest,array[row_doc->>'className'],row_doc); end loop;
 for pair in select key,value from jsonb_each(latest) loop
  name:=pair.key; step:=pair.value;
  if refs->'classes'->name ? 'spellAbility' then
   spells:=(step->'cantrips')||(step->'spells')||(step->'spellbook')||public.srd_automatic_prepared(doc,name,jsonb_array_length(doc->'levels'));
   if name='Druid' and (select count(*) from jsonb_array_elements(doc->'levels') t(v) where v->>'className'='Druid')>=2 then spells:=spells||jsonb_build_array(refs->>'familiarSpellId'); end if;
   for row_doc in select value from jsonb_array_elements(doc->'levels') where value->>'className'=name loop spells:=spells||coalesce(row_doc->'choices'->'mystic-arcanum','[]'::jsonb)||coalesce(row_doc->'choices'->'warrior-cantrips','[]'::jsonb); end loop;
   for v in select value from jsonb_array_elements(step->'options') loop
    if refs->'catalog'->(v#>>'{}')->>'name'='Pact of the Tome' then spells:=spells||coalesce(step->'choices'->(v#>>'{}'),'[]'::jsonb); end if;
    id:=refs->'invocationSpells'->>(refs->'catalog'->(v#>>'{}')->>'name'); if id is not null then spells:=spells||jsonb_build_array(id); end if;
   end loop;
   result:=jsonb_set(result,array['class:'||name],jsonb_build_object('ability',refs->'classes'->name->'spellAbility','spells',spells));
  end if;
  idx:=0;
  for v in select value from jsonb_array_elements(step->'invocationFeats') loop
   if refs->'catalog'->(v->>'id')->>'name'='Magic Initiate' then result:=jsonb_set(result,array['feat:invocation:'||name||':'||idx::text],jsonb_build_object('ability',v->'spellAbility','spells',v->'spells')); end if;
   idx:=idx+1;
  end loop;
 end loop;
 foreach name in array array['originFeat','humanFeat'] loop
  v:=doc->name;
  if refs->'catalog'->(v->>'id')->>'name'='Magic Initiate' then
   id:=case when name='originFeat' then 'feat:background' else 'feat:human' end;
   result:=jsonb_set(result,array[id],jsonb_build_object('ability',v->'spellAbility','spells',v->'spells'));
  end if;
 end loop;
 idx:=0;
 for row_doc in select value from jsonb_array_elements(doc->'levels') loop
  idx:=idx+1; v:=row_doc->'feat';
  if refs->'catalog'->(v->>'id')->>'name'='Magic Initiate' then result:=jsonb_set(result,array['feat:level:'||idx::text],jsonb_build_object('ability',v->'spellAbility','spells',v->'spells')); end if;
 end loop;
 if doc->>'species' in ('Elf','Gnome','Tiefling') then
  species_key:=doc->>'species'||':'||(doc->>'lineage'); n:=jsonb_array_length(doc->'levels');
  spells:=refs->'speciesSpells'->species_key->(case when n>=5 then 2 when n>=3 then 1 else 0 end);
  if doc->>'lineage'='High Elf' then spells:=jsonb_set(spells,'{0}',doc->'speciesCantrip'); end if;
  result:=jsonb_set(result,array['species:'||(doc->>'species')],jsonb_build_object('ability',doc->'speciesSpellAbility','spells',spells));
 end if;
 return result;
end $$;

create function public.valid_srd_companions(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare selected jsonb:=doc->'companions'; refs jsonb:=public.srd_builder_reference(); source jsonb; shape jsonb; latest jsonb; key text; normal boolean:=false; wild boolean:=false; chain boolean:=false; blade boolean:=false; steed boolean:=false; pair record;
begin
 if selected is null then return true; end if;
 if jsonb_typeof(selected) is distinct from 'object' or not (selected ?& array['familiarMode','familiarForm','familiarType','steedAppearance','steedType','pactWeapon','pactDamage']) then return false; end if;
 for key in select jsonb_object_keys(selected) loop if key not in ('familiarMode','familiarForm','familiarType','steedAppearance','steedType','pactWeapon','pactDamage','pactActive','pactOwnedId','pactCharisma') then return false; end if; end loop;
 foreach key in array array['pactActive','pactCharisma'] loop if selected ? key and jsonb_typeof(selected->key) is distinct from 'boolean' then return false; end if; end loop;
 if selected ? 'pactOwnedId' then
  if jsonb_typeof(selected->'pactOwnedId') is distinct from 'string' then return false; end if;
  if selected->>'pactOwnedId'<>'' then perform (selected->>'pactOwnedId')::uuid; end if;
 end if;
 if selected->>'familiarMode' is null or selected->>'familiarMode' not in ('none','spell','wild-companion','pact-chain') or selected->>'familiarType' is null or selected->>'familiarType' not in ('Celestial','Fey','Fiend') or selected->>'steedType' is null or selected->>'steedType' not in ('Celestial','Fey','Fiend') or selected->>'pactDamage' is null or selected->>'pactDamage' not in ('Normal','Necrotic','Psychic','Radiant') then return false; end if;
 foreach key in array array['familiarForm','steedAppearance','pactWeapon'] loop if jsonb_typeof(selected->key) is distinct from 'string' or length(selected->>key)>(case when key='familiarForm' then 120 else 80 end) then return false; end if; end loop;
 for pair in select key,value from jsonb_each(public.srd_casting_sources(doc)) loop
  if pair.key not in ('class:Druid','class:Warlock') and pair.value->'spells' @> jsonb_build_array(refs->>'familiarSpellId') then normal:=true; end if;
  if pair.value->'spells' @> jsonb_build_array(refs->>'steedSpellId') then steed:=true; end if;
 end loop;
 select count(*)>=2 into wild from jsonb_array_elements(doc->'levels') t(v) where v->>'className'='Druid';
 select v into latest from jsonb_array_elements(doc->'levels') with ordinality t(v,ord) where v->>'className'='Warlock' order by ord desc limit 1;
 for source in select value from jsonb_array_elements(latest->'options') loop
  key:=refs->'catalog'->(source#>>'{}')->>'name';
  if key='Pact of the Chain' then chain:=true; elsif key='Pact of the Blade' then blade:=true; elsif key='Pact of the Tome' and latest->'choices'->(source#>>'{}') @> jsonb_build_array(refs->>'familiarSpellId') then normal:=true; end if;
 end loop;
 if selected->>'familiarMode'='none' then if selected->>'familiarForm'<>'' then return false; end if;
 else
  if (selected->>'familiarMode'='spell' and not normal) or (selected->>'familiarMode'='wild-companion' and not wild) or (selected->>'familiarMode'='pact-chain' and not chain) then return false; end if;
  shape:=refs->'shapes'->(selected->>'familiarForm');
  if shape is null or not (((shape->>'beast')::boolean and not (shape->>'swarm')::boolean and (shape->>'cr')::numeric=0) or (selected->>'familiarMode'='pact-chain' and (shape->>'pactChain')::boolean)) then return false; end if;
  if selected->>'familiarMode'='wild-companion' and selected->>'familiarType'<>'Fey' then return false; end if;
 end if;
 if selected->>'steedAppearance'<>'' and not steed then return false; end if;
 if selected->>'pactWeapon'<>'' and (not blade or not (refs->'meleeWeapons' @> jsonb_build_array(selected->>'pactWeapon'))) then return false; end if;
 if coalesce(selected->>'pactOwnedId','')<>'' and (not blade or selected->>'pactWeapon'<>'') then return false; end if;
 if selected->'pactActive'='true'::jsonb and (not blade or coalesce(selected->>'pactOwnedId','')='' and selected->>'pactWeapon'='') then return false; end if;
 return true;
exception when others then return false;
end $$;

create function public.valid_srd_spell_casting(sheet jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare doc jsonb:=sheet->'character'->'builder'; refs jsonb:=public.srd_builder_reference(); sources jsonb; spell jsonb; entry jsonb; key text; ids text[]; selected jsonb;
begin
 if doc is not null then sources:=public.srd_casting_sources(doc); end if;
 for spell in select value from jsonb_array_elements(sheet->'character'->'spells') loop
  if not (spell ? 'casting') then continue; end if;
  if jsonb_typeof(spell->'casting') is distinct from 'array' or jsonb_array_length(spell->'casting')>30 then return false; end if;
  ids:='{}';
  for entry in select value from jsonb_array_elements(spell->'casting') loop
   if jsonb_typeof(entry) is distinct from 'object' or (select count(*) from jsonb_object_keys(entry))<>3 or not (entry ?& array['sourceId','ability','label']) then return false; end if;
   if jsonb_typeof(entry->'sourceId') is distinct from 'string' or length(entry->>'sourceId') not between 1 and 120 or entry->>'sourceId'=any(ids) or
    jsonb_typeof(entry->'label') is distinct from 'string' or length(entry->>'label') not between 1 and 120 or
    jsonb_typeof(entry->'ability') is distinct from 'number' or (entry->>'ability')::numeric<>trunc((entry->>'ability')::numeric) or (entry->>'ability')::integer not between 0 and 5 then return false; end if;
   ids:=array_append(ids,entry->>'sourceId');
   if doc is not null then
    selected:=sources->(entry->>'sourceId');
    if selected is null or selected->'ability' is distinct from entry->'ability' or not exists (select 1 from jsonb_array_elements(selected->'spells') t(v) where refs->'catalog'->(v#>>'{}')->>'sheetId'=spell->>'id') then return false; end if;
   end if;
  end loop;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.valid_srd_transition(before_doc jsonb, after_doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
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

create function public.guard_srd_progression() returns trigger
language plpgsql set search_path = '' as $$
begin
 if not public.valid_srd_transition(old.sheet->'character'->'builder',new.sheet->'character'->'builder') then raise exception 'Illegal SRD progression: applied feat identity is fixed; Magic Initiate changes at most one spell per gained character level'; end if;
 return new;
end $$;
create trigger actors_srd_progression before update of sheet on public.actors for each row execute function public.guard_srd_progression();

create function public.srd_builder_scores(doc jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare scores jsonb:='[]'; step jsonb; i integer; n integer; barb integer:=0; monk integer:=0;
begin
 for i in 0..5 loop
  n:=(doc->'baseScores'->>i)::integer+(doc->'backgroundBoosts'->>i)::integer;
  for step in select value from jsonb_array_elements(doc->'levels') loop
   n:=n+coalesce((step->'feat'->'increases'->>i)::integer,0);
  end loop;
  scores:=scores||jsonb_build_array(n);
 end loop;
 select count(*) into barb from jsonb_array_elements(doc->'levels') t(v) where v->>'className'='Barbarian';
 select count(*) into monk from jsonb_array_elements(doc->'levels') t(v) where v->>'className'='Monk';
 if barb=20 then
  scores:=jsonb_set(scores,'{0}',to_jsonb(least(25,(scores->>0)::integer+4)));
  scores:=jsonb_set(scores,'{2}',to_jsonb(least(25,(scores->>2)::integer+4)));
 end if;
 if monk=20 then
  scores:=jsonb_set(scores,'{1}',to_jsonb(least(25,(scores->>1)::integer+4)));
  scores:=jsonb_set(scores,'{4}',to_jsonb(least(25,(scores->>4)::integer+4)));
 end if;
 return scores;
end $$;

alter function public.valid_sheet(jsonb) rename to valid_sheet_v2;
create function public.valid_sheet(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare builder jsonb:=doc->'character'->'builder'; level_field jsonb; check_doc jsonb:=doc;
 scores jsonb; score_ids jsonb:='${JSON.stringify(Array.from({ length: 6 }, (_, i) => dndId(`score:${i}`)))}'; i integer;
 item jsonb; patched_items jsonb:='[]'; attuned integer:=0; rogue integer:=0;
begin
 if builder is null then return public.valid_sheet_v2(doc) and public.valid_srd_spell_casting(doc); end if;
 if not public.valid_srd_builder(builder) then return false; end if;
 if not public.valid_srd_loadout(doc) or not public.valid_srd_spell_casting(doc) then return false; end if;
 -- Thief level 13 increases attunement to four. Validate all original item
 -- fields through the old boundary, only masking that additional boolean.
 select count(*) into rogue from jsonb_array_elements(builder->'levels') t(v) where v->>'className'='Rogue';
 for item in select value from jsonb_array_elements(doc->'character'->'items') loop
  if item->'attuned'='true'::jsonb then
   attuned:=attuned+1;
   if attuned=4 and rogue>=13 then
    if item->'requiresAttunement' is distinct from 'true'::jsonb then return false; end if;
    item:=jsonb_set(item,'{attuned}','false'::jsonb);
   elsif attuned>3 then return false; end if;
  end if;
  patched_items:=patched_items||jsonb_build_array(item);
 end loop;
 check_doc:=jsonb_set(check_doc,'{character,items}',patched_items);
 if not public.valid_sheet_v2(check_doc) then return false; end if;
 select f into level_field from jsonb_array_elements(doc->'sections') s,
   jsonb_array_elements(s->'fields') f where f->>'id'='${dndId('level')}';
 if level_field->>'value' is distinct from jsonb_array_length(builder->'levels')::text then return false; end if;
 scores:=public.srd_builder_scores(builder);
 for i in 0..5 loop
  select f into level_field from jsonb_array_elements(doc->'sections') s,
    jsonb_array_elements(s->'fields') f where f->>'id'=score_ids->>i;
  if level_field->'value' is distinct from scores->i then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
alter table public.actors drop constraint actors_valid_sheet;
alter table public.templates drop constraint templates_valid_sheet;
alter table public.actors add constraint actors_valid_sheet check (public.valid_sheet(sheet));
alter table public.templates add constraint templates_valid_sheet check (public.valid_sheet(sheet));
`;
fs.writeFileSync(
  path.join(__dirname, '../supabase/migrations/202611150004_srd_builder.sql'),
  sql.replaceAll('as $$\n', () => 'as $$\n#variable_conflict use_column\n'),
);
console.log('Generated 202611150004_srd_builder.sql from source-derived rules.');
