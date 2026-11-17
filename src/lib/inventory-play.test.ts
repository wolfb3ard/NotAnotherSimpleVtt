import { expect, it } from 'vitest';
import { additionalShield, changeInventory, inventoryEntries } from './inventory-play';
import { createMonsterSheet } from './srd-monsters';
import { sheetSchema } from './sheets';
import { tableSystem } from './table-system';

const rules = tableSystem({});
const add = (sheet: ReturnType<typeof createMonsterSheet>, name: string) =>
  changeInventory(sheet, { type: 'add', name, id: crypto.randomUUID() }).sheet;

it('tracks supplies and one extra shield on a single monster without altering base AC', () => {
  const printed = createMonsterSheet('monster-aboleth');
  const stocked = add(add(add(printed, 'Shield'), 'Shield'), 'Potion');
  const [first, second, potion] = stocked.character!.items;
  const toggle = (s: typeof printed, id: string) =>
    changeInventory(s, { type: 'toggle', id }).sheet;
  const equipped = toggle(stocked, first.id);
  const swapped = toggle(equipped, second.id);
  expect(rules.armorClass(equipped)).toBe(Number(rules.armorClass(printed)) + 2);
  expect(rules.armorClass(swapped)).toBe(rules.armorClass(equipped));
  expect(
    inventoryEntries(swapped)
      .filter((e) => e.equipped)
      .map((e) => e.item.id),
  ).toEqual([second.id]);
  expect(rules.armorClass(toggle(swapped, second.id))).toBe(rules.armorClass(printed));
  expect(sheetSchema.safeParse(swapped).success).toBe(true);
  expect(
    changeInventory(swapped, { type: 'use', id: potion.id }).sheet.character!.items[2].quantity,
  ).toBe(0);
  expect(potion.quantity).toBe(1);
  expect(printed.character).toBeUndefined();
});

it('keeps an existing extra shield equipped until the GM removes it', () => {
  const printed = createMonsterSheet('monster-aboleth');
  const legacy = structuredClone(printed);
  const stats = legacy.sections[0];
  const ac = stats.fields.find((f) => f.label === 'AC')!;
  ac.value = Number(ac.value) + 2;
  stats.fields.push({
    id: additionalShield,
    label: 'Additional shield equipped',
    kind: 'number',
    value: 1,
  });
  const [entry] = inventoryEntries(legacy);
  expect(entry.equipped).toBe(true);
  const next = changeInventory(legacy, { type: 'toggle', id: entry.item.id }).sheet;
  expect(rules.armorClass(next)).toBe(rules.armorClass(printed));
  expect(next.sections.flatMap((s) => s.fields).some((f) => f.id === additionalShield)).toBe(false);
  expect(inventoryEntries(next)[0].equippable).toBe(true);
});
