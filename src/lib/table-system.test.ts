import { expect, it } from 'vitest';
import { tableSystem } from './table-system';
import { createMonsterSheet } from './srd-monsters';
import { createDndSheet, dndId } from './dnd';
import { fighterBuilder } from './srd-test-fixtures';

it('changes one monster without changing its source or another instance', () => {
  const rules = tableSystem({});
  const source = createMonsterSheet('monster-aboleth');
  const sibling = structuredClone(source);
  const id = crypto.randomUUID();
  const stocked = rules.changeInventory(source, { type: 'add', id, name: 'Shield' }).sheet;
  const equipped = rules.changeInventory(stocked, { type: 'toggle', id }).sheet;
  expect(rules.armorClass(equipped)).toBe(Number(rules.armorClass(sibling)) + 2);
  expect(rules.numbers(equipped)[dndId('monster:ac')]).toBe(rules.armorClass(equipped));
  expect(source).toEqual(sibling);
  expect(rules.changeInventory(equipped, { type: 'toggle', id }).sheet).toEqual(stocked);
});

it('uses the saved level when resolving the next table roll', () => {
  const rules = tableSystem({});
  const four = rules.applyProgression(createDndSheet(), fighterBuilder(4));
  const five = rules.applyProgression(four, fighterBuilder(5));
  expect(rules.numbers(five)[dndId('pb')]).toBe(3);
  expect(rules.numbers(four)[dndId('pb')]).toBe(2);
  expect(rules.rolls(five).some((r) => r.expression.includes(dndId('weapon-total:0')))).toBe(true);
});
