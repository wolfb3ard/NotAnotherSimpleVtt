import { expect, it } from 'vitest';
import { createDndSheet, dndId } from './dnd';
import { createMonsterSheet } from './srd-monsters';
import { initiativeInput, initiativeExpression } from './initiative';
import { encounterCommandSchema } from './encounter-commands';
import { rollDice } from './dice';

it('uses computed PC initiative and printed monster initiative, not Dexterity alone', () => {
  const pc = createDndSheet();
  const input = initiativeInput(pc);
  expect(input.expression).toContain(dndId('initiative'));
  expect(initiativeInput(createMonsterSheet('monster-aboleth')).expression).toBe('1d20 + 7');
  expect(rollDice('1d20 + 7', [20], {}, () => 10).total).toBe(17);
});
it('requires explicit manual input for a generic or summoner-dependent sheet without initiative', () => {
  expect(initiativeExpression({ version: 1, sections: [] })).toBeUndefined();
  expect(() => initiativeInput(createMonsterSheet('monster-animated-object'))).toThrow(
    /manual total/,
  );
});
it('validates scoped commands, finite scores and unique participants', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const start = {
    action: 'start',
    scene_id: id,
    operation_id: id,
    participants: [{ token_id: id, initiative: null }],
  };
  expect(encounterCommandSchema.safeParse(start).success).toBe(true);
  expect(encounterCommandSchema.parse({ ...start, scene_id: id.toUpperCase() }).scene_id).toBe(id);
  expect(
    encounterCommandSchema.safeParse({
      ...start,
      participants: [...start.participants, ...start.participants],
    }).success,
  ).toBe(false);
  expect(
    encounterCommandSchema.safeParse({
      ...start,
      participants: [...start.participants, { token_id: id.toUpperCase(), initiative: 2 }],
    }).success,
  ).toBe(false);
  expect(
    encounterCommandSchema.safeParse({
      ...start,
      participants: [{ token_id: id, initiative: Infinity }],
    }).success,
  ).toBe(false);
  expect(encounterCommandSchema.safeParse({ ...start, hidden: false }).success).toBe(false);
});
