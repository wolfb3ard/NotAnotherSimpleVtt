import { z } from 'zod';
import { srdById, srdCatalog, srdEntry } from './srd-catalog';
import { defaultEquipment, equipmentErrors, equipmentSchema } from './srd-equipment';
import {
  companionErrors,
  companionSchema,
  defaultCompanions,
  eligibleWildShapes,
  wildShapeLimits,
} from './srd-shapes';
import {
  allSkills,
  alwaysPrepared,
  artisanTools,
  backgrounds,
  classRules,
  classSpellLimits,
  featuresAt,
  gamingSets,
  instruments,
  lineages,
  rareLanguages,
  standardLanguages,
  toolNames,
  progressions,
  srdAlignments,
  srdBackgrounds,
  srdClasses,
  srdSpecies,
  type SrdClass,
} from './srd-rules';

const ids = z.array(z.string().min(1).max(120)).max(100);
const boosts = z.array(z.number().int().min(0).max(2)).length(6);
const featSchema = z
  .object({
    id: z.string().max(120),
    increases: boosts,
    skills: ids,
    spellList: z.enum(['Cleric', 'Druid', 'Wizard']).optional(),
    spellAbility: z.number().int().min(3).max(5).optional(),
    spells: ids,
  })
  .strict();
export type SrdFeatChoice = z.infer<typeof featSchema>;
const levelSchema = z
  .object({
    className: z.enum(srdClasses),
    hp: z.number().int().min(1).max(12),
    skills: ids,
    replacementSkills: ids,
    expertise: ids,
    cantrips: ids,
    spells: ids,
    spellbook: ids,
    options: ids,
    mastery: ids,
    invocationFeats: z.array(featSchema).max(10),
    feat: featSchema.optional(),
    // Additional feature decisions are kept by their source-feature ID.
    choices: z.record(z.string().max(120), ids),
  })
  .strict();
export type SrdLevelChoice = z.infer<typeof levelSchema>;
const stateShape = z
  .object({
    version: z.literal(1),
    source: z.literal('SRD-5.2.1'),
    alignment: z.enum(srdAlignments),
    abilityMethod: z.enum(['standard', 'point-buy', 'rolled']),
    baseScores: z.array(z.number().int().min(3).max(18)).length(6),
    rolls: z
      .array(z.array(z.number().int().min(1).max(6)).length(4))
      .length(6)
      .optional(),
    background: z.enum(srdBackgrounds),
    backgroundBoosts: boosts,
    backgroundEquipment: z.enum(['A', 'B']),
    classEquipment: z.enum(['A', 'B', 'C']),
    equipment: equipmentSchema.default(defaultEquipment),
    companions: companionSchema.default(defaultCompanions),
    species: z.enum(srdSpecies),
    lineage: z.string().max(40),
    size: z.enum(['Small', 'Medium']),
    speciesSpellAbility: z.number().int().min(3).max(5),
    speciesCantrip: z.string().max(120),
    speciesSkill: z.string().max(40),
    replacementSkills: ids,
    originFeat: featSchema.optional(),
    humanFeat: featSchema.optional(),
    languages: ids,
    tools: ids,
    levels: z.array(levelSchema).min(1).max(20),
  })
  .strict();
export type SrdBuilderState = z.infer<typeof stateShape>;

