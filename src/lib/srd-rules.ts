import progressionData from './srd-data/progressions.json' with { type: 'json' };
import { srdCatalog } from './srd-catalog';

export const srdClasses = [
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
] as const;
export type SrdClass = (typeof srdClasses)[number];
export const srdSpecies = [
  'Dragonborn',
  'Dwarf',
  'Elf',
  'Gnome',
  'Goliath',
  'Halfling',
  'Human',
  'Orc',
  'Tiefling',
] as const;
export const srdBackgrounds = ['Acolyte', 'Criminal', 'Sage', 'Soldier'] as const;
export const abilityNames = [
  'Strength',
  'Dexterity',
  'Constitution',
  'Intelligence',
  'Wisdom',
  'Charisma',
] as const;
export const srdAlignments = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
] as const;
type ClassRules = {
  die: number;
  primary: number[];
  saves: number[];
  skillCount: number;
  skills: string[];
  spellAbility?: number;
  caster?: 'full' | 'half' | 'pact';
};
const skillLists = [
  'Animal Handling,Athletics,Intimidation,Nature,Perception,Survival',
  '*',
  'History,Insight,Medicine,Persuasion,Religion',
  'Animal Handling,Arcana,Insight,Medicine,Nature,Perception,Religion,Survival',
  'Acrobatics,Animal Handling,Athletics,History,Insight,Intimidation,Persuasion,Perception,Survival',
  'Acrobatics,Athletics,History,Insight,Religion,Stealth',
  'Athletics,Insight,Intimidation,Medicine,Persuasion,Religion',
  'Animal Handling,Athletics,Insight,Investigation,Nature,Perception,Stealth,Survival',
  'Acrobatics,Athletics,Deception,Insight,Intimidation,Investigation,Perception,Persuasion,Sleight of Hand,Stealth',
  'Arcana,Deception,Insight,Intimidation,Persuasion,Religion',
  'Arcana,Deception,History,Intimidation,Investigation,Nature,Religion',
  'Arcana,History,Insight,Investigation,Medicine,Nature,Religion',
];
export const allSkills = [
  'Acrobatics',
  'Animal Handling',
  'Arcana',
  'Athletics',
  'Deception',
  'History',
  'Insight',
  'Intimidation',
  'Investigation',
  'Medicine',
  'Nature',
  'Perception',
  'Performance',
  'Persuasion',
  'Religion',
  'Sleight of Hand',
  'Stealth',
  'Survival',
];
export const standardLanguages = [
  'Common Sign Language',
  'Draconic',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];
