import { expect, it } from 'vitest';
import { emptyCharacterDetails } from './character-details';
import { createDndSheet, dndId } from './dnd';
import { castChoices, hitDieId, restChanges, slotId } from './play-assistance';
import { applySrdBuilder } from './srd-engine';
import { classBuilder, multiclassBuilder } from './srd-test-fixtures';
import type { Sheet } from './types';

const field = (sheet: Sheet, id: string) =>
  sheet.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
const pool = (name: string) => dndId(`srd-resource:${name}`);
const values = (changes: ReturnType<typeof restChanges>) =>
  Object.fromEntries(changes.map((c) => [c.id, c.value]));

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