export function blankFeat(id = ''): SrdFeatChoice {
  return { id, increases: [0, 0, 0, 0, 0, 0], skills: [], spells: [] };
}
export function blankLevel(className: SrdClass): SrdLevelChoice {
  return {
    className,
    hp: classRules[className].die / 2 + 1,
    skills: [],
    replacementSkills: [],
    expertise: [],
    cantrips: [],
    spells: [],
    spellbook: [],
    options: [],
    mastery: [],
    invocationFeats: [],
    choices: {},
  };
}
export function newSrdState(): SrdBuilderState {
  return {
    version: 1,
    source: 'SRD-5.2.1',
    alignment: 'Neutral',
    abilityMethod: 'standard',
    baseScores: [15, 14, 13, 12, 10, 8],
    background: 'Soldier',
    backgroundBoosts: [2, 1, 0, 0, 0, 0],
    backgroundEquipment: 'A',
    classEquipment: 'A',
    equipment: defaultEquipment(),
    companions: defaultCompanions(),
    species: 'Human',
    lineage: '',
    size: 'Medium',
    speciesSpellAbility: 5,
    speciesCantrip: '',
    speciesSkill: '',
    replacementSkills: [],
    languages: [],
    tools: [],
    levels: [{ ...blankLevel('Fighter'), hp: 10 }],
  };
}
export function classLevels(levels: SrdLevelChoice[]) {
  const result: Partial<Record<SrdClass, number>> = {};
  for (const level of levels) result[level.className] = (result[level.className] ?? 0) + 1;
  return result;
}
export function builderScores(state: SrdBuilderState, through = state.levels.length): number[] {
  const scores = state.baseScores.map((score, i) => score + state.backgroundBoosts[i]);
  for (const step of state.levels.slice(0, through)) {
    step.feat?.increases.forEach((value, i) => {
      scores[i] += value;
    });
  }
  const levels = classLevels(state.levels.slice(0, through));
  if (levels.Barbarian === 20) {
    scores[0] = Math.min(25, scores[0] + 4);
    scores[2] = Math.min(25, scores[2] + 4);
  }
  if (levels.Monk === 20) {
    scores[1] = Math.min(25, scores[1] + 4);
    scores[4] = Math.min(25, scores[4] + 4);
  }
  return scores;
}
export function startingSkillCount(name: SrdClass, first: boolean) {
  return first ? classRules[name].skillCount : ['Bard', 'Ranger', 'Rogue'].includes(name) ? 1 : 0;
}
export function skillChoicesAt(name: SrdClass, level: number, first: boolean) {
  return (
    (level === 1 ? startingSkillCount(name, first) : 0) +
    (name === 'Barbarian' && level === 3 ? 1 : 0) +
    (name === 'Bard' && level === 3 ? 3 : 0)
  );
}
export function expertiseChoicesAt(name: SrdClass, level: number) {
  if ((name === 'Bard' && [2, 9].includes(level)) || (name === 'Rogue' && [1, 6].includes(level)))
    return 2;
  if (name === 'Ranger') return level === 2 ? 1 : level === 9 ? 2 : 0;
  return name === 'Wizard' && level === 2 ? 1 : 0;
}
export function masteryCount(name: SrdClass, level: number) {
  if (name === 'Barbarian') return level >= 10 ? 4 : level >= 4 ? 3 : 2;
  if (name === 'Fighter') return level >= 16 ? 6 : level >= 10 ? 5 : level >= 4 ? 4 : 3;
  return ['Paladin', 'Ranger', 'Rogue'].includes(name) ? 2 : 0;
}
export function featAt(name: SrdClass, level: number) {
  return featuresAt(name, level).some((e) =>
    /: (Ability Score Improvement|Epic Boon)$/.test(e.name),
  );
}
export const weaponNames = [
  'Club',
  'Dagger',
  'Greatclub',
  'Handaxe',
  'Javelin',
  'Light Hammer',
  'Mace',
  'Quarterstaff',
  'Sickle',
  'Spear',
  'Dart',
  'Light Crossbow',
  'Shortbow',
  'Sling',
  'Battleaxe',
  'Flail',
  'Glaive',
  'Greataxe',
  'Greatsword',
  'Halberd',
  'Lance',
  'Longsword',
  'Maul',
  'Morningstar',
  'Pike',
  'Rapier',
  'Scimitar',
  'Shortsword',
  'Trident',
  'War Pick',
  'Warhammer',
  'Whip',
  'Blowgun',
  'Hand Crossbow',
  'Heavy Crossbow',
  'Longbow',
  'Musket',
  'Pistol',
];
export const fightingStyles = [
  'Archery',
  'Defense',
  'Great Weapon Fighting',
  'Two-Weapon Fighting',
];
export type FeatureChoice = { key: string; label: string; count: number; options: string[] };
/** Choices with closed, source-defined option sets. Runtime tactical choices stay in feature text. */
export function featureChoicesAt(name: SrdClass, level: number, first = false): FeatureChoice[] {
  const result: FeatureChoice[] = [];
  const add = (key: string, label: string, options: string[], count = 1) =>
    result.push({ key, label, options, count });
  if (name === 'Druid' && level >= 2)
    add(
      'wild-shape-forms',
      'Known Wild Shape forms (p.42)',
      eligibleWildShapes(level).map((shape) => shape.id),
      wildShapeLimits(level).count,
    );
  if (name === 'Bard' && level === 1)
    add('instruments', 'Musical instrument proficiencies (p.31)', instruments, first ? 3 : 1);
  if (name === 'Monk' && level === 1 && first)
    add('monk-tool', 'Artisan’s tool or instrument proficiency (p.49)', [
      ...artisanTools,
      ...instruments,
    ]);
  if (name === 'Ranger' && level === 2)
    add(
      'deft-languages',
      'Deft Explorer languages (p.59)',
      [...standardLanguages, ...rareLanguages],
      2,
    );
  if (name === 'Rogue' && level === 1)
    add('thieves-language', 'Thieves’ Cant extra language (p.62)', [
      ...standardLanguages,
      ...rareLanguages,
    ]);
  if (name === 'Druid' && level >= 3)
    add('land', 'Circle of the Land terrain (p.46)', ['Arid', 'Polar', 'Temperate', 'Tropical']);
  if (name === 'Cleric' && level === 1)
    add('divine-order', 'Divine Order (p.37)', ['Protector', 'Thaumaturge']);
  if (name === 'Druid' && level === 1)
    add('primal-order', 'Primal Order (p.42)', ['Magician', 'Warden']);
  if (name === 'Cleric' && level === 7)
    add('blessed-strikes', 'Blessed Strikes (p.38)', ['Divine Strike', 'Potent Spellcasting']);
  if (name === 'Druid' && level === 7)
    add('elemental-fury', 'Elemental Fury (p.44)', ['Potent Spellcasting', 'Primal Strike']);
  if (name === 'Ranger' && level === 3)
    add('hunters-prey', 'Hunter’s Prey (p.61)', ['Colossus Slayer', 'Horde Breaker']);
  if (name === 'Ranger' && level === 7)
    add('defensive-tactics', 'Defensive Tactics (p.61)', [
      'Escape the Horde',
      'Multiattack Defense',
    ]);
  if (
    (name === 'Fighter' && [1, 7].includes(level)) ||
    (['Paladin', 'Ranger'].includes(name) && level === 2)
  )
    add('fighting-style', 'Fighting Style', [
      ...fightingStyles,
      ...(name === 'Paladin' ? ['Blessed Warrior'] : name === 'Ranger' ? ['Druidic Warrior'] : []),
    ]);
  if (name === 'Bard' && level >= 6)
    add(
      'magical-discoveries',
      'College of Lore: Magical Discoveries (p.35)',
      srdCatalog
        .filter(
          (e) =>
            e.category === 'spell' &&
            e.classes?.some((n) => ['Cleric', 'Druid', 'Wizard'].includes(n)) &&
            (e.level ?? 10) <= Math.min(9, Math.ceil(level / 2)),
        )
        .map((e) => e.id),
      2,
    );
  if (name === 'Wizard' && (level === 3 || (level >= 5 && level <= 17 && level % 2 === 1)))
    add(
      'evocation-savant',
      'Evocation Savant: free new Evocation spells (p.82)',
      srdCatalog
        .filter(
          (e) =>
            e.category === 'spell' &&
            e.classes?.includes('Wizard') &&
            /Evocation/.test(e.text.slice(0, 100)) &&
            (e.level ?? 0) >= 1 &&
            (e.level ?? 10) <= Math.min(9, Math.ceil(level / 2)),
        )
        .map((e) => e.id),
      level === 3 ? 2 : 1,
    );
  if (name === 'Sorcerer' && level === 6)
    add('elemental-affinity', 'Elemental Affinity (p.69)', [
      'Acid',
      'Cold',
      'Fire',
      'Lightning',
      'Poison',
    ]);
  if (name === 'Wizard' && level === 18)
    add(
      'spell-mastery',
      'Spell Mastery (p.79): level 1 then level 2, casting time Action',
      srdCatalog
        .filter(
          (e) =>
            e.category === 'spell' &&
            e.classes?.includes('Wizard') &&
            [1, 2].includes(e.level ?? 0) &&
            /Casting Time: Action\b/.test(e.text),
        )
        .map((e) => e.id),
      2,
    );
  if (name === 'Wizard' && level === 20)
    add(
      'signature-spells',
      'Signature Spells (p.79): two level 3 spells',
      srdCatalog
        .filter((e) => e.category === 'spell' && e.classes?.includes('Wizard') && e.level === 3)
        .map((e) => e.id),
      2,
    );
  if (name === 'Warlock' && [11, 13, 15, 17].includes(level))
    add(
      'mystic-arcanum',
      `Mystic Arcanum: level ${(level + 1) / 2}`,
      srdCatalog
        .filter(
          (e) =>
            e.category === 'spell' && e.classes?.includes('Warlock') && e.level === (level + 1) / 2,
        )
        .map((e) => e.id),
    );
  return result;
}
export function optionCount(name: SrdClass, level: number) {
  return name === 'Warlock'
    ? Number(progressions.Warlock.rows[level - 1].values[0])
    : name === 'Sorcerer' && level >= 2
      ? level >= 17
        ? 6
        : level >= 10
          ? 4
          : 2
      : 0;
}
export function automaticPreparedIds(
  state: SrdBuilderState,
  name: SrdClass,
  through = state.levels.length,
): Set<string> {
  const steps = state.levels.slice(0, through);
  const own = steps.filter((step) => step.className === name);
  const latest = own.at(-1);
  const land = own.findLast((step) => step.choices.land)?.choices.land?.[0];
  const ids = alwaysPrepared(name, own.length, land)
    .map((spellName) => srdEntry('spell', spellName)?.id)
    .filter((id): id is string => !!id);
  if (name === 'Bard') ids.push(...(latest?.choices['magical-discoveries'] ?? []));
  if (name === 'Wizard')
    for (const step of own)
      ids.push(
        ...(step.choices['spell-mastery'] ?? []),
        ...(step.choices['signature-spells'] ?? []),
      );
  if (name === 'Warlock')
    for (const id of latest?.options ?? [])
      if (srdById.get(id)?.name === 'Pact of the Tome') ids.push(...(latest?.choices[id] ?? []));
  return new Set(ids);
}
export function warlockCantripIds(step: SrdLevelChoice): string[] {
  return [
    ...new Set([
      ...step.cantrips,
      ...step.options
        .filter((id) => srdById.get(id)?.name === 'Pact of the Tome')
        .flatMap((id) =>
          (step.choices[id] ?? []).filter((spell) => srdById.get(spell)?.level === 0),
        ),
    ]),
  ];
}
export function allowedOptions(name: SrdClass, level: number, selected: string[] = []) {
  return srdCatalog.filter((e) => {
    if (e.category !== 'option' || e.className !== name) return false;
    const required = /Prerequisite: Level (\d+)\+/.exec(e.text);
    if (required && level < Number(required[1])) return false;
    const invocation = /(?:Pact of the (Blade|Chain|Tome)|Thirsting Blade)\s+Invocation/.exec(
      e.text.replace(/\n/g, ' '),
    );
    if (invocation) {
      const title = invocation[1] ? `Pact of the ${invocation[1]}` : 'Thirsting Blade';
      if (!selected.some((id) => srdById.get(id)?.name === title)) return false;
    }
    return true;
  });
}

