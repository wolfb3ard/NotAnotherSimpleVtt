import type { Field, Section, Sheet } from './types';
import { srdCastingSources } from './srd-casting';

export const abilities = [
  'Strength',
  'Dexterity',
  'Constitution',
  'Intelligence',
  'Wisdom',
  'Charisma',
] as const;
export const skills = [
  ['Acrobatics', 1],
  ['Animal Handling', 4],
  ['Arcana', 3],
  ['Athletics', 0],
  ['Deception', 5],
  ['History', 3],
  ['Insight', 4],
  ['Intimidation', 5],
  ['Investigation', 3],
  ['Medicine', 4],
  ['Nature', 3],
  ['Perception', 4],
  ['Performance', 5],
  ['Persuasion', 5],
  ['Religion', 3],
  ['Sleight of Hand', 1],
  ['Stealth', 1],
  ['Survival', 4],
] as const;

/** Stable, namespaced IDs let the existing sheet-reference grammar work server-side. */
export function dndId(key: string) {
  let hash = 2166136261;
  for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `5e202024-0000-4000-8000-${(hash >>> 0).toString(16).padStart(12, '0')}`;
}
export const isDndSheet = (sheet: Sheet) => sheet.sections.some((s) => s.id === dndId('character'));
const ref = (key: string) => `@{${dndId(key)}}`;
const number = (key: string, label: string, value = 0): Field => ({
  id: dndId(key),
  label,
  kind: 'number',
  value,
});
const text = (key: string, label: string, value = ''): Field => ({
  id: dndId(key),
  label,
  kind: 'text',
  value,
});
function section(key: string, title: string, fields: Field[]): Section {
  return { id: dndId(key), title, fields, abilities: [] };
}
function roll(section: Section, key: string, name: string, expression: string) {
  section.abilities.push({ id: dndId(`roll:${key}`), name, expression, description: '' });
}

export function createDndSheet(): Sheet {
  const character = section('character', '5.5e · Character', [
    number('level', 'Level', 1),
    number('pb', 'Proficiency bonus', 2),
    text('class', 'Class / subclass'),
    text('species', 'Species'),
    text('background', 'Background'),
    text('alignment', 'Alignment'),
    number('exhaustion', 'Exhaustion'),
    number('check-bonus', 'Additional check bonus'),
    number('save-bonus', 'Additional save bonus'),
    number('attack-bonus', 'Additional attack bonus'),
    number('damage-bonus', 'Additional damage bonus'),
  ]);
  const scores = section('scores', 'Ability scores & checks', []);
  const saves = section('saves', 'Saving throws', []);
  abilities.forEach((name, i) => {
    scores.fields.push(number(`score:${i}`, name, 10), number(`mod:${i}`, `${name} modifier`));
    roll(scores, `check:${i}`, `${name} check`, `1d20 + ${ref(`check:${i}`)}`);
    saves.fields.push(
      number(`save-prof:${i}`, `${name} proficiency`),
      number(`save-extra:${i}`, `${name} extra bonus`),
    );
    roll(saves, `save:${i}`, `${name} save`, `1d20 + ${ref(`save:${i}`)}`);
  });
  const skillSection = section('skills', 'Skills · proficiency / expertise', []);
  skills.forEach(([name], i) => {
    skillSection.fields.push(
      number(`skill-prof:${i}`, `${name} proficiency`),
      number(`skill-extra:${i}`, `${name} extra bonus`),
    );
    roll(skillSection, `skill:${i}`, name, `1d20 + ${ref(`skill:${i}`)}`);
  });
  const combat = section('combat', 'Combat & resources', [
    number('ac', 'Armor Class', 10),
    number('speed', 'Speed', 30),
    number('initiative', 'Initiative modifier'),
    number('passive', 'Passive Perception', 10),
    number('spell-ability', 'Spellcasting ability', 3),
    number('spell-dc', 'Spell save DC', 10),
    { ...number('hp', 'Hit Points', 10), kind: 'resource', max: 10 },
    { ...number('inspiration', 'Heroic Inspiration'), kind: 'resource', max: 1 },
    { ...number('hit-dice', 'Hit Dice', 1), kind: 'resource', max: 1 },
    ...Array.from({ length: 9 }, (_, i): Field => ({
      ...number(`slot:${i}`, `Level ${i + 1} spell slots`),
      kind: 'resource',
      max: 0,
    })),
  ]);
  roll(combat, 'initiative', 'Initiative', `1d20 + ${ref('initiative')}`);
  roll(combat, 'spell-attack', 'Spell attack', `1d20 + ${ref('spell-attack')}`);
  const attacks = Array.from({ length: 3 }, (_, i) => {
    const s = section(`weapon:${i}`, `Attack ${i + 1}`, [
      text(`weapon-name:${i}`, 'Weapon / spell name', i === 0 ? 'Longsword' : 'Custom attack'),
      number(`weapon-ability:${i}`, 'Attack ability', 0),
      number(`weapon-prof:${i}`, 'Weapon proficiency', 1),
      text(`weapon-dice:${i}`, 'Damage dice', '1d8'),
      number(`weapon-add:${i}`, 'Add ability to damage', 1),
      number(`weapon-hit:${i}`, 'Attack bonus (magic / features)'),
      number(`weapon-damage:${i}`, 'Damage bonus (magic / features)'),
      text(`weapon-type:${i}`, 'Damage type', i === 0 ? 'Slashing' : ''),
    ]);
    roll(s, `weapon-hit:${i}`, 'Attack roll', `1d20 + ${ref(`weapon-total:${i}`)}`);
    roll(s, `weapon-damage:${i}`, 'Damage roll', dndDamageExpression('1d8', i));
    roll(s, `weapon-critical:${i}`, 'Critical damage', dndDamageExpression('1d8', i, true));
    return s;
  });
  const notes = section('notes', 'Features, equipment & spells', [
    text('features', 'Class features / feats'),
    text('equipment', 'Equipment & proficiencies'),
    text('spells', 'Spells & prepared spells'),
    text('notes-text', 'Notes'),
  ]);
  return {
    version: 1,
    sections: [character, scores, saves, skillSection, combat, ...attacks, notes],
  };
}