export const rareLanguages = [
  'Abyssal',
  'Celestial',
  'Deep Speech',
  'Druidic',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Thieves’ Cant',
  'Undercommon',
];
export const instruments = [
  'Bagpipes',
  'Drum',
  'Dulcimer',
  'Flute',
  'Horn',
  'Lute',
  'Lyre',
  'Pan Flute',
  'Shawm',
  'Viol',
];
export const gamingSets = ['Dice', 'Dragonchess', 'Playing Cards', 'Three-Dragon Ante'];
export const artisanTools = [
  'Alchemist’s Supplies',
  'Brewer’s Supplies',
  'Calligrapher’s Supplies',
  'Carpenter’s Tools',
  'Cartographer’s Tools',
  'Cobbler’s Tools',
  'Cook’s Utensils',
  'Glassblower’s Tools',
  'Jeweler’s Tools',
  'Leatherworker’s Tools',
  'Mason’s Tools',
  'Painter’s Supplies',
  'Potter’s Tools',
  'Smith’s Tools',
  'Tinker’s Tools',
  'Weaver’s Tools',
  'Woodcarver’s Tools',
];
export const toolNames = [
  ...artisanTools,
  ...instruments,
  ...gamingSets,
  'Disguise Kit',
  'Forgery Kit',
  'Herbalism Kit',
  'Navigator’s Tools',
  'Poisoner’s Kit',
  'Thieves’ Tools',
];
const primaries = [[0], [5], [4], [4], [0, 1], [1, 4], [0, 5], [1, 4], [1], [5], [5], [3]];
const saves = [
  [0, 2],
  [1, 5],
  [4, 5],
  [3, 4],
  [0, 2],
  [0, 1],
  [4, 5],
  [0, 1],
  [1, 3],
  [2, 5],
  [4, 5],
  [3, 4],
];
const dice = [12, 8, 8, 8, 10, 8, 10, 10, 8, 6, 8, 6];
export const classRules = Object.fromEntries(
  srdClasses.map((name, i) => [
    name,
    {
      die: dice[i],
      primary: primaries[i],
      saves: saves[i],
      skillCount: name === 'Bard' || name === 'Ranger' ? 3 : name === 'Rogue' ? 4 : 2,
      skills: skillLists[i] === '*' ? allSkills : skillLists[i].split(','),
      ...(['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Wizard'].includes(name)
        ? {
            caster: 'full',
            spellAbility: name === 'Wizard' ? 3 : ['Cleric', 'Druid'].includes(name) ? 4 : 5,
          }
        : {}),
      ...(['Paladin', 'Ranger'].includes(name)
        ? { caster: 'half', spellAbility: name === 'Ranger' ? 4 : 5 }
        : {}),
      ...(name === 'Warlock' ? { caster: 'pact', spellAbility: 5 } : {}),
    },
  ]),
) as Record<SrdClass, ClassRules>;

