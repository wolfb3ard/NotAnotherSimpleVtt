import { expect, it } from 'vitest';
import { additionalShield, changeInventory, inventoryEntries } from './inventory-play';
import { createMonsterSheet } from './srd-monsters';
import { sheetSchema } from './sheets';
import { tableSystem } from './table-system';
import { createDndSheet, dndId } from './dnd';
import { applySrdBuilder } from './srd-engine';
import { fighterBuilder } from './srd-test-fixtures';

const rules = tableSystem({});
const add = (sheet: ReturnType<typeof createMonsterSheet>, name: string) =>
  changeInventory(sheet, { type: 'add', name, id: crypto.randomUUID() }).sheet;

it('readies a weapon for rolls, removes it, and restores its bonus exactly once', () => {
  const original = applySrdBuilder(createDndSheet(), fighterBuilder());
  const equipped = inventoryEntries(original).find(
    (e) =>
      e.equipped &&
      e.equippable &&
      e.item.name !== 'Shield' &&
      rules.rolls(original).some((r) => r.name === `Attack roll with ${e.item.name}`),
  )!;
  const freed = changeInventory(original, { type: 'toggle', id: equipped.item.id }).sheet;
  expect(rules.rolls(freed).some((r) => r.name === `Attack roll with ${equipped.item.name}`)).toBe(
    false,
  );
  const id = crypto.randomUUID();
  freed.character!.items.push({
    id,
    name: 'Longsword +1',
    description: '',
    quantity: 1,
    rarity: 'Uncommon',
    requiresAttunement: false,
    attuned: false,
  });
  const ready = changeInventory(freed, { type: 'toggle', id }).sheet;
  const removed = changeInventory(ready, { type: 'toggle', id }).sheet;
  const restored = changeInventory(removed, { type: 'toggle', id }).sheet;
  const attack = rules.rolls(ready).find((r) => r.name === 'Attack roll with Longsword +1')!;
  expect(attack).toBeDefined();
  expect(rules.rolls(removed).some((r) => r.name === attack.name)).toBe(false);
  expect(rules.numbers(restored)[dndId(`weapon-total:${attack.id.split(':')[1]}`)]).toBe(
    rules.numbers(ready)[dndId(`weapon-total:${attack.id.split(':')[1]}`)],
  );
  expect(sheetSchema.safeParse(restored).success).toBe(true);
});

it('tracks additional monster armor and weapons without rewriting printed statistics', () => {
  const printed = createMonsterSheet('monster-aboleth');
  let sheet = add(add(printed, 'Chain Mail'), 'Longsword');
  for (const { id } of sheet.character!.items)
    sheet = changeInventory(sheet, { type: 'toggle', id }).sheet;
  expect(inventoryEntries(sheet).filter((e) => e.equipped)).toHaveLength(2);
  expect(rules.armorClass(sheet)).toBe(rules.armorClass(printed));
  expect(rules.rolls(sheet)).toEqual(rules.rolls(printed));
});

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
