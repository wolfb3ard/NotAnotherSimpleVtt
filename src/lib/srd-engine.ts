import { dndDamageExpression, dndId, skills } from './dnd';
import { emptyCharacterDetails, type CharacterDetails } from './character-details';
import type { Field, Sheet } from './types';
import { srdById, srdCatalog, srdEntry, srdExcerpt, type SrdEntry } from './srd-catalog';
import {
  abilityNames,
  alwaysPrepared,
  backgrounds,
  classRules,
  featuresAt,
  spellSlotTable,
  type SrdClass,
} from './srd-rules';
import { builderScores, classLevels, srdBuilderSchema, type SrdBuilderState } from './srd-state';
import {
  conjuredPactItem,
  deriveEquipment,
  isLegacyStartingBundle,
  pactConjuredId,
  startingInventory,
} from './srd-equipment';
import { srdCastingSources, speciesSpellIds } from './srd-casting';
import { companionCapabilities, defaultCompanions, shapeById } from './srd-shapes';
import { isLegacySrdCharacter } from './srd-adoption';

export function deriveSrd(state: SrdBuilderState) {
  const counts = classLevels(state.levels);
  const total = state.levels.length;
  const scores = builderScores(state);
  const mods = scores.map((n) => Math.floor((n - 10) / 2));
  const spellcasting = (Object.entries(counts) as [SrdClass, number][]).filter(([name]) =>
    ['full', 'half'].includes(classRules[name].caster ?? ''),
  );
  // Each half-caster rounds UP independently (2024), not down after summing.
  const casterLevel = spellcasting.reduce(
    (sum, [name, level]) =>
      sum + (classRules[name].caster === 'half' ? Math.ceil(level / 2) : level),
    0,
  );
  // A lone half-caster uses its own table (levels 1–2 have two slots, not three).
  const single = spellcasting.length === 1 ? spellcasting[0] : undefined;
  const slotLevel =
    single && classRules[single[0]].caster === 'half' ? Math.ceil(single[1] / 2) : casterLevel;
  const slots = Array.from({ length: 9 }, (_, i) => spellSlotTable[slotLevel]?.[i] ?? 0);
  if (single && classRules[single[0]].caster === 'half') {
    // SRD pp.53/58: use imported class slot columns exactly.
    const name = single[0],
      level = single[1];
    const row = progressionRow(name, level);
    const offset = 2;
    for (let i = 0; i < 9; i++) slots[i] = Number(row[offset + i] ?? 0);
  }
  const warlock = counts.Warlock ?? 0;
  const pact = {
    count: warlock ? (warlock >= 17 ? 4 : warlock >= 11 ? 3 : warlock >= 2 ? 2 : 1) : 0,
    level: warlock ? Math.min(5, Math.ceil(warlock / 2)) : 0,
  };
  const hitDice: Record<number, number> = {};
  for (const [name, level] of Object.entries(counts) as [SrdClass, number][])
    hitDice[classRules[name].die] = (hitDice[classRules[name].die] ?? 0) + level;
  const hp =
    state.levels.reduce((sum, step) => sum + Math.max(1, step.hp + mods[2]), 0) +
    (state.species === 'Dwarf' ? total : 0) +
    ((counts.Sorcerer ?? 0) >= 3 ? counts.Sorcerer! : 0);
  const barbarian = counts.Barbarian ?? 0,
    monk = counts.Monk ?? 0,
    ranger = counts.Ranger ?? 0;
  const fighter = counts.Fighter ?? 0;
  const attacks =
    fighter >= 20
      ? 4
      : fighter >= 11
        ? 3
        : ['Barbarian', 'Fighter', 'Monk', 'Paladin', 'Ranger'].some(
              (name) => (counts[name as SrdClass] ?? 0) >= 5,
            )
          ? 2
          : 1;
  const warlockStep = state.levels.findLast((step) => step.className === 'Warlock');
  const hasInvocation = (name: string) =>
    warlockStep?.options.some((id) => srdById.get(id)?.name === name);
  const pactAttacks = hasInvocation('Devouring Blade')
    ? Math.max(attacks, 3)
    : hasInvocation('Thirsting Blade')
      ? Math.max(attacks, 2)
      : attacks;
  const acOptions = [{ name: 'Unarmored', ac: 10 + mods[1] }];
  if (barbarian)
    acOptions.push({
      name: 'Barbarian Unarmored Defense (Shield permitted)',
      ac: 10 + mods[1] + mods[2],
    });
  if (monk)
    acOptions.push({ name: 'Monk Unarmored Defense (no Shield)', ac: 10 + mods[1] + mods[4] });
  if ((counts.Sorcerer ?? 0) >= 3)
    acOptions.push({ name: 'Draconic Resilience', ac: 10 + mods[1] + mods[5] });
  const skillBonuses: Record<string, number> = {};
  for (const step of state.levels) {
    const bonus = Math.max(1, mods[4]);
    const names = step.choices['divine-order']?.includes('Thaumaturge')
      ? ['Arcana', 'Religion']
      : step.choices['primal-order']?.includes('Magician')
        ? ['Arcana', 'Nature']
        : [];
    for (const name of names) skillBonuses[name] = (skillBonuses[name] ?? 0) + bonus;
  }
  const baseSpeed = state.species === 'Goliath' || state.lineage === 'Wood Elf' ? 35 : 30;
  return {
    total,
    counts,
    scores,
    mods,
    pb: 2 + Math.floor((total - 1) / 4),
    casterLevel,
    slots,
    pact,
    hp,
    hitDice,
    attacks,
    pactAttacks,
    acOptions,
    skillBonuses,
    speed: baseSpeed,
    unarmoredSpeed: baseSpeed + (monk >= 2 ? 10 + 5 * Math.floor((monk - 2) / 4) : 0),
    nonHeavySpeed: baseSpeed + (barbarian >= 5 ? 10 : 0) + (ranger >= 6 ? 10 : 0),
    dragonBreathDice: total >= 17 ? 4 : total >= 11 ? 3 : total >= 5 ? 2 : 1,
  };
}
import { progressions } from './srd-rules';
function progressionRow(name: SrdClass, level: number) {
  return progressions[name].rows[level - 1].values;
}