export const backgrounds = {
  Acolyte: {
    abilities: [3, 4, 5],
    skills: ['Insight', 'Religion'],
    feat: 'Magic Initiate',
    magicList: 'Cleric',
  },
  Criminal: { abilities: [1, 2, 3], skills: ['Sleight of Hand', 'Stealth'], feat: 'Alert' },
  Sage: {
    abilities: [2, 3, 4],
    skills: ['Arcana', 'History'],
    feat: 'Magic Initiate',
    magicList: 'Wizard',
  },
  Soldier: { abilities: [0, 1, 2], skills: ['Athletics', 'Intimidation'], feat: 'Savage Attacker' },
} as const;
export const lineages: Record<string, string[]> = {
  Dragonborn: [
    'Black',
    'Blue',
    'Brass',
    'Bronze',
    'Copper',
    'Gold',
    'Green',
    'Red',
    'Silver',
    'White',
  ],
  Elf: ['Drow', 'High Elf', 'Wood Elf'],
  Gnome: ['Forest Gnome', 'Rock Gnome'],
  Goliath: ['Cloud Giant', 'Fire Giant', 'Frost Giant', 'Hill Giant', 'Stone Giant', 'Storm Giant'],
  Tiefling: ['Abyssal', 'Chthonic', 'Infernal'],
};
type Progression = {
  page: number;
  rows: { level: number; features: string; values: (number | string)[] }[];
};
export const progressions = progressionData as Record<SrdClass, Progression>;
/** SRD 5.2.1 PDF p.26. Index is effective Spellcasting level, not total level. */
export const spellSlotTable = [
  [],
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
export function classSpellLimits(name: SrdClass, level: number) {
  const rule = classRules[name],
    values = progressions[name].rows[level - 1].values.map(Number);
  if (!rule.caster) return { cantrips: 0, prepared: 0, maxLevel: 0, spellbook: 0 };
  let cantrips = 0,
    prepared = 0,
    maxLevel = 0;
  if (name === 'Warlock') {
    [, cantrips, prepared, , maxLevel] = values;
  } else if (rule.caster === 'half') {
    prepared = values[1];
    maxLevel = Math.ceil(level / 4);
  } else {
    const offset = ['Bard', 'Cleric', 'Druid', 'Sorcerer'].includes(name) ? 1 : 0;
    cantrips = values[offset];
    prepared = values[offset + 1];
    maxLevel = Math.min(9, Math.ceil(level / 2));
  }
  const savant = level >= 3 ? 2 + Math.floor((Math.min(level, 17) - 3) / 2) : 0;
  return {
    cantrips,
    prepared,
    maxLevel,
    spellbook: name === 'Wizard' ? 6 + 2 * (level - 1) + savant : 0,
  };
}
export function featuresAt(name: SrdClass, level: number) {
  const entries = srdCatalog.filter((e) => e.category === 'feature' && e.className === name);
  const granted = entries.filter((e) => e.level === level);
  // Repeated features have one description, but each table row grants them independently.
  const names = progressions[name].rows[level - 1].features.split(/,\s*/);
  for (const featureName of names) {
    const entry = entries.find(
      (e) => !e.subclass && e.name.replace(/^Level \d+: /, '') === featureName,
    );
    if (entry && !granted.some((e) => e.id === entry.id)) granted.push(entry);
  }
  return granted;
}
/** Always-prepared spells are additional to, not part of, the class-table quota. */
export function alwaysPrepared(name: SrdClass, level: number, land = ''): string[] {
  const result: string[] = [];
  const add = (at: number, names: string[]) => {
    if (level >= at) result.push(...names);
  };
  if (name === 'Cleric') {
    add(3, ['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration']);
    add(5, ['Mass Healing Word', 'Revivify']);
    add(7, ['Aura of Life', 'Death Ward']);
    add(9, ['Greater Restoration', 'Mass Cure Wounds']);
  }
  if (name === 'Paladin') {
    add(2, ['Divine Smite']);
    add(5, ['Find Steed']);
    add(3, ['Protection from Evil and Good', 'Shield of Faith']);
    add(5, ['Aid', 'Zone of Truth']);
    add(9, ['Beacon of Hope', 'Dispel Magic']);
    add(13, ['Freedom of Movement', 'Guardian of Faith']);
    add(17, ['Commune', 'Flame Strike']);
  }
  if (name === 'Ranger') add(1, ['Hunter’s Mark']);
  if (name === 'Druid') add(1, ['Speak with Animals']);
  if (name === 'Sorcerer') {
    add(3, ['Alter Self', 'Chromatic Orb', 'Command', 'Dragon’s Breath']);
    add(5, ['Fear', 'Fly']);
    add(7, ['Arcane Eye', 'Charm Monster']);
    add(9, ['Legend Lore', 'Summon Dragon']);
  }
  if (name === 'Warlock') {
    add(3, ['Burning Hands', 'Command', 'Scorching Ray', 'Suggestion']);
    add(5, ['Fireball', 'Stinking Cloud']);
    add(7, ['Fire Shield', 'Wall of Fire']);
    add(9, ['Geas', 'Insect Plague', 'Contact Other Plane']);
  }
  if (name === 'Bard') add(20, ['Power Word Heal', 'Power Word Kill']);
  if (name === 'Druid' && land) {
    const lands: Record<string, [number, string[]][]> = {
      Arid: [
        [3, ['Blur', 'Burning Hands', 'Fire Bolt']],
        [5, ['Fireball']],
        [7, ['Blight']],
        [9, ['Wall of Stone']],
      ],
      Polar: [
        [3, ['Fog Cloud', 'Hold Person', 'Ray of Frost']],
        [5, ['Sleet Storm']],
        [7, ['Ice Storm']],
        [9, ['Cone of Cold']],
      ],
      Temperate: [
        [3, ['Misty Step', 'Shocking Grasp', 'Sleep']],
        [5, ['Lightning Bolt']],
        [7, ['Freedom of Movement']],
        [9, ['Tree Stride']],
      ],
      Tropical: [
        [3, ['Acid Splash', 'Ray of Sickness', 'Web']],
        [5, ['Stinking Cloud']],
        [7, ['Polymorph']],
        [9, ['Insect Plague']],
      ],
    };
    for (const [at, names] of lands[land] ?? []) add(at, names);
  }
  return result;
}
