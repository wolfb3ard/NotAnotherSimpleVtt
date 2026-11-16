import { srdById, srdEntry } from './srd-catalog';
import { classRules, type SrdClass } from './srd-rules';
import { automaticPreparedIds, type SrdBuilderState, type SrdLevelChoice } from './srd-state';

export type SrdCastingSource = {
  id: string;
  label: string;
  ability: number;
  spells: string[];
  attackKey: string;
  dcKey: string;
};
export const invocationSpellNames: Record<string, string> = {
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
export function speciesSpellIds(state: SrdBuilderState): string[] {
  const level = state.levels.length;
  const table: Record<string, string[]> = {
    Drow: ['Dancing Lights', 'Faerie Fire', 'Darkness'],
    'High Elf': [
      srdById.get(state.speciesCantrip)?.name ?? 'Prestidigitation',
      'Detect Magic',
      'Misty Step',
    ],
    'Wood Elf': ['Druidcraft', 'Longstrider', 'Pass without Trace'],
    Abyssal: ['Poison Spray', 'Ray of Sickness', 'Hold Person'],
    Chthonic: ['Chill Touch', 'False Life', 'Ray of Enfeeblement'],
    Infernal: ['Fire Bolt', 'Hellish Rebuke', 'Darkness'],
  };
  const names = (table[state.lineage] ?? []).slice(0, level >= 5 ? 3 : level >= 3 ? 2 : 1);
  if (state.species === 'Tiefling') names.push('Thaumaturgy');
  if (state.lineage === 'Forest Gnome') names.push('Minor Illusion', 'Speak with Animals');
  if (state.lineage === 'Rock Gnome') names.push('Mending', 'Prestidigitation');
  return names.map((name) => srdEntry('spell', name)?.id).filter((id): id is string => !!id);
}
/** Source identity, not a spell's catalog class list, governs its casting ability.
 * Exported keys intentionally match the authoritative dndNumbers reference API. */
export function srdCastingSources(state: SrdBuilderState): SrdCastingSource[] {
  const result: SrdCastingSource[] = [];
  const add = (
    id: string,
    label: string,
    ability: number,
    spells: string[],
    className?: SrdClass,
  ) =>
    result.push({
      id,
      label,
      ability,
      spells: [...new Set(spells)],
      attackKey: className
        ? `srd-resource:spell-attack:${className}`
        : `srd-resource:casting:${id}:attack`,
      dcKey: className ? `srd-resource:spell-dc:${className}` : `srd-resource:casting:${id}:dc`,
    });
  const latest = new Map<SrdClass, SrdLevelChoice>();
  state.levels.forEach((step) => latest.set(step.className, step));
  for (const [name, step] of latest) {
    const ability = classRules[name].spellAbility;
    if (ability === undefined) continue;
    const extra = state.levels
      .filter((row) => row.className === name)
      .flatMap((row) => [
        ...(row.choices['mystic-arcanum'] ?? []),
        ...(row.choices['warrior-cantrips'] ?? []),
      ]);
    if (name === 'Druid' && state.levels.filter((row) => row.className === 'Druid').length >= 2)
      extra.push(srdEntry('spell', 'Find Familiar')!.id);
    for (const id of step.options) {
      const optionName = srdById.get(id)?.name ?? '';
      if (optionName === 'Pact of the Tome') extra.push(...(step.choices[id] ?? []));
      const spell = srdEntry('spell', invocationSpellNames[optionName]);
      if (spell) extra.push(spell.id);
    }
    add(
      `class:${name}`,
      name,
      ability,
      [
        ...step.cantrips,
        ...step.spells,
        ...step.spellbook,
        ...automaticPreparedIds(state, name),
        ...extra,
      ],
      name,
    );
  }
  for (const [id, label, feat] of [
    ['feat:background', `${state.background} · Magic Initiate`, state.originFeat],
    ['feat:human', 'Human · Magic Initiate', state.humanFeat],
    ...state.levels.map(
      (step, index) =>
        [`feat:level:${index + 1}`, `Level ${index + 1} · Magic Initiate`, step.feat] as const,
    ),
    ...[...latest].flatMap(([name, step]) =>
      step.invocationFeats.map(
        (feat, index) =>
          [
            `feat:invocation:${name}:${index}`,
            `${name} invocation · Magic Initiate`,
            feat,
          ] as const,
      ),
    ),
  ] as const)
    if (feat && srdById.get(feat.id)?.name === 'Magic Initiate' && feat.spellAbility !== undefined)
      add(id, label, feat.spellAbility, feat.spells);
  if (['Elf', 'Gnome', 'Tiefling'].includes(state.species))
    add(
      `species:${state.species}`,
      `${state.species} · ${state.lineage}`,
      state.speciesSpellAbility,
      speciesSpellIds(state),
    );
  return result;
}