function semanticErrors(state: SrdBuilderState): string[] {
  const errors: string[] = [];
  errors.push(...equipmentErrors(state));
  errors.push(...companionErrors(state));
  const fail = (text: string) => errors.push(text);
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) fail(`${label}: duplicate selections.`);
  };
  if (
    state.abilityMethod === 'standard' &&
    [...state.baseScores].sort((a, b) => a - b).join() !== '8,10,12,13,14,15'
  )
    fail('Standard array must contain 15, 14, 13, 12, 10, 8 exactly once.');
  if (state.abilityMethod === 'point-buy') {
    const costs: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    if (
      state.baseScores.some((score) => costs[score] === undefined) ||
      state.baseScores.reduce((sum, score) => sum + costs[score], 0) !== 27
    )
      fail('Point buy requires scores 8–15 costing exactly 27 points.');
  }
  if (state.abilityMethod === 'rolled') {
    const totals = state.rolls?.map((roll) =>
      [...roll]
        .sort((a, b) => b - a)
        .slice(0, 3)
        .reduce((sum, value) => sum + value, 0),
    );
    if (
      !totals ||
      [...totals].sort((a, b) => a - b).join() !==
        [...state.baseScores].sort((a, b) => a - b).join()
    )
      fail('Rolled scores must match six recorded 4d6-drop-lowest rolls.');
  } else if (state.rolls) fail('Only rolled scores may include dice.');
  const bg = backgrounds[state.background];
  if (state.classEquipment === 'C' && state.levels[0].className !== 'Fighter')
    fail('Only Fighter offers starting equipment option C.');
  const increase = state.backgroundBoosts;
  if (
    increase.reduce((a, b) => a + b, 0) !== 3 ||
    increase.filter((n) => n > 0).length < 2 ||
    increase.some((value, i) => value > 0 && !(bg.abilities as readonly number[]).includes(i))
  )
    fail('Background grants +2/+1 to two listed abilities, or +1 to all three.');
  if (state.baseScores.some((score, i) => score + increase[i] > 20))
    fail('Background increases cannot exceed 20.');
  const ancestry = lineages[state.species] ?? [];
  if (state.lineage === 'High Elf') {
    const cantrip = srdById.get(state.speciesCantrip);
    if (
      cantrip?.category !== 'spell' ||
      cantrip.level !== 0 ||
      !cantrip.classes?.includes('Wizard')
    )
      fail('High Elf requires a Wizard cantrip.');
  } else if (state.speciesCantrip) fail('Only High Elf chooses a replaceable species cantrip.');
  if ((ancestry.length && !ancestry.includes(state.lineage)) || (!ancestry.length && state.lineage))
    fail('Choose a valid species lineage or ancestry.');
  if (
    (['Gnome', 'Halfling'].includes(state.species) && state.size !== 'Small') ||
    (!['Gnome', 'Halfling', 'Human', 'Tiefling'].includes(state.species) && state.size !== 'Medium')
  )
    fail('Invalid size for species.');
  if (
    (state.species === 'Human' && !allSkills.includes(state.speciesSkill)) ||
    (state.species === 'Elf' &&
      !['Insight', 'Perception', 'Survival'].includes(state.speciesSkill)) ||
    (!['Human', 'Elf'].includes(state.species) && state.speciesSkill)
  )
    fail('Choose a valid species skill.');
  unique(state.languages, 'Starting languages');
  if (
    state.languages.length !== 2 ||
    state.languages.some((name) => !standardLanguages.includes(name))
  )
    fail('Choose two different standard languages in addition to Common.');
  unique(state.tools, 'Background tool choices');
  if (
    state.background === 'Soldier'
      ? state.tools.length !== 1 || !gamingSets.includes(state.tools[0])
      : state.tools.length !== 0
  )
    fail('Soldier requires one Gaming Set; other background tool proficiencies are fixed.');
  const knownSkills = new Set<string>(bg.skills);
  const duplicateOriginSkill = state.speciesSkill && knownSkills.has(state.speciesSkill) ? 1 : 0;
  if (state.speciesSkill) knownSkills.add(state.speciesSkill);
  unique(state.replacementSkills, 'Origin replacement skills');
  if (
    state.replacementSkills.length !== duplicateOriginSkill ||
    state.replacementSkills.some((skill) => !allSkills.includes(skill) || knownSkills.has(skill))
  )
    fail('Choose one new skill for each overlapping species/background skill proficiency.');
  state.replacementSkills.forEach((skill) => knownSkills.add(skill));
  const expertise = new Set<string>();
  const takenFeats: string[] = [];
  function checkFeat(
    feat: SrdFeatChoice | undefined,
    total: number,
    category?: string,
    forcedList?: string,
  ) {
    if (!feat) {
      fail('Choose all granted feats and their options.');
      return;
    }
    const entry = srdById.get(feat.id);
    if (!entry || entry.category !== 'feat') {
      fail('Invalid feat.');
      return;
    }
    if (category && entry.featCategory !== category) fail(`Choose a ${category} feat.`);
    if (entry.featCategory === 'General' && total < 4)
      fail('General feats require character level 4.');
    if (entry.featCategory === 'Epic Boon' && total < 19)
      fail('Epic Boons require character level 19.');
    if (
      entry.featCategory === 'Fighting Style' &&
      !state.levels.slice(0, total).some((step) => step.choices['fighting-style'])
    )
      fail('Fighting Style feat requires the Fighting Style feature.');
    if (
      entry.name === 'Boon of Spell Recall' &&
      !state.levels
        .slice(0, total)
        .some((step) => classRules[step.className].caster && step.className !== 'Warlock')
    )
      fail('Boon of Spell Recall requires Spellcasting.');
    const repeatKey = entry.name === 'Magic Initiate' ? `${feat.id}:${feat.spellList}` : feat.id;
    if (
      takenFeats.includes(repeatKey) &&
      !['Ability Score Improvement', 'Skilled'].includes(entry.name)
    )
      fail(`Cannot repeat ${entry.name}.`);
    takenFeats.push(repeatKey);
    const count = feat.increases.reduce((sum, n) => sum + n, 0);
    const expected =
      entry.name === 'Ability Score Improvement'
        ? 2
        : entry.name === 'Grappler' || entry.featCategory === 'Epic Boon'
          ? 1
          : 0;
    if (count !== expected) fail(`${entry.name}: choose ${expected} ability increase(s).`);
    if (entry.name === 'Grappler') {
      const scores = builderScores(state, total - 1);
      if (scores[0] < 13 && scores[1] < 13) fail('Grappler requires Strength or Dexterity 13.');
      if (feat.increases.some((n, i) => n && ![0, 1].includes(i)))
        fail('Grappler increases Strength or Dexterity.');
    }
    if (
      entry.name === 'Boon of Irresistible Offense' &&
      feat.increases.some((n, i) => n && ![0, 1].includes(i))
    )
      fail('This boon increases Strength or Dexterity.');
    if (entry.name === 'Boon of Spell Recall' && feat.increases.some((n, i) => n && i < 3))
      fail('This boon increases Intelligence, Wisdom, or Charisma.');
    const scores = total ? builderScores(state, total) : builderScores(state, 0);
    if (
      feat.increases.some((n, i) => n && scores[i] > (entry.featCategory === 'Epic Boon' ? 30 : 20))
    )
      fail('Feat ability increase exceeds its maximum.');
    if (entry.name === 'Skilled') {
      unique(feat.skills, 'Skilled');
      if (
        feat.skills.length !== 3 ||
        feat.skills.some((skill) => !allSkills.includes(skill) && !toolNames.includes(skill))
      )
        fail('Skilled grants three distinct skills or tools.');
      feat.skills
        .filter((skill) => allSkills.includes(skill))
        .forEach((skill) => knownSkills.add(skill));
    } else if (feat.skills.length) fail('Only Skilled grants skill/tool selections.');
    if (entry.name === 'Magic Initiate') {
      if (
        !feat.spellList ||
        (forcedList && feat.spellList !== forcedList) ||
        feat.spellAbility === undefined
      )
        fail('Magic Initiate requires its spell list and ability.');
      unique(feat.spells, 'Magic Initiate');
      const spells = feat.spells.map((id) => srdById.get(id));
      if (
        spells.length !== 3 ||
        spells.some(
          (spell) =>
            !spell || spell.category !== 'spell' || !spell.classes?.includes(feat.spellList ?? ''),
        ) ||
        spells.filter((spell) => spell?.level === 0).length !== 2 ||
        spells.filter((spell) => spell?.level === 1).length !== 1
      )
        fail('Magic Initiate grants two cantrips and one level 1 spell from its list.');
    } else if (
      feat.spells.length ||
      feat.spellList !== undefined ||
      feat.spellAbility !== undefined
    )
      fail('Unexpected feat spell choices.');
  }
  if (state.originFeat) {
    if (srdById.get(state.originFeat.id)?.name !== bg.feat)
      fail('Background feat does not match background.');
    checkFeat(state.originFeat, 0, 'Origin', 'magicList' in bg ? bg.magicList : undefined);
  } else fail('Choose background feat options.');
  if (state.species === 'Human') checkFeat(state.humanFeat, 0, 'Origin');
  else if (state.humanFeat) fail('Only Human grants this additional Origin feat.');
  const counts: Partial<Record<SrdClass, number>> = {};
  const previous: Partial<Record<SrdClass, SrdLevelChoice>> = {};
  const permanentSkills = new Set(knownSkills);
  state.levels.forEach((step, index) => {
    const total = index + 1,
      name = step.className,
      rule = classRules[name];
    const level = (counts[name] = (counts[name] ?? 0) + 1);
    const label = `Character level ${total} (${name} ${level})`;
    knownSkills.clear();
    permanentSkills.forEach((skill) => knownSkills.add(skill));
    for (const [other, choices] of Object.entries(previous))
      if (other !== name) {
        for (const feat of choices?.invocationFeats ?? [])
          for (const skill of feat.skills) if (allSkills.includes(skill)) knownSkills.add(skill);
      }
    for (const feat of step.invocationFeats)
      for (const skill of feat.skills) if (allSkills.includes(skill)) knownSkills.add(skill);
    const expectCount = (values: string[], count: number, description: string) => {
      unique(values, `${label} ${description}`);
      if (values.length !== count) fail(`${label}: choose ${count} ${description}.`);
    };
    if (step.hp > rule.die || (index === 0 && step.hp !== rule.die))
      fail(`${label}: invalid Hit Point die result.`);
    if (level === 1 && index > 0) {
      const scores = builderScores(state, index);
      for (const multiclass of Object.keys(counts) as SrdClass[]) {
        const required = classRules[multiclass].primary;
        // Fighter: Strength OR Dexterity; all other dual-primary classes require both.
        if (
          multiclass === 'Fighter'
            ? required.every((i) => scores[i] < 13)
            : required.some((i) => scores[i] < 13)
        )
          fail(
            `${label}: multiclass prerequisites not met for ${multiclass} (13 in primary abilities).`,
          );
      }
    }
    expectCount(step.skills, skillChoicesAt(name, level, index === 0), 'class skills');
    const duplicates = step.skills.filter((skill) => knownSkills.has(skill)).length;
    for (const skill of step.skills) {
      if (!(name === 'Bard' && level === 3 ? allSkills : rule.skills).includes(skill))
        fail(`${label}: invalid class skill ${skill}.`);
      // Duplicate proficiencies do not create expertise.
      knownSkills.add(skill);
    }
    expectCount(
      step.replacementSkills,
      duplicates,
      'replacement skills for overlapping proficiencies',
    );
    if (
      step.replacementSkills.some((skill) => !allSkills.includes(skill) || knownSkills.has(skill))
    )
      fail(`${label}: replacement skills must be new skill proficiencies.`);
    step.replacementSkills.forEach((skill) => knownSkills.add(skill));
    expectCount(step.expertise, expertiseChoicesAt(name, level), 'expertise skills');
    for (const skill of step.expertise) {
      if (!knownSkills.has(skill) || expertise.has(skill))
        fail(`${label}: expertise requires a proficient skill without existing expertise.`);
      if (
        name === 'Wizard' &&
        !['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion'].includes(skill)
      )
        fail('Scholar expertise must use a listed Intelligence skill.');
      expertise.add(skill);
    }
    const limits = classSpellLimits(name, level);
    const automatic = automaticPreparedIds(state, name, index + 1);
    const additionalCantrip =
      level >= 1 &&
      state.levels
        .slice(0, index + 1)
        .some(
          (s) =>
            s.className === name &&
            (s.choices['divine-order']?.includes('Thaumaturge') ||
              s.choices['primal-order']?.includes('Magician')),
        )
        ? 1
        : 0;
    expectCount(step.cantrips, limits.cantrips + additionalCantrip, 'cantrips');
    expectCount(step.spells, limits.prepared, 'prepared spells');
    if ([...step.spells, ...step.cantrips].some((id) => automatic.has(id)))
      fail(
        `${label}: always-prepared class/subclass spells are additional to the selection quota; choose other spells.`,
      );
    unique(step.spellbook, `${label} spellbook`);
    if (name === 'Wizard' ? step.spellbook.length < limits.spellbook : step.spellbook.length > 0)
      fail(`${label}: invalid spellbook count.`);
    const magicalSecrets = name === 'Bard' && level >= 10;
    const listAllowed = (id: string, cantrip: boolean) => {
      const spell = srdById.get(id);
      return (
        spell?.category === 'spell' &&
        (cantrip
          ? spell.level === 0
          : (spell.level ?? 0) >= 1 && (spell.level ?? 10) <= limits.maxLevel) &&
        (spell.classes?.includes(name) ||
          (magicalSecrets &&
            !cantrip &&
            spell.classes?.some((n) => ['Cleric', 'Druid', 'Wizard'].includes(n))))
      );
    };
    if (
      step.cantrips.some((id) => !listAllowed(id, true)) ||
      [...step.spells, ...step.spellbook].some((id) => !listAllowed(id, false))
    )
      fail(`${label}: spell level or class list is invalid.`);
    if (name === 'Wizard' && step.spells.some((id) => !step.spellbook.includes(id)))
      fail(`${label}: prepared Wizard spells must be in the spellbook.`);
    const prev = previous[name];
    if (prev && ['Bard', 'Sorcerer', 'Warlock'].includes(name)) {
      const retained = prev.spells.filter((id) => !automatic.has(id));
      if (
        step.spells.filter((id) => !retained.includes(id)).length >
        limits.prepared - retained.length + 1
      )
        fail(`${label}: only one existing prepared spell may be replaced on this level-up.`);
    }
    if (
      prev &&
      name !== 'Wizard' &&
      step.cantrips.filter((id) => !prev.cantrips.includes(id)).length >
        limits.cantrips + additionalCantrip - prev.cantrips.length + 1
    )
      fail(`${label}: only one existing cantrip may be replaced on this level-up.`);
    if (name === 'Wizard' && prev && prev.spellbook.some((id) => !step.spellbook.includes(id)))
      fail('Level-up cannot remove spells from the Wizard spellbook.');
    if (prev) {
      const remaining = [...prev.options];
      let added = 0;
      for (const id of step.options) {
        const existing = remaining.indexOf(id);
        if (existing < 0) added++;
        else remaining.splice(existing, 1);
      }
      if (added > optionCount(name, level) - optionCount(name, level - 1) + 1)
        fail(
          `${label}: only one existing invocation/Metamagic option may be replaced on this level-up.`,
        );
    }
    if (step.options.length !== optionCount(name, level))
      fail(
        `${label}: choose ${optionCount(name, level)} ${name === 'Warlock' ? 'invocations' : 'Metamagic options'}.`,
      );
    for (const id of new Set(step.options)) {
      if (
        step.options.filter((value) => value === id).length > 1 &&
        !srdById.get(id)?.text.includes('Repeatable.')
      )
        fail(`${label}: option is not repeatable.`);
    }
    const allowed = allowedOptions(name, level, step.options);
    if (step.options.some((id) => !allowed.some((e) => e.id === id)))
      fail(`${label}: invalid option or unmet invocation prerequisite.`);
    // Cantrip-specific invocation choices must name an actual known Warlock cantrip.
    for (const id of new Set(step.options)) {
      const option = srdById.get(id);
      if (option && /a Warlock Cantrip/.test(option.text)) {
        const selected = step.choices[id] ?? [];
        if (
          selected.length !== step.options.filter((value) => value === id).length ||
          selected.some(
            (value) =>
              !warlockCantripIds(step).includes(value) ||
              !/\bdamage\b/.test(srdById.get(value)?.text ?? ''),
          ) ||
          new Set(selected).size !== selected.length
        )
          fail(
            `${option.name}: choose a different known damaging Warlock cantrip for each selection.`,
          );
        if (
          option.name === 'Eldritch Spear' &&
          selected.some(
            (value) =>
              Number(
                /Range: (\d+)\s*(?:feet|foot)/.exec(srdById.get(value)?.text ?? '')?.[1] ?? 0,
              ) < 10,
          )
        )
          fail('Eldritch Spear requires a cantrip with range at least 10 feet.');
        if (
          option.name === 'Repelling Blast' &&
          selected.some(
            (value) =>
              !/attack roll|(?:ranged|melee) spell attack|make one attack/.test(
                srdById.get(value)?.text ?? '',
              ),
          )
        )
          fail('Repelling Blast requires an attack-roll cantrip.');
      }
      if (option?.name === 'Pact of the Tome') {
        const selected = step.choices[id] ?? [],
          spells = selected.map((value) => srdById.get(value));
        if (
          selected.length !== 5 ||
          new Set(selected).size !== 5 ||
          spells.some((e) => e?.category !== 'spell') ||
          spells.filter((e) => e?.level === 0).length !== 3 ||
          spells.filter((e) => e?.level === 1 && /Ritual/.test(e.text)).length !== 2
        )
          fail('Pact of the Tome requires three cantrips and two level 1 ritual spells.');
        const prepared = new Set([
          ...step.cantrips,
          ...step.spells,
          ...[...Object.entries(previous)]
            .filter(([className]) => className !== name)
            .flatMap(([, choices]) => [...(choices?.cantrips ?? []), ...(choices?.spells ?? [])]),
          ...alwaysPrepared(name, level).map((spellName) => srdEntry('spell', spellName)?.id),
          ...(state.originFeat?.spells ?? []),
          ...(state.humanFeat?.spells ?? []),
        ]);
        if (selected.some((spell) => prepared.has(spell)))
          fail('Pact of the Tome spells must not already be prepared.');
      }
    }
    const lessons = step.options.filter(
      (id) => srdById.get(id)?.name === 'Lessons of the First Ones',
    ).length;
    if (step.invocationFeats.length !== lessons)
      fail('Choose an Origin feat for each Lessons of the First Ones invocation.');
    if (new Set(step.invocationFeats.map((feat) => feat.id)).size !== step.invocationFeats.length)
      fail('Lessons of the First Ones requires a different Origin feat each time.');
    // These are current invocations, not a new feat grant each level.
    const beforeInvocationFeats = takenFeats.length;
    step.invocationFeats.forEach((feat) => checkFeat(feat, total, 'Origin'));
    if (level > 1) takenFeats.splice(beforeInvocationFeats);
    expectCount(step.mastery, masteryCount(name, level), 'weapon masteries');
    if (step.mastery.some((weapon) => !weaponNames.includes(weapon)))
      fail(`${label}: invalid weapon mastery.`);
    if (
      name === 'Barbarian' &&
      step.mastery.some((weapon) =>
        [
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
        ].includes(weapon),
      )
    )
      fail('Barbarian mastery requires melee weapons.');
    if (
      name === 'Rogue' &&
      !Object.keys(counts).some((className) =>
        ['Barbarian', 'Fighter', 'Paladin', 'Ranger'].includes(className),
      )
    ) {
      if (
        step.mastery.some((weapon) => {
          const index = weaponNames.indexOf(weapon);
          const entry = srdCatalog.find((e) => e.kind === 'weapon' && e.name === weapon);
          return index >= 14 && !/\b(Finesse|Light)\b/.test(entry?.text ?? '');
        })
      )
        fail('Rogue mastery requires proficiency with the chosen weapon.');
    }
    if (featAt(name, level)) checkFeat(step.feat, total);
    else if (step.feat) fail(`${label}: no feat is granted at this class level.`);
    const closedChoices = featureChoicesAt(name, level, index === 0);
    for (const choice of closedChoices) {
      const values = step.choices[choice.key] ?? [];
      if (
        ['wild-shape-forms', 'land'].includes(choice.key) &&
        values.length === 0 &&
        name === 'Druid' &&
        state.levels.slice(index + 1).some((level) => level.className === 'Druid')
      )
        continue;
      expectCount(values, choice.count, choice.label);
      if (values.some((value) => !choice.options.includes(value)))
        fail(`${label}: invalid ${choice.label} choice.`);
      if (
        choice.key === 'spell-mastery' &&
        values.length === 2 &&
        (srdById.get(values[0])?.level === srdById.get(values[1])?.level ||
          values.some((id) => !step.spellbook.includes(id)))
      )
        fail('Spell Mastery requires one level 1 and one level 2 spell from the spellbook.');
      if (choice.key === 'signature-spells' && values.some((id) => !step.spellbook.includes(id)))
        fail('Signature Spells must be in the spellbook.');
      if (
        choice.key === 'evocation-savant' &&
        values.some((id) => !step.spellbook.includes(id) || prev?.spellbook.includes(id))
      )
        fail('Evocation Savant must add new spells to the spellbook, not spells already known.');
      if (
        choice.key === 'magical-discoveries' &&
        prev?.choices['magical-discoveries'] &&
        values.filter((id) => !prev.choices['magical-discoveries'].includes(id)).length > 1
      )
        fail('Only one Magical Discoveries spell may change per Bard level.');
      if (choice.key === 'fighting-style')
        for (const value of values) {
          const id = srdEntry('feat', value)?.id;
          if (id && takenFeats.includes(id)) fail(`Cannot repeat ${value}.`);
          if (id) takenFeats.push(id);
        }
    }
    for (const key of Object.keys(step.choices)) {
      const option = srdById.get(key);
      const invocationChoice =
        step.options.includes(key) &&
        !!option &&
        (/a Warlock Cantrip/.test(option.text) || option.name === 'Pact of the Tome');
      if (
        !closedChoices.some((c) => c.key === key) &&
        !invocationChoice &&
        key !== 'warrior-cantrips'
      )
        fail(`${label}: unknown feature-choice key.`);
    }
    const warrior = step.choices['fighting-style']?.find((value) =>
      ['Blessed Warrior', 'Druidic Warrior'].includes(value),
    );
    if (warrior) {
      const selected = step.choices['warrior-cantrips'] ?? [],
        list = warrior === 'Blessed Warrior' ? 'Cleric' : 'Druid';
      if (
        selected.length !== 2 ||
        new Set(selected).size !== 2 ||
        selected.some(
          (id) => srdById.get(id)?.level !== 0 || !srdById.get(id)?.classes?.includes(list),
        )
      )
        fail(`${warrior} requires two ${list} cantrips.`);
    } else if (step.choices['warrior-cantrips'])
      fail('Warrior cantrips require Blessed Warrior or Druidic Warrior.');
    for (const skill of [...step.skills, ...step.replacementSkills, ...(step.feat?.skills ?? [])])
      if (allSkills.includes(skill)) permanentSkills.add(skill);
    previous[name] = step;
  });
  if (builderScores(state).some((score) => score > 30)) fail('Ability scores cannot exceed 30.');
  return errors;
}
export const srdBuilderSchema = stateShape.superRefine((state, ctx) => {
  for (const message of semanticErrors(state)) ctx.addIssue({ code: 'custom', message });
});
export function builderErrors(state: unknown): string[] {
  const result = srdBuilderSchema.safeParse(state);
  return result.success ? [] : [...new Set(result.error.issues.map((issue) => issue.message))];
}
export function defaultBackgroundFeat(background: SrdBuilderState['background']) {
  const rules = backgrounds[background],
    feat = blankFeat(srdEntry('feat', rules.feat)?.id);
  if ('magicList' in rules) {
    feat.spellList = rules.magicList;
    feat.spellAbility = rules.magicList === 'Cleric' ? 4 : 3;
  }
  return feat;
}
