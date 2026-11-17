import { expect, it } from 'vitest';
import { createDndSheet, dndDamageExpression, dndId } from './dnd';
import { tokenRolls } from './token-rolls';
import { createMonsterSheet } from './srd-monsters';
import type { Sheet } from './types';

it('uses play-sheet attack, damage and critical formulas from current saved D&D configuration', () => {
  const sheet = createDndSheet();
  const fields = sheet.sections.flatMap((s) => s.fields);
  fields.find((f) => f.id === dndId('weapon-dice:0'))!.value = '2d6';
  fields.find((f) => f.id === dndId('weapon-name:1'))!.value = 'Unequipped';
  const rolls = tokenRolls(sheet);
  expect(rolls.find((r) => r.id === 'attack:0')!.expression).toBe(
    `1d20 + @{${dndId('weapon-total:0')}}`,
  );
  expect(rolls.find((r) => r.id === 'damage:0:false')!.expression).toBe(
    dndDamageExpression('2d6', 0),
  );
  expect(rolls.find((r) => r.id === 'damage:0:true')!.expression).toBe(
    dndDamageExpression('2d6', 0, true),
  );
  expect(rolls.some((r) => r.id === 'attack:1')).toBe(false);
  expect(rolls.some((r) => r.name === 'Spell attack')).toBe(true);
  expect(rolls.some((r) => r.name === 'Initiative')).toBe(false);
});

it('keeps invalid damage manual without hiding attacks or custom saved actions', () => {
  const sheet = createDndSheet();
  sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('weapon-dice:0'))!.value =
    'complex';
  sheet.sections[0].abilities.push({
    id: 'custom',
    name: 'Homebrew',
    expression: '1d20 + 7',
    description: 'Manual rules',
  });
  const rolls = tokenRolls(sheet);
  expect(rolls.find((r) => r.id === 'attack:0')).toBeDefined();
  expect(rolls.find((r) => r.id === 'damage:0:false')).toBeUndefined();
  expect(rolls.find((r) => r.id === 'custom')?.description).toBe('Manual rules');
});

it('preserves generic and customized monster expressions and full rule descriptions', () => {
  const sheet: Sheet = {
    version: 1,
    sections: [
      {
        id: 'section',
        title: 'Actions',
        fields: [],
        abilities: [
          { id: 'attack', name: 'Strike', expression: '1d20 + 5', description: 'One target' },
          { id: 'manual', name: 'Manual', expression: '', description: 'Not automated' },
        ],
      },
    ],
  };
  expect(tokenRolls(sheet)).toEqual([sheet.sections[0].abilities[0]]);
  const monster = createMonsterSheet('monster-goblin-warrior');
  const action = monster.sections
    .flatMap((s) => s.abilities)
    .find((a) => /attack/i.test(a.name) && a.expression)!;
  action.expression = '1d20 + 19';
  const quick = tokenRolls(monster).find((a) => a.id === action.id)!;
  expect(quick.expression).toBe(action.expression);
  expect(quick.description).toContain('Attack Roll');
});
