import { expect, it } from 'vitest';
import { commandSchemas } from './commands';
import { dndId } from './dnd';
import { legacySheet, oldInitiative } from './legacy-sheet-fixtures';
import { compatibleSheetSchema, loadCompatibleSheet } from './sheet-compatibility';

it.each(['manual', 'fighter', 'bard'] as const)(
  'upgrades a saved %s without rebuilding it',
  (kind) => {
    const original = legacySheet(kind);
    const before = structuredClone(original);
    const result = loadCompatibleSheet(original);
    expect(result.sheetUpgradeIssue).toBeUndefined();
    const { sheet } = result;
    expect(sheet.compatibilityVersion).toBe(1);
    expect(sheet.sections.map((s) => s.fields)).toEqual(before.sections.map((s) => s.fields));
    expect(sheet.sections[0].abilities[0].expression).toBe(oldInitiative);
    expect(
      sheet.sections.flatMap((s) => s.abilities).find((a) => a.id === dndId('roll:initiative'))
        ?.expression,
    ).toBe(`1d20 + @{${dndId('initiative')}}`);
    if (kind === 'manual') expect(sheet.character?.builder).toBeUndefined();
    else {
      expect(sheet.character?.items).toEqual(before.character?.items);
      expect(sheet.character?.builder?.levels).toEqual(before.character?.builder?.levels);
      expect(sheet.character?.builder?.equipment).toMatchObject({
        acMode: 'manual',
        weaponIds: ['', '', ''],
      });
    }
    expect(compatibleSheetSchema.parse(sheet)).toEqual(sheet);
    expect(original).toEqual(before);
  },
);

it('upgrades through the existing save command without changing custom formulas', () => {
  const sheet = legacySheet('manual');
  const ability = sheet.sections
    .flatMap((s) => s.abilities)
    .find((a) => a.id === dndId('roll:initiative'))!;
  ability.expression = '1d20 + 7';
  const payload = commandSchemas.actor_save.parse({
    id: 'd1364a45-9cdc-42f2-9f43-76a94d342c91',
    name: 'Hero',
    revision: 5,
    sheet,
  });
  expect(payload.revision).toBe(5);
  expect(payload.sheet.compatibilityVersion).toBe(1);
  expect(payload.sheet.sections.flatMap((s) => s.abilities)).toContainEqual(ability);
});

it('retains the original when a legacy sheet cannot be upgraded safely', () => {
  const sheet = legacySheet('manual');
  sheet.sections[0].fields.find((f) => f.id === dndId('level'))!.value = 99;
  expect(loadCompatibleSheet(sheet)).toEqual({ sheet, sheetUpgradeIssue: 'Level must be 1–20.' });
  expect(compatibleSheetSchema.safeParse(sheet).success).toBe(false);
  expect(compatibleSheetSchema.safeParse({ ...sheet, compatibilityVersion: 9 }).success).toBe(
    false,
  );
});

it('hides legacy SRD citations without rewriting player notes or the stored sheet', () => {
  const sheet = loadCompatibleSheet(legacySheet('fighter')).sheet;
  const [item] = sheet.character!.items;
  const [ability] = sheet.sections.flatMap((section) => section.abilities);
  item.description =
    'See p.12 of my journal.\n\nSRD 5.2.1, PDF p. 98–99; catalog: equipment-example. Full text in SRD catalog.\n\nStarting grant/purchase: SRD 5.2.1 class p.47, background p.83. Pack contents are individually expanded from PDF pp.96–99.';
  ability.description = 'Manual casting. SRD p.123.';
  const { sheet: cleaned } = loadCompatibleSheet(sheet);
  expect(cleaned.character?.items[0]?.description).toBe(
    'See p.12 of my journal.\n\nSRD 5.2.1; catalog: equipment-example. Full text in SRD catalog.\n\nStarting grant or purchase. Pack contents are listed individually.',
  );
  expect(cleaned.sections.flatMap((section) => section.abilities)[0].description).toBe(
    'Manual casting.',
  );
  expect(item.description).toContain('PDF p. 98–99');
  expect(loadCompatibleSheet(cleaned).sheet).toBe(cleaned);
});