export function dndDamageExpression(dice: string, slot: number, critical = false) {
  // Fixed damage (e.g. Blowgun) has no dice to double on a critical hit.
  if (/^(0|[1-9]\d{0,2})$/.test(dice))
    return `max(0, ${Number(dice)} + ${ref(`weapon-damage-total:${slot}`)})`;
  const match = /^(\d{1,2})d(4|6|8|10|12|20)$/.exec(dice);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 20)
    throw new Error('Damage must be 1–20 dice, such as 2d6, or fixed damage from 0–999.');
  return `max(0, ${Number(match[1]) * (critical ? 2 : 1)}d${match[2]} + ${ref(`weapon-damage-total:${slot}`)})`;
}

/** Recomputed on the server from saved inputs; derived values are never trusted. */
export function dndNumbers(sheet: Sheet): Record<string, number> {
  if (!isDndSheet(sheet)) return {};
  const fields = new Map(sheet.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
  const n = (key: string, fallback = 0) => Number(fields.get(dndId(key))?.value ?? fallback);
  const pb = 2 + Math.floor((n('level', 1) - 1) / 4);
  const mods = abilities.map((_, i) => Math.floor((n(`score:${i}`, 10) - 10) / 2));
  const penalty = n('exhaustion') * 2;
  const result: Record<string, number> = {};
  const set = (key: string, value: number) => {
    result[dndId(key)] = value;
  };
  set('pb', pb);
  mods.forEach((mod, i) => {
    set(`mod:${i}`, mod);
    set(`check:${i}`, mod + n('check-bonus') - penalty);
    set(
      `save:${i}`,
      mod + pb * n(`save-prof:${i}`) + n(`save-extra:${i}`) + n('save-bonus') - penalty,
    );
  });
  skills.forEach(([, ability], i) =>
    set(
      `skill:${i}`,
      mods[ability] +
        Math.floor(pb * n(`skill-prof:${i}`)) +
        n(`skill-extra:${i}`) +
        n('check-bonus') -
        penalty,
    ),
  );
  const spellMod = mods[n('spell-ability', 3)] ?? 0;
  set('spell-dc', 8 + pb + spellMod);
  set('spell-attack', spellMod + pb + n('attack-bonus') - penalty);
  const builder = sheet.character?.builder;
  const latest = new Map(builder?.levels.map((step) => [step.className, step]));
  const feats = [
    builder?.originFeat,
    builder?.humanFeat,
    ...(builder?.levels.map((step) => step.feat) ?? []),
    ...[...latest.values()].flatMap((step) => step.invocationFeats),
  ];
  // SRD 5.2.1 p.87: Alert is initiative-specific, not a bonus to all checks.
  const alert = feats.some((feat) => feat?.id === 'feat-alert') ? pb : 0;
  set('initiative', mods[1] + n('check-bonus') - penalty + alert);
  for (const source of builder ? srdCastingSources(builder) : []) {
    set(source.dcKey, 8 + pb + mods[source.ability]);
    set(source.attackKey, pb + mods[source.ability] + n('attack-bonus') - penalty);
  }
  set('passive', 10 + result[dndId('skill:11')] + penalty);
  for (let i = 0; i < 3; i++) {
    const mod = mods[n(`weapon-ability:${i}`)] ?? 0;
    set(
      `weapon-total:${i}`,
      mod + pb * n(`weapon-prof:${i}`) + n(`weapon-hit:${i}`) + n('attack-bonus') - penalty,
    );
    set(
      `weapon-damage-total:${i}`,
      (n(`weapon-add:${i}`, 1) ? mod : 0) + n(`weapon-damage:${i}`) + n('damage-bonus'),
    );
  }
  return result;
}

export function dndFieldOptions(id: string): { value: number; label: string }[] | undefined {
  if (
    ['spell-ability', ...Array.from({ length: 3 }, (_, i) => `weapon-ability:${i}`)].some(
      (key) => dndId(key) === id,
    )
  )
    return abilities.map((label, value) => ({ value, label }));
  const skill = skills.some((_, i) => dndId(`skill-prof:${i}`) === id);
  if (skill)
    return [
      { value: 0, label: 'Untrained' },
      { value: 0.5, label: 'Half proficiency (feature)' },
      { value: 1, label: 'Proficient' },
      { value: 2, label: 'Expertise' },
    ];
  if (
    [
      ...abilities.map((_, i) => `save-prof:${i}`),
      ...Array.from({ length: 3 }, (_, i) => `weapon-prof:${i}`),
    ].some((key) => dndId(key) === id)
  )
    return [
      { value: 0, label: 'Not proficient' },
      { value: 1, label: 'Proficient' },
    ];
  if (Array.from({ length: 3 }, (_, i) => `weapon-add:${i}`).some((key) => dndId(key) === id))
    return [
      { value: 0, label: 'No' },
      { value: 1, label: 'Yes' },
    ];
}

export function validateDndSheet(sheet: Sheet): string | undefined {
  if (!isDndSheet(sheet)) return;
  const fields = new Map(sheet.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
  const expected = createDndSheet();
  for (const field of expected.sections.flatMap((s) => s.fields)) {
    const actual = fields.get(field.id);
    if (!actual || actual.kind !== field.kind)
      return 'Built-in 5.5e fields cannot be removed or change type.';
    const options = dndFieldOptions(field.id);
    if (options && !options.some((o) => o.value === actual.value)) return `Invalid ${field.label}.`;
    if (
      field.id === dndId('level') &&
      (!Number.isInteger(actual.value) || Number(actual.value) < 1 || Number(actual.value) > 20)
    )
      return 'Level must be 1–20.';
    if (
      field.id === dndId('exhaustion') &&
      (!Number.isInteger(actual.value) || Number(actual.value) < 0 || Number(actual.value) > 6)
    )
      return 'Exhaustion must be 0–6.';
    if (
      abilities.some((_, i) => field.id === dndId(`score:${i}`)) &&
      (!Number.isInteger(actual.value) || Number(actual.value) < 1 || Number(actual.value) > 30)
    )
      return 'Ability scores must be 1–30.';
  }
  try {
    for (let i = 0; i < 3; i++)
      dndDamageExpression(String(fields.get(dndId(`weapon-dice:${i}`))?.value), i);
  } catch (error) {
    return (error as Error).message;
  }
}