function grantedEntries(state: SrdBuilderState): SrdEntry[] {
  const entries = [srdEntry('species', state.species), srdEntry('background', state.background)];
  const levels: Partial<Record<SrdClass, number>> = {};
  const latest = new Map<SrdClass, (typeof state.levels)[number]>();
  for (const step of state.levels) {
    const level = (levels[step.className] = (levels[step.className] ?? 0) + 1);
    latest.set(step.className, step);
    if (level === 1) entries.push(srdEntry('class', step.className));
    entries.push(...featuresAt(step.className, level));
    if (level === 3)
      entries.push(
        srdCatalog.find((e) => e.category === 'subclass' && e.className === step.className),
      );
    if (step.feat) entries.push(srdById.get(step.feat.id));
    for (const name of step.choices['fighting-style'] ?? []) entries.push(srdEntry('feat', name));
  }
  for (const step of latest.values()) {
    entries.push(...step.options.map((id) => srdById.get(id)));
    entries.push(...step.invocationFeats.map((feat) => srdById.get(feat.id)));
  }
  if (state.originFeat) entries.push(srdById.get(state.originFeat.id));
  if (state.humanFeat) entries.push(srdById.get(state.humanFeat.id));
  return [
    ...new Map(
      entries.filter((entry): entry is SrdEntry => !!entry).map((entry) => [entry.id, entry]),
    ).values(),
  ];
}
/** Stable builder-owned IDs are separate from user-created UUIDs. */
const managedId = (id: string) => dndId(`srd:${id}`);
function speciesSpells(state: SrdBuilderState) {
  return speciesSpellIds(state)
    .map((id) => srdById.get(id))
    .filter((entry): entry is SrdEntry => !!entry);
}
function generatedDetails(state: SrdBuilderState): CharacterDetails {
  const details = emptyCharacterDetails();
  details.features = grantedEntries(state).map((entry) => ({
    id: managedId(entry.id),
    name: entry.name.replace(/^Level \d+: /, '').slice(0, 80),
    description: srdExcerpt(entry),
    actionType: 'Passive',
    source:
      entry.category === 'species'
        ? 'Species'
        : entry.category === 'background'
          ? 'Background'
          : entry.category === 'feat'
            ? 'Feat'
            : 'Class',
    uses: 0,
    maxUses: 0,
  }));
  const languages = new Set(['Common', ...state.languages]);
  const tools = new Set(state.tools);
  if (['Acolyte', 'Sage'].includes(state.background)) tools.add('Calligrapher’s Supplies');
  if (state.background === 'Criminal') tools.add('Thieves’ Tools');
  const training: string[] = [];
  const armor: Record<SrdClass, [string, string]> = {
    Barbarian: ['Light/Medium armor, Shields; Simple/Martial weapons', 'Shields; Martial weapons'],
    Bard: ['Light armor; Simple weapons', 'Light armor'],
    Cleric: ['Light/Medium armor, Shields; Simple weapons', 'Light/Medium armor, Shields'],
    Druid: ['Light armor, Shields; Simple weapons', 'Light armor, Shields'],
    Fighter: [
      'Light/Medium/Heavy armor, Shields; Simple/Martial weapons',
      'Light/Medium armor, Shields; Martial weapons',
    ],
    Monk: ['Simple weapons, Light Martial weapons', 'No additional armor/weapon proficiencies'],
    Paladin: [
      'Light/Medium/Heavy armor, Shields; Simple/Martial weapons',
      'Light/Medium armor, Shields; Martial weapons',
    ],
    Ranger: [
      'Light/Medium armor, Shields; Simple/Martial weapons',
      'Light/Medium armor, Shields; Martial weapons',
    ],
    Rogue: ['Light armor; Simple weapons, Finesse/Light Martial weapons', 'Light armor'],
    Sorcerer: ['Simple weapons', 'No additional armor/weapon proficiencies'],
    Warlock: ['Light armor; Simple weapons', 'Light armor'],
    Wizard: ['Simple weapons', 'No additional armor/weapon proficiencies'],
  };
  const seen = new Set<SrdClass>();
  state.levels.forEach((step, index) => {
    if (!seen.has(step.className)) {
      training.push(
        `${step.className} (${index === 0 ? 'initial' : 'multiclass'}): ${armor[step.className][index === 0 ? 0 : 1]}.`,
      );
      if (step.className === 'Rogue') tools.add('Thieves’ Tools');
      if (step.className === 'Druid' && index === 0) tools.add('Herbalism Kit');
      seen.add(step.className);
    }
    if (step.className === 'Druid') languages.add('Druidic');
    if (step.className === 'Rogue') languages.add('Thieves’ Cant');
    for (const name of [
      ...(step.choices['instruments'] ?? []),
      ...(step.choices['monk-tool'] ?? []),
    ])
      tools.add(name);
    for (const name of [
      ...(step.choices['deft-languages'] ?? []),
      ...(step.choices['thieves-language'] ?? []),
    ])
      languages.add(name);
    if (step.choices['divine-order']?.includes('Protector'))
      training.push('Divine Order Protector: Heavy armor and Martial weapons.');
    if (step.choices['primal-order']?.includes('Warden'))
      training.push('Primal Order Warden: Medium armor and Martial weapons.');
    step.feat?.skills
      .filter((name) => !skills.some(([skill]) => skill === name))
      .forEach((name) => tools.add(name));
  });
  for (const feat of [state.originFeat, state.humanFeat])
    feat?.skills
      .filter((name) => !skills.some(([skill]) => skill === name))
      .forEach((name) => tools.add(name));
  details.features.push({
    id: managedId('proficiency-summary'),
    name: 'SRD proficiencies & languages',
    description: `${training.join('\n')}\nTools: ${[...tools].join(', ') || 'none'}.\nLanguages: ${[...languages].join(', ')}.\nIndividual source classes and backgrounds are in the SRD catalog.`,
    source: 'Other',
    actionType: 'Passive',
    uses: 0,
    maxUses: 0,
  });
  const latest = new Map<SrdClass, (typeof state.levels)[number]>();
  for (const step of state.levels) latest.set(step.className, step);
  const spellMap = new Map<string, { entry: SrdEntry; prepared: boolean; sources: string[] }>();
  const add = (id: string, prepared: boolean, source: string) => {
    const entry = srdById.get(id);
    if (entry?.category !== 'spell') return;
    const existing = spellMap.get(id);
    spellMap.set(id, {
      entry,
      prepared: prepared || (existing?.prepared ?? false),
      sources: [...(existing?.sources ?? []), source],
    });
  };
  for (const [name, step] of latest) {
    for (const id of [...step.cantrips, ...step.spells, ...step.spellbook])
      add(id, step.cantrips.includes(id) || step.spells.includes(id), name);
    const level = state.levels.filter((s) => s.className === name).length;
    const land = state.levels.findLast((s) => s.className === 'Druid' && s.choices.land)?.choices
      .land?.[0];
    for (const spellName of alwaysPrepared(name, level, land)) {
      const entry = srdEntry('spell', spellName);
      if (entry) add(entry.id, true, `${name} always prepared`);
    }
    for (const feat of step.invocationFeats)
      for (const id of feat.spells) add(id, true, 'Lessons of the First Ones');
    for (const id of step.choices['magical-discoveries'] ?? [])
      add(id, true, 'Magical Discoveries');
    const invocationSpells: Record<string, string> = {
      'Armor of Shadows': 'Mage Armor',
      'Ascendant Step': 'Levitate',
      'Fiendish Vigor': 'False Life',
      'Gift of the Depths': 'Water Breathing',
      'Mask of Many Faces': 'Disguise Self',
      'Master of Myriad Forms': 'Alter Self',
      'Misty Visions': 'Silent Image',
      'One with Shadows': 'Invisibility',
      'Otherworldly Leap': 'Jump',
      'Pact of the Chain': 'Find Familiar',
      'Visions of Distant Realms': 'Arcane Eye',
      'Whispers of the Grave': 'Speak with Dead',
    };
    for (const option of step.options) {
      const optionName = srdById.get(option)?.name ?? '';
      if (optionName === 'Pact of the Tome')
        for (const id of step.choices[option] ?? []) add(id, true, 'Pact of the Tome');
      const spell = srdEntry('spell', invocationSpells[optionName]);
      if (spell)
        add(spell.id, true, `Invocation: ${optionName} (see invocation’s free-casting rules)`);
    }
  }
  for (const feat of [
    state.originFeat,
    state.humanFeat,
    ...state.levels.map((step) => step.feat),
  ]) {
    for (const id of feat?.spells ?? []) add(id, true, 'Magic Initiate');
  }
  for (const entry of speciesSpells(state))
    add(entry.id, true, `${state.species} (${state.lineage})`);
  for (const step of state.levels) {
    for (const id of step.choices['mystic-arcanum'] ?? [])
      add(id, true, 'Mystic Arcanum (1/Long Rest; no slot)');
    for (const id of step.choices['warrior-cantrips'] ?? [])
      add(id, true, 'Fighting Style cantrips');
    for (const id of step.choices['spell-mastery'] ?? [])
      add(id, true, 'Spell Mastery (at will at lowest level)');
    for (const id of step.choices['signature-spells'] ?? [])
      add(id, true, 'Signature Spells (one free cast per Short/Long Rest)');
  }
  const castingSources = srdCastingSources(state);
  const druid = latest.get('Druid');
  if (druid && state.levels.filter((step) => step.className === 'Druid').length >= 2)
    add(
      srdEntry('spell', 'Find Familiar')!.id,
      true,
      'Wild Companion (Fey; requires a slot or Wild Shape use; ends on Long Rest)',
    );
  const companions = state.companions ?? defaultCompanions();
  const references = (druid?.choices['wild-shape-forms'] ?? []).map((id) => ({
    id,
    kind: 'Wild Shape',
  }));
  if (companions.familiarMode !== 'none')
    references.push({ id: companions.familiarForm, kind: 'Familiar preset' });
  for (const reference of references) {
    const shape = shapeById.get(reference.id);
    if (!shape) continue;
    const entry: SrdEntry = { ...shape, category: 'form' };
    details.features.push({
      id: managedId(`${reference.kind}:${shape.id}`),
      name: `${reference.kind} · ${shape.name}`.slice(0, 80),
      description: `Selected ${reference.kind === 'Wild Shape' ? 'known form (not currently transformed)' : `${companions.familiarType} form from ${companions.familiarMode}; not automatically summoned`}. CR ${shape.crLabel}${shape.fly ? '; has Fly Speed' : ''}.\n\n${srdExcerpt(entry, 3650)}`,
      source: reference.kind === 'Wild Shape' ? 'Class' : 'Other',
      actionType: 'Other',
      uses: 0,
      maxUses: 0,
    });
  }
  if (companions.steedAppearance && companionCapabilities(state).steed) {
    details.features.push({
      id: managedId('steed-preset'),
      name: `Steed preset · ${companions.steedAppearance}`.slice(0, 80),
      description: `${companions.steedType}; appearance ${companions.steedAppearance}. Uses the spell's Otherworldly Steed stat block, not the appearance animal's statistics. Preset only: not summoned, no slot/resource consumed.\n\n${srdExcerpt(srdEntry('spell', 'Find Steed')!, 3500)}`,
      source: 'Class',
      actionType: 'Other',
      uses: 0,
      maxUses: 0,
    });
  }
  if ((companions.pactWeapon || companions.pactOwnedId) && companionCapabilities(state).blade)
    details.features.push({
      id: managedId('pact-weapon-preset'),
      name: `Pact weapon · ${companions.pactWeapon || 'owned magic weapon'}`,
      description: `${companions.pactActive ? 'ACTIVE bond; ready-attack configuration applies proficiency, chosen ability and damage type.' : 'INACTIVE desired profile only; no weapon is conjured or altered.'} ${companions.pactWeapon || companions.pactOwnedId}; ${companions.pactDamage} damage option; ${companions.pactCharisma ? 'Charisma' : 'ordinary weapon ability'}. Conjuration uses a separate builder-owned item; an owned magic weapon's inventory entry is never converted or deleted. This records configuration, not encounter action usage.\n\n${srdExcerpt(srdEntry('option', 'Pact of the Blade')!, 3000)}`,
      source: 'Class',
      actionType: 'Other',
      uses: 0,
      maxUses: 0,
    });
  details.spells = [...spellMap.values()].map(({ entry, prepared, sources }) => ({
    id: managedId(entry.id),
    name: entry.name.slice(0, 80),
    description: `${srdExcerpt(entry, 3700)}\n\nSource(s): ${[...new Set(sources)].join(', ')}.`,
    level: entry.level ?? 0,
    prepared,
    casting: castingSources
      .filter((source) => source.spells.includes(entry.id))
      .map((source) => ({ sourceId: source.id, ability: source.ability, label: source.label })),
    actionType: /Casting Time: Bonus Action/.test(entry.text)
      ? 'Bonus action'
      : /Casting Time: Reaction/.test(entry.text)
        ? 'Reaction'
        : 'Action',
  }));
  details.items = startingInventory(state);
  return details;
}

