import { expect, it } from 'vitest';
import { emptyCharacterDetails } from './character-details';
import { createDndSheet, dndId } from './dnd';
import { castChoices, hitDieId, restChanges, slotId } from './play-assistance';
import { applySrdBuilder } from './srd-engine';
import { classBuilder, multiclassBuilder } from './srd-test-fixtures';
import { blankFeat } from './srd-state';
import { srdEntry } from './srd-catalog';
import type { Sheet } from './types';

it('offers a Wizard spellbook ritual without preparation or resource spending', () => {
  const state = classBuilder('Wizard');
  const id = 'spell-detect-magic';
  const step = state.levels[0];
  if (!step.spellbook.includes(id)) step.spellbook[step.spellbook.length - 1] = id;
  step.spells = step.spells.filter((s) => s !== id);
  const sheet = applySrdBuilder(createDndSheet(), state);
  const spell = sheet.character!.spells.find((s) => s.id === dndId(`srd:${id}`))!;
  expect(spell.prepared).toBe(false);
  expect(castChoices(sheet, spell).slice(1)).toEqual([
    expect.objectContaining({
      key: 'class:Wizard:ritual',
      changes: [],
      note: expect.stringContaining('10 minutes'),
    }),
  ]);
});

it('assigns separate lineage uses to the level 3 and level 5 spells', () => {
  const state = classBuilder('Fighter', 5);
  state.species = 'Elf';
  state.lineage = 'High Elf';
  state.speciesCantrip = 'spell-prestidigitation';
  state.speciesSkill = 'Survival';
  delete state.humanFeat;
  const sheet = applySrdBuilder(createDndSheet(), state);
  for (const [name, level] of [
    ['Detect Magic', 3],
    ['Misty Step', 5],
  ] as const) {
    const spell = sheet.character!.spells.find((s) => s.name === name)!;
    expect(castChoices(sheet, spell).find((c) => c.label.includes('Free cast'))?.changes).toEqual([
      { id: pool(`species-spell-${level}`), value: 0 },
    ]);
  }
});

it.each([
  ['Ranger', 1, 'spell-hunter-s-mark', 'hunters-mark'],
  ['Paladin', 5, 'spell-find-steed', 'faithful-steed'],
  ['Warlock', 9, 'spell-contact-other-plane', 'contact-patron'],
  ['Sorcerer', 18, 'spell-summon-dragon', 'dragon-companion'],
] as const)('uses the %s feature pool separately from spell slots', (name, level, spellId, key) => {
  const sheet = applySrdBuilder(createDndSheet(), classBuilder(name, level));
  const spell = sheet.character!.spells.find((s) => s.id === dndId(`srd:${spellId}`))!;
  expect(spell).toBeDefined();
  const available = field(sheet, pool(key));
  const option = () =>
    castChoices(sheet, spell).find((c) => c.changes.some((change) => change.id === available.id));
  expect(option()).toMatchObject({
    available: true,
    changes: [{ id: available.id, value: Number(available.value) - 1 }],
  });
  available.value = 0;
  expect(option()).toMatchObject({ available: false, changes: [{ id: available.id, value: 0 }] });
});

const field = (sheet: Sheet, id: string) =>
  sheet.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
const pool = (name: string) => dndId(`srd-resource:${name}`);
const values = (changes: ReturnType<typeof restChanges>) =>
  Object.fromEntries(changes.map((c) => [c.id, c.value]));

it('keeps Mystic Arcanum separate from Pact Magic and refreshes it on a Long Rest only', () => {
  const sheet = applySrdBuilder(createDndSheet(), classBuilder('Warlock', 11));
  const spell = sheet.character!.spells.find((s) => s.level === 6)!;
  const id = pool('arcanum:6');
  expect(castChoices(sheet, spell).filter((c) => c.changes.length)).toEqual([
    expect.objectContaining({
      label: expect.stringContaining('Mystic Arcanum'),
      changes: [{ id, value: 0 }],
    }),
  ]);
  field(sheet, id).value = 0;
  expect(values(restChanges(sheet, 'short'))[id]).toBeUndefined();
  expect(values(restChanges(sheet, 'long'))[id]).toBe(1);
});

it('offers Spell Mastery at will and restores Signature Spells on a Short Rest', () => {
  const state = classBuilder('Wizard', 20);
  const sheet = applySrdBuilder(createDndSheet(), state);
  const lookup = (id: string) => sheet.character!.spells.find((s) => s.id === dndId(`srd:${id}`))!;
  const mastery = state.levels.findLast((step) => step.choices['spell-mastery'])!.choices[
    'spell-mastery'
  ][0];
  expect(castChoices(sheet, lookup(mastery))).toContainEqual(
    expect.objectContaining({ key: 'class:Wizard:mastery', available: true, changes: [] }),
  );
  const signature = state.levels.at(-1)!.choices['signature-spells'][0];
  const id = pool(`signature:${signature}`);
  expect(castChoices(sheet, lookup(signature))).toContainEqual(
    expect.objectContaining({
      label: expect.stringContaining('Short or Long Rest'),
      changes: [{ id, value: 0 }],
    }),
  );
  field(sheet, id).value = 0;
  expect(values(restChanges(sheet, 'short'))[id]).toBe(1);
});

