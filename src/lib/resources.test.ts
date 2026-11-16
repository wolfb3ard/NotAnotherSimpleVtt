import { describe, expect, it } from 'vitest';
import { createDndSheet, dndId } from './dnd';
import {
  groupedHitDice,
  healthChanges,
  playResources,
  previewResources,
  temporaryHpId,
} from './resources';
import { sheetSchema } from './sheets';

describe('play resource previews', () => {
  it('absorbs damage with temporary HP, clamps at zero, and caps healing without consuming temp HP', () => {
    const sheet = previewResources(createDndSheet(), [{ id: temporaryHpId, value: 4 }]);
    const damage = healthChanges(sheet, 7, 'damage');
    expect(damage).toEqual([
      { id: dndId('hp'), value: 7 },
      { id: temporaryHpId, value: 0 },
    ]);
    expect(healthChanges(sheet, 100, 'damage')[0].value).toBe(0);
    expect(healthChanges(sheet, 7, 'damage', false)).toEqual([{ id: dndId('hp'), value: 3 }]);
    expect(healthChanges(sheet, 100, 'heal')).toEqual([{ id: dndId('hp'), value: 10 }]);
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
  });
  it('preserves old sheets and unrelated draft data; temp HP is optional', () => {
    const sheet = createDndSheet();
    const before = structuredClone(sheet);
    expect(playResources(sheet).find((f) => f.id === temporaryHpId)?.value).toBe(0);
    const next = previewResources(sheet, [{ id: dndId('hp'), value: 2 }]);
    expect(sheet).toEqual(before);
    expect(
      next.sections.flatMap((s) => s.fields).find((f) => f.id === temporaryHpId),
    ).toBeUndefined();
  });
  it('supports fractional generic counters, but not arbitrary numeric stats or configuration', () => {
    const sheet = createDndSheet();
    expect(() => previewResources(sheet, [{ id: dndId('ac'), value: 1 }])).toThrow();
    expect(() => previewResources(sheet, [{ id: dndId('hp'), value: 11 }])).toThrow();
    expect(() => previewResources(sheet, [{ id: dndId('hp'), value: NaN }])).toThrow();
    expect(previewResources(sheet, [{ id: dndId('hp'), value: 1.5 }])).toBeDefined();
    for (const amount of [-1, 0.1, Infinity])
      expect(() => healthChanges(sheet, amount, 'damage')).toThrow();
  });
  it('keeps grouped Hit Dice and the summary consistent', () => {
    const sheet = createDndSheet();
    sheet.sections[0].fields.push({
      id: groupedHitDice[0],
      label: 'd6 Hit Dice',
      kind: 'resource',
      value: 1,
      max: 1,
    });
    expect(playResources(sheet).some((f) => f.id === dndId('hit-dice'))).toBe(false);
    const next = previewResources(sheet, [{ id: groupedHitDice[0], value: 0 }]);
    expect(
      next.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('hit-dice'))?.value,
    ).toBe(0);
    expect(() => previewResources(sheet, [{ id: dndId('hit-dice'), value: 0 }])).toThrow(/grouped/);
  });
});