function resource(key: string, label: string, max: number): Field {
  return { id: dndId(key), label, kind: 'resource', value: max, max };
}
function builderResources(state: SrdBuilderState): Field[] {
  const derived = deriveSrd(state),
    fields: Field[] = [];
  for (const [die, count] of Object.entries(derived.hitDice))
    fields.push(resource(`srd-resource:hit-die:${die}`, `Hit Dice d${die}`, count));
  if (derived.pact.count)
    fields.push(
      resource(
        'srd-resource:pact',
        `Pact slots · level ${derived.pact.level} (Short Rest)`,
        derived.pact.count,
      ),
    );
  const c = derived.counts,
    pb = derived.pb;
  for (const source of srdCastingSources(state).filter(
    (source) => !source.id.startsWith('class:'),
  )) {
    fields.push({
      id: dndId(source.dcKey),
      label: `${source.label} DC (${abilityNames[source.ability]})`.slice(0, 80),
      kind: 'number',
      value: 8 + pb + derived.mods[source.ability],
    });
    fields.push({
      id: dndId(source.attackKey),
      label: `${source.label} base spell attack`.slice(0, 80),
      kind: 'number',
      value: pb + derived.mods[source.ability],
    });
  }
  fields.push({
    id: dndId('srd-resource:attacks'),
    label: 'Attacks per Attack action (not stacking)',
    kind: 'number',
    value: derived.attacks,
  });
  if (derived.pactAttacks !== derived.attacks)
    fields.push({
      id: dndId('srd-resource:pact-attacks'),
      label: 'Attacks with pact weapon',
      kind: 'number',
      value: derived.pactAttacks,
    });
  for (const name of Object.keys(c) as SrdClass[]) {
    const ability = classRules[name].spellAbility;
    if (ability === undefined) continue;
    fields.push({
      id: dndId(`srd-resource:spell-dc:${name}`),
      label: `${name} DC (${abilityNames[ability]})`,
      kind: 'number',
      value: 8 + pb + derived.mods[ability],
    });
    fields.push({
      id: dndId(`srd-resource:spell-attack:${name}`),
      label: `${name} base spell attack`,
      kind: 'number',
      value: pb + derived.mods[ability],
    });
  }
  const add = (key: string, label: string, max: number) => {
    if (max) fields.push(resource(`srd-resource:${key}`, label, max));
  };
  add('rage', 'Rages', c.Barbarian ? Number(progressionRow('Barbarian', c.Barbarian)[0]) : 0);
  add('focus', 'Focus Points', (c.Monk ?? 0) >= 2 ? c.Monk! : 0);
  add('sorcery', 'Sorcery Points', (c.Sorcerer ?? 0) >= 2 ? c.Sorcerer! : 0);
  add('lay-on-hands', 'Lay On Hands', (c.Paladin ?? 0) * 5);
  add('bardic-inspiration', 'Bardic Inspiration', c.Bard ? Math.max(1, derived.mods[5]) : 0);
  add(
    'second-wind',
    'Second Wind',
    c.Fighter ? Number(progressionRow('Fighter', c.Fighter)[0]) : 0,
  );
  add(
    'channel-divinity',
    'Cleric Channel Divinity',
    (c.Cleric ?? 0) >= 2 ? Number(progressionRow('Cleric', c.Cleric!)[0]) : 0,
  );
  add(
    'paladin-channel',
    'Paladin Channel Divinity',
    (c.Paladin ?? 0) >= 3 ? Number(progressionRow('Paladin', c.Paladin!)[0]) : 0,
  );
  add(
    'wild-shape',
    'Wild Shape',
    (c.Druid ?? 0) >= 2 ? Number(progressionRow('Druid', c.Druid!)[0]) : 0,
  );
  add(
    'hunters-mark',
    'Hunter’s Mark (free casts)',
    c.Ranger ? Number(progressionRow('Ranger', c.Ranger)[0]) : 0,
  );
  add('action-surge', 'Action Surge', (c.Fighter ?? 0) >= 2 ? (c.Fighter! >= 17 ? 2 : 1) : 0);
  add(
    'indomitable',
    'Indomitable',
    (c.Fighter ?? 0) >= 9 ? (c.Fighter! >= 17 ? 3 : c.Fighter! >= 13 ? 2 : 1) : 0,
  );
  add('innate-sorcery', 'Innate Sorcery', c.Sorcerer ? 2 : 0);
  add('arcane-recovery', 'Arcane Recovery (uses, not slot levels)', c.Wizard ? 1 : 0);
  add('magical-cunning', 'Magical Cunning', (c.Warlock ?? 0) >= 2 ? 1 : 0);
  add('natural-recovery', 'Natural Recovery', (c.Druid ?? 0) >= 6 ? 1 : 0);
  add('divine-intervention', 'Divine Intervention', (c.Cleric ?? 0) >= 10 ? 1 : 0);
  add(
    'wholeness-of-body',
    'Wholeness of Body',
    (c.Monk ?? 0) >= 6 ? Math.max(1, derived.mods[4]) : 0,
  );
  add('stroke-of-luck', 'Stroke of Luck', c.Rogue === 20 ? 1 : 0);
  add('uncanny-metabolism', 'Uncanny Metabolism', (c.Monk ?? 0) >= 2 ? 1 : 0);
  add(
    'intimidating-presence',
    'Intimidating Presence (free use)',
    (c.Barbarian ?? 0) >= 14 ? 1 : 0,
  );
  add('faithful-steed', 'Faithful Steed (free Find Steed)', (c.Paladin ?? 0) >= 5 ? 1 : 0);
  add('holy-nimbus', 'Holy Nimbus (free use)', c.Paladin === 20 ? 1 : 0);
  add('wild-resurgence', 'Wild Resurgence (slot recovery)', (c.Druid ?? 0) >= 5 ? 1 : 0);
  add('nature-magician', 'Nature Magician (slot conversion)', c.Druid === 20 ? 1 : 0);
  add('dragon-wings', 'Dragon Wings (free use)', (c.Sorcerer ?? 0) >= 14 ? 1 : 0);
  add('dragon-companion', 'Dragon Companion (free Summon Dragon)', (c.Sorcerer ?? 0) >= 18 ? 1 : 0);
  add(
    'dark-ones-luck',
    'Dark One’s Own Luck',
    (c.Warlock ?? 0) >= 6 ? Math.max(1, derived.mods[5]) : 0,
  );
  add('contact-patron', 'Contact Patron (free Contact Other Plane)', (c.Warlock ?? 0) >= 9 ? 1 : 0);
  add('hurl-through-hell', 'Hurl Through Hell (free use)', (c.Warlock ?? 0) >= 14 ? 1 : 0);
  if (state.species === 'Orc') add('relentless-endurance', 'Relentless Endurance', 1);
  if (state.lineage === 'Forest Gnome')
    add('speak-with-animals', 'Speak with Animals (species free casts)', pb);
  if (['Elf', 'Tiefling'].includes(state.species)) {
    if (derived.total >= 3) add('species-spell-3', `${state.lineage} level 3 spell (free cast)`, 1);
    if (derived.total >= 5) add('species-spell-5', `${state.lineage} level 5 spell (free cast)`, 1);
  }
  const latest = new Map<SrdClass, (typeof state.levels)[number]>();
  state.levels.forEach((step) => latest.set(step.className, step));
  const feats = [
    state.originFeat,
    state.humanFeat,
    ...state.levels.map((step) => step.feat),
    ...[...latest.values()].flatMap((step) => step.invocationFeats),
  ];
  for (const feat of feats)
    if (srdById.get(feat?.id ?? '')?.name === 'Magic Initiate')
      add(`magic-initiate:${feat!.spellList}`, `Magic Initiate (${feat!.spellList}) free cast`, 1);
  if (feats.some((feat) => srdById.get(feat?.id ?? '')?.name === 'Boon of Fate'))
    add('boon-of-fate', 'Boon of Fate', 1);
  if (
    [...latest.values()].some((step) =>
      step.options.some((id) => srdById.get(id)?.name === 'Gift of the Depths'),
    )
  )
    add('gift-of-depths', 'Gift of the Depths (Water Breathing)', 1);
  for (const [at, spellLevel] of [
    [11, 6],
    [13, 7],
    [15, 8],
    [17, 9],
  ])
    if ((c.Warlock ?? 0) >= at)
      add(`arcanum:${spellLevel}`, `Mystic Arcanum level ${spellLevel}`, 1);
  if (['Dragonborn', 'Dwarf', 'Goliath', 'Orc'].includes(state.species))
    add(
      'species',
      {
        Dragonborn: 'Breath Weapon',
        Dwarf: 'Stonecunning',
        Goliath: `${state.lineage} ancestry`,
        Orc: 'Adrenaline Rush',
      }[state.species as 'Dragonborn' | 'Dwarf' | 'Goliath' | 'Orc'],
      pb,
    );
  if (state.species === 'Dragonborn')
    fields.push({
      id: dndId('srd-resource:breath-dc'),
      label: 'Breath Weapon save DC (Constitution)',
      kind: 'number',
      value: 8 + pb + derived.mods[2],
    });
  if (state.species === 'Dragonborn' && derived.total >= 5)
    add('draconic-flight', 'Draconic Flight', 1);
  if (state.species === 'Goliath' && derived.total >= 5) add('large-form', 'Large Form', 1);
  for (const step of state.levels)
    for (const id of step.choices['signature-spells'] ?? [])
      add(`signature:${id}`, `Signature: ${srdById.get(id)?.name}`, 1);
  return fields;
}
function skillProficiencies(state: SrdBuilderState) {
  const trained = new Set<string>(backgrounds[state.background].skills),
    expert = new Set<string>();
  if (state.speciesSkill) trained.add(state.speciesSkill);
  state.replacementSkills.forEach((skill) => trained.add(skill));
  const latest = new Map<SrdClass, (typeof state.levels)[number]>();
  for (const step of state.levels) {
    latest.set(step.className, step);
    [...step.skills, ...step.replacementSkills].forEach((skill) => trained.add(skill));
    step.expertise.forEach((skill) => expert.add(skill));
  }
  for (const feat of [
    state.originFeat,
    state.humanFeat,
    ...state.levels.map((step) => step.feat),
    ...[...latest.values()].flatMap((step) => step.invocationFeats),
  ])
    feat?.skills.forEach((skill) => trained.add(skill));
  const bard = (classLevels(state.levels).Bard ?? 0) >= 2;
  return new Map(
    skills.map(([name]) => [name, trained.has(name) ? (expert.has(name) ? 2 : 1) : bard ? 0.5 : 0]),
  );
}
/** Apply only after validation. Pure: caller's saved sheet and draft are never mutated. */
export function applySrdBuilder(sheet: Sheet, input: SrdBuilderState): Sheet {
  const state = srdBuilderSchema.parse(input);
  const result = structuredClone(sheet);
  const old = result.character?.builder;
  const adopting = !old && isLegacySrdCharacter(sheet);
  if (old) {
    const transition = srdTransitionErrors(old, state);
    if (transition.length) throw new Error(transition.join(' '));
  }
  const derived = deriveSrd(state),
    previous = old ? deriveSrd(old) : undefined;
  const fields = new Map(
    result.sections.flatMap((section) => section.fields).map((field) => [field.id, field]),
  );
  const set = (key: string, value: string | number) => {
    const field = fields.get(dndId(key));
    if (!field) throw new Error('SRD builder requires the built-in D&D sheet.');
    field.value = value;
  };
  const setResource = (key: string, max: number, oldComputed?: number) => {
    const field = fields.get(dndId(key));
    if (!field) throw new Error(`Missing ${key}.`);
    const target =
      old && oldComputed !== undefined
        ? Math.max(0, (field.max ?? oldComputed) + max - oldComputed)
        : max;
    const spent = Math.max(0, (field.max ?? 0) - Number(field.value));
    field.max = target;
    field.value = Math.max(0, target - spent);
  };
  set('level', derived.total);
  set('pb', derived.pb);
  set(
    'class',
    Object.entries(derived.counts)
      .map(
        ([name, level]) =>
          `${name} ${level}${level! >= 3 ? ` (${srdCatalog.find((e) => e.category === 'subclass' && e.className === name)?.name})` : ''}`,
      )
      .join(' / '),
  );
  set('species', `${state.species}${state.lineage ? ` (${state.lineage})` : ''}`);
  set('background', state.background);
  if (!old || state.alignment !== old.alignment) set('alignment', state.alignment);
  derived.scores.forEach((score, i) => set(`score:${i}`, score));
  if (!adopting) setResource('hp', derived.hp, previous?.hp);
  setResource('hit-dice', derived.total, previous?.total);
  derived.slots.forEach((max, i) => setResource(`slot:${i}`, max, previous?.slots[i]));
  const sources = srdCastingSources(state),
    previousSources = old ? srdCastingSources(old) : [];
  if (
    sources.length &&
    previousSources.length === 0 &&
    Number(fields.get(dndId('spell-ability'))?.value) === 3
  )
    set('spell-ability', sources[0].ability);
  if (!old) {
    for (const ability of classRules[state.levels[0].className].saves)
      set(`save-prof:${ability}`, 1);
  }
  if ((derived.counts.Monk ?? 0) >= 14) for (let i = 0; i < 6; i++) set(`save-prof:${i}`, 1);
  if ((derived.counts.Rogue ?? 0) >= 15) for (const i of [4, 5]) set(`save-prof:${i}`, 1);
  const skillValues = skillProficiencies(state),
    previousSkills = old ? skillProficiencies(old) : undefined;
  skills.forEach(([name], i) => {
    const value = skillValues.get(name) ?? 0,
      existing = Number(fields.get(dndId(`skill-prof:${i}`))?.value ?? 0);
    set(
      `skill-prof:${i}`,
      previousSkills?.get(name) === existing ? value : Math.max(existing, value),
    );
    const extra = fields.get(dndId(`skill-extra:${i}`));
    if (extra)
      extra.value =
        Number(extra.value) +
        (derived.skillBonuses[name] ?? 0) -
        (previous?.skillBonuses[name] ?? 0);
  });
  const oldGenerated = old ? generatedDetails(old) : emptyCharacterDetails();
  const generated = generatedDetails(state),
    details = result.character ?? emptyCharacterDetails();
  const merge = <T extends { id: string }>(existing: T[], prior: T[], next: T[]) => {
    const owned = new Set(prior.map((entry) => entry.id));
    if (adopting) next.forEach((entry) => owned.add(entry.id));
    const userEntries = existing.filter((entry) => !owned.has(entry.id));
    // An identical manual name remains a separate entry; manual data is never overwritten.
    if (userEntries.length + next.length > 200)
      throw new Error('Applying builder would exceed 200 entries; archive manual entries first.');
    const merged = next.map((entry) => {
      const current = existing.find((value) => value.id === entry.id),
        original = prior.find((value) => value.id === entry.id) ?? (adopting ? entry : undefined);
      if (!current || !original) return entry;
      const result = { ...entry };
      // Generated entries can still be annotated/customized in the normal sheet.
      // Preserve those deliberate edits, especially spent feature counters.
      for (const key of ['name', 'description', 'actionType', 'prepared', 'uses', 'maxUses']) {
        if (
          key in current &&
          JSON.stringify(current[key as keyof T]) !== JSON.stringify(original[key as keyof T])
        )
          Object.assign(result, { [key]: current[key as keyof T] });
      }
      return result;
    });
    return [...userEntries, ...merged];
  };
  details.features = merge(details.features, oldGenerated.features, generated.features);
  details.spells = merge(details.spells, oldGenerated.spells, generated.spells);
  if (adopting) {
    const generatedIds = new Set(generated.spells.map((spell) => spell.id));
    for (const spell of details.spells) if (!generatedIds.has(spell.id)) delete spell.casting;
  }
  // Starting bundles are created once, never replenished or replaced on level-up.
  if (!old) details.items = merge(details.items, [], generated.items);
  if (
    old &&
    !previous?.counts.Wizard &&
    derived.counts.Wizard &&
    !details.items.some((item) => item.name === 'Spellbook' && item.quantity > 0)
  ) {
    if (details.items.length >= 200)
      throw new Error('No inventory capacity for the new Wizard Spellcasting spellbook.');
    details.items.push({
      id: managedId('feature-item:spellbook'),
      name: 'Spellbook',
      quantity: 1,
      rarity: 'Common',
      requiresAttunement: false,
      attuned: false,
      description:
        'Starting Wizard Spellcasting spellbook containing the six chosen level-1 spells. Granted once when first acquiring that feature; no starting-equipment package is granted on multiclassing. Later level-ups never replenish a lost/destroyed book; copying/replacement costs remain manual.',
    });
  }
  if (old && state.equipment.expandLegacyBundles) {
    const bundles = details.items.filter(isLegacyStartingBundle);
    if (!bundles.length) throw new Error('No positive-quantity legacy starting bundles to expand.');
    if (bundles.some((item) => item.quantity !== 1))
      throw new Error(
        'Legacy expansion requires untouched quantity-one bundles; edited bundle quantities must be reconciled manually.',
      );
    if (generated.items.some((item) => details.items.some((existing) => existing.id === item.id)))
      throw new Error('Starting equipment is already expanded; do not grant it twice.');
    details.items = merge(details.items, [], generated.items);
    for (const item of bundles) item.quantity = 0;
    state.equipment.expandLegacyBundles = false;
  }
  const conjured = conjuredPactItem(state),
    previousConjured = old && conjuredPactItem(old);
  const conjuredEntry = details.items.find((item) => item.id === pactConjuredId);
  if (conjured) {
    if (conjuredEntry) {
      if (!previousConjured && !conjuredEntry.name.endsWith('(Conjured Pact)'))
        throw new Error(
          'A manual item conflicts with the reserved Pact item identifier; it was not overwritten.',
        );
      if (
        conjuredEntry.name === previousConjured?.name ||
        (!previousConjured && conjuredEntry.name.endsWith('(Conjured Pact)'))
      )
        conjuredEntry.name = conjured.name;
      if (conjuredEntry.description === previousConjured?.description)
        conjuredEntry.description = conjured.description;
      conjuredEntry.quantity = 1;
    } else {
      if (details.items.length >= 200)
        throw new Error('No inventory capacity for the one conjured Pact weapon.');
      details.items.push(conjured);
    }
  } else if (conjuredEntry && previousConjured) conjuredEntry.quantity = 0; // preserve archived annotations; never touch manual weapons
  const equipment = deriveEquipment(state, details.items, derived.scores);
  if (equipment.errors.length) throw new Error(equipment.errors.join(' '));
  if (state.equipment.acMode !== 'manual' && equipment.ac !== undefined) {
    const oldBase =
      old?.equipment?.appliedAC ?? Number(fields.get(dndId('ac'))?.value ?? equipment.ac);
    set('ac', equipment.ac + (old ? Number(fields.get(dndId('ac'))?.value) - oldBase : 0));
    const oldSpeed =
      old?.equipment?.appliedSpeed ?? Number(fields.get(dndId('speed'))?.value ?? equipment.speed);
    set(
      'speed',
      equipment.speed + (old ? Number(fields.get(dndId('speed'))?.value) - oldSpeed : 0),
    );
    state.equipment.appliedAC = equipment.ac;
    state.equipment.appliedSpeed = equipment.speed;
  }
  const priorEquipment = old ? deriveEquipment(old, details.items, previous!.scores) : undefined;
  equipment.weapons.forEach((weapon, index) => {
    if (state.equipment.weaponIds[index] === '') return; // explicitly manual slot
    const oldDice = String(fields.get(dndId(`weapon-dice:${index}`))?.value ?? '1d8');
    const prior = priorEquipment?.weapons[index];
    const priorCompanion = { ...defaultCompanions(), ...old?.companions };
    const pactChanged =
      (state.companions.pactActive || priorCompanion.pactActive) &&
      JSON.stringify([
        state.companions.pactActive,
        state.companions.pactWeapon,
        state.companions.pactOwnedId,
        state.companions.pactCharisma,
        state.companions.pactDamage,
      ]) !==
        JSON.stringify([
          priorCompanion.pactActive,
          priorCompanion.pactWeapon,
          priorCompanion.pactOwnedId,
          priorCompanion.pactCharisma,
          priorCompanion.pactDamage,
        ]);
    const newPactId = state.companions.pactActive
      ? state.companions.pactOwnedId || pactConjuredId
      : '';
    const oldPactId = priorCompanion.pactActive ? priorCompanion.pactOwnedId || pactConjuredId : '';
    const pactAffected =
      state.equipment.weaponIds[index] === 'auto' ||
      old?.equipment?.weaponIds[index] === 'auto' ||
      weapon?.item.id === newPactId ||
      prior?.item.id === oldPactId;
    const changed =
      !old ||
      (pactChanged && pactAffected) ||
      (!weapon && state.equipment.weaponIds[index] === 'auto') ||
      state.equipment.weaponIds[index] !== old.equipment?.weaponIds[index] ||
      state.equipment.twoHanded[index] !== old.equipment?.twoHanded[index] ||
      state.equipment.weaponAbilities[index] !== old.equipment?.weaponAbilities[index];
    const replace = (
      key: string,
      value: string | number,
      previousValue: string | number | undefined,
    ) => {
      if (changed || fields.get(dndId(`${key}:${index}`))?.value === previousValue)
        set(`${key}:${index}`, value);
    };
    replace('weapon-name', weapon?.item.name ?? 'Unequipped', prior?.item.name);
    replace('weapon-ability', weapon?.ability ?? 0, prior?.ability);
    replace('weapon-prof', weapon?.proficient ? 1 : 0, prior?.proficient ? 1 : 0);
    replace('weapon-dice', weapon?.dice ?? '1d4', prior?.dice);
    replace('weapon-type', weapon?.damageType ?? '', prior?.damageType);
    replace('weapon-add', weapon ? 1 : 0, prior ? 1 : 0);
    for (const key of ['weapon-hit', 'weapon-damage']) {
      const current = Number(fields.get(dndId(`${key}:${index}`))?.value ?? 0);
      const nextBonus = key === 'weapon-hit' ? (weapon?.attackBonus ?? 0) : (weapon?.bonus ?? 0);
      const priorBonus =
        key === 'weapon-hit'
          ? (old?.equipment?.appliedWeaponBonuses?.[index] ?? prior?.attackBonus ?? 0)
          : (old?.equipment?.appliedDamageBonuses?.[index] ?? prior?.bonus ?? 0);
      set(`${key}:${index}`, current + nextBonus - priorBonus);
    }
    const section = result.sections.find((section) => section.id === dndId(`weapon:${index}`));
    if (
      section &&
      (section.title === `Attack ${index + 1}` ||
        section.title === `Attack ${index + 1} · ${prior?.item.name ?? 'Unequipped'}`)
    )
      section.title = `Attack ${index + 1} · ${weapon?.item.name ?? 'Unequipped'}`.slice(0, 80);
    for (const [key, critical] of [
      ['weapon-damage', false],
      ['weapon-critical', true],
    ] as const) {
      const ability = section?.abilities.find(
        (ability) => ability.id === dndId(`roll:${key}:${index}`),
      );
      if (ability && ability.expression === dndDamageExpression(oldDice, index, critical))
        ability.expression = dndDamageExpression(
          String(fields.get(dndId(`weapon-dice:${index}`))?.value),
          index,
          critical,
        );
    }
  });
  state.equipment.appliedWeaponBonuses = equipment.weapons.map(
    (weapon) => weapon?.attackBonus ?? 0,
  );
  state.equipment.appliedDamageBonuses = equipment.weapons.map((weapon) => weapon?.bonus ?? 0);
  details.builder = structuredClone(state);
  result.character = details;
  const sectionId = dndId('srd-resources');
  const oldResources = old ? builderResources(old) : [];
  const nextResources = builderResources(state).map((field) => {
    if (field.kind !== 'resource') return field;
    const existing = fields.get(field.id),
      prior = oldResources.find((entry) => entry.id === field.id);
    if (!existing || (!prior && !adopting)) return field;
    const max = prior ? Math.max(0, (existing.max ?? 0) + field.max! - prior.max!) : field.max!;
    return {
      ...field,
      max,
      value: Math.max(0, max - ((existing.max ?? 0) - Number(existing.value))),
    };
  });
  const oldIds = new Set(oldResources.map((field) => field.id));
  if (adopting) nextResources.forEach((field) => oldIds.add(field.id));
  const sections = [sectionId, dndId('srd-resources:1')];
  for (const section of result.sections.filter((entry) => sections.includes(entry.id)))
    section.fields = section.fields.filter((field) => !oldIds.has(field.id));
  let remaining = nextResources;
  for (const [index, id] of sections.entries()) {
    if (!remaining.length) break;
    let section = result.sections.find((entry) => entry.id === id);
    if (!section) {
      if (result.sections.length >= 20) throw new Error('No section capacity for SRD resources.');
      section = {
        id,
        title: `SRD · class resources & Hit Dice${index ? ' (continued)' : ''}`,
        fields: [],
        abilities: [],
      };
      result.sections.push(section);
    }
    const capacity = 40 - section.fields.length;
    section.fields.push(...remaining.slice(0, capacity));
    remaining = remaining.slice(capacity);
  }
  if (remaining.length) throw new Error('No field capacity for SRD resources.');
  return result;
}