it('spends a Wild Shape use for Wild Companion without spending a slot', () => {
  const sheet = applySrdBuilder(createDndSheet(), classBuilder('Druid', 2));
  const spell = sheet.character!.spells.find((s) => s.name === 'Find Familiar')!;
  const id = pool('wild-shape');
  const choices = castChoices(sheet, spell);
  expect(choices.find((c) => c.label.startsWith('Wild Companion · Spend'))).toMatchObject({
    changes: [{ id, value: Number(field(sheet, id).value) - 1 }],
    note: expect.stringContaining('Fey'),
  });
  expect(choices.some((c) => c.label.startsWith('Wild Companion · Level 1 spell slot'))).toBe(true);
});

it('offers Magic Initiate once per Long Rest without requiring or spending a spell slot', () => {
  const state = classBuilder('Fighter');
  state.humanFeat = {
    ...blankFeat(srdEntry('feat', 'Magic Initiate')!.id),
    spellList: 'Wizard',
    spellAbility: 3,
    spells: ['Fire Bolt', 'Mage Hand', 'Shield'].map((name) => srdEntry('spell', name)!.id),
  };
  const sheet = applySrdBuilder(createDndSheet(), state);
  const shield = sheet.character!.spells.find((s) => s.name === 'Shield')!;
  const free = () => castChoices(sheet, shield).find((c) => c.label.includes('Free cast'));
  const id = pool('magic-initiate:Wizard');
  expect(free()).toMatchObject({ available: true, changes: [{ id, value: 0 }] });
  field(sheet, id).value = 0;
  expect(free()?.available).toBe(false);
  expect(values(restChanges(sheet, 'short'))[id]).toBeUndefined();
  expect(values(restChanges(sheet, 'long'))[id]).toBe(1);
  const cantrip = sheet.character!.spells.find((s) => s.name === 'Fire Bolt')!;
  expect(castChoices(sheet, cantrip).every((c) => !c.changes.length)).toBe(true);
});

it('offers multiclass casting sources, higher shared slots and separate Pact slots', () => {
  const sheet = applySrdBuilder(createDndSheet(), multiclassBuilder());
  const spell = sheet.character!.spells.find(
    (s) => s.prepared && s.level === 1 && s.casting?.some((c) => c.sourceId === 'class:Warlock'),
  )!;
  const choices = castChoices(sheet, spell);
  expect(choices.some((c) => c.label.startsWith('Warlock · Level 4'))).toBe(true);
  expect(choices).toContainEqual(
    expect.objectContaining({
      label: 'Warlock · Pact Magic level 1 · 1/1 remaining',
      changes: [{ id: pool('pact'), value: 0 }],
    }),
  );
  field(sheet, pool('pact')).value = 0;
  expect(
    castChoices(sheet, spell).find((c) => c.label.startsWith('Warlock · Pact'))?.available,
  ).toBe(false);
  expect(castChoices(sheet, { ...spell, prepared: false })).toHaveLength(1);
});

it('keeps homebrew or untracked spells and rests manual', () => {
  const sheet = createDndSheet();
  const spell = {
    id: dndId('homebrew'),
    name: 'Homebrew',
    description: '',
    level: 1,
    prepared: true,
    actionType: 'Action' as const,
  };
  sheet.character = { ...emptyCharacterDetails(), spells: [spell] };
  Object.assign(field(sheet, slotId(1)), { value: 2, max: 2 });
  expect(castChoices(sheet, spell)).toEqual([
    expect.objectContaining({ key: 'manual', changes: [] }),
  ]);
  expect(() => restChanges(sheet, 'long')).toThrow('requires an SRD builder sheet');
});

it('previews short and long recovery separately and preserves excluded and custom counters', () => {
  const sheet = applySrdBuilder(createDndSheet(), multiclassBuilder());
  const hp = field(sheet, dndId('hp'));
  hp.value = 1;
  field(sheet, pool('pact')).value = 0;
  field(sheet, pool('second-wind')).value = 0;
  field(sheet, slotId(1)).value = 0;
  field(sheet, hitDieId(8)).value = 1;
  sheet.sections[0].fields.push({
    id: dndId('custom'),
    label: 'Homebrew pool',
    kind: 'resource',
    value: 0,
    max: 3,
  });
  const short = values(restChanges(sheet, 'short', { 8: [2] }, new Set([pool('second-wind')])));
  expect(short).toMatchObject({ [pool('pact')]: 1, [hitDieId(8)]: 0 });
  expect(short[hp.id]).toBeGreaterThan(1);
  expect(short[pool('second-wind')]).toBeUndefined();
  expect(short[slotId(1)]).toBeUndefined();
  const long = values(restChanges(sheet, 'long'));
  expect(long).toMatchObject({
    [hp.id]: hp.max,
    [slotId(1)]: 4,
    [hitDieId(8)]: field(sheet, hitDieId(8)).max,
  });
  expect(long[dndId('custom')]).toBeUndefined();
  expect(hp.value).toBe(1);
  expect(() => restChanges(sheet, 'short', { 8: [9] })).toThrow('available d8');
  expect(() => restChanges(sheet, 'short', { 8: [2, 2] })).toThrow('available d8');
});

it('recovers one Second Wind on a short rest and all on a long rest', () => {
  const sheet = applySrdBuilder(createDndSheet(), classBuilder('Fighter', 4));
  const id = pool('second-wind');
  field(sheet, id).value = 0;
  expect(values(restChanges(sheet, 'short'))[id]).toBe(1);
  expect(values(restChanges(sheet, 'long'))[id]).toBe(field(sheet, id).max);
});