export function validateSrdSheet(sheet: Sheet): string | undefined {
  const state = sheet.character?.builder;
  if (!state) return;
  const fields = new Map(
    sheet.sections.flatMap((section) => section.fields).map((field) => [field.id, field]),
  );
  if (fields.get(dndId('level'))?.value !== state.levels.length)
    return 'Builder character level must match its saved progression.';
  const scores = builderScores(state);
  if (scores.some((score, i) => fields.get(dndId(`score:${i}`))?.value !== score))
    return 'Ability scores must match builder decisions; detach builder for manual/homebrew changes.';
  const equipment = deriveEquipment(state, sheet.character?.items ?? [], scores);
  if (equipment.errors.length) return equipment.errors.join(' ');
  const sources = srdCastingSources(state);
  for (const spell of sheet.character?.spells ?? [])
    if (spell.casting) {
      if (new Set(spell.casting.map((source) => source.sourceId)).size !== spell.casting.length)
        return 'Duplicate spell casting sources.';
      for (const choice of spell.casting) {
        const source = sources.find((source) => source.id === choice.sourceId);
        if (
          !source ||
          source.ability !== choice.ability ||
          !source.spells.some((id) => managedId(id) === spell.id)
        )
          return 'Spell casting source/ability does not match builder decisions.';
      }
    }
}

export function srdTransitionErrors(old: SrdBuilderState, next: SrdBuilderState): string[] {
  const errors: string[] = [];
  const delta = next.levels.length - old.levels.length;
  if (delta < 0) return ['Progression cannot remove applied class levels.'];
  if (old.levels.some((step, i) => step.className !== next.levels[i]?.className))
    return ['Progression cannot change previously applied classes.'];
  if (delta === 0) return [];
  const pairs = [
    [old.originFeat, next.originFeat],
    [old.humanFeat, next.humanFeat],
    ...old.levels.map((level, index) => [level.feat, next.levels[index]?.feat]),
  ];
  for (const [before, after] of pairs) {
    if (!before && !after) continue;
    const magic = before && srdById.get(before.id)?.name === 'Magic Initiate';
    const identity = (feat: typeof before) =>
      !feat ? null : magic ? { ...feat, spells: [] } : feat;
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonical(entry)]),
            )
          : value;
    if (JSON.stringify(canonical(identity(before))) !== JSON.stringify(canonical(identity(after))))
      errors.push('Save corrections to existing feats before adding levels.');
    if (magic && after && after.spells.filter((id) => !before!.spells.includes(id)).length > delta)
      errors.push(
        `Magic Initiate may replace only one chosen spell per gained character level (${Math.max(0, delta)} available).`,
      );
  }
  return errors;
}
