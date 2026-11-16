import { describe, expect, it } from 'vitest';
import { createDndSheet, dndDamageExpression, dndId, dndNumbers, skills } from './dnd';
import { numericFields, sheetSchema } from './sheets';
import { rollDice } from './dice';
import { applySrdBuilder } from './srd-engine';
import { fighterBuilder, multiclassBuilder } from './srd-test-fixtures';
import { blankFeat } from './srd-state';

describe('SRD 5.2.1 template', () => {
  const sheet = () => createDndSheet();
  function set(s: ReturnType<typeof sheet>, key: string, value: number | string) {
    s.sections.flatMap((s) => s.fields).find((f) => f.id === dndId(key))!.value = value;
  }
  it('fits existing sheets, has unique stable IDs, all skills, saves, resources, and independent copies', () => {
    const s = sheetSchema.parse(sheet());
    expect(s.sections.find((s) => s.id === dndId('skills'))!.abilities).toHaveLength(18);
    expect(s.sections.find((s) => s.id === dndId('saves'))!.abilities).toHaveLength(6);
    expect(sheetSchema.safeParse(s).success).toBe(true);
    set(s, 'level', 20);
    expect(numericFields(sheet())[dndId('pb')]).toBe(2);
    expect(skills).toHaveLength(18);
  });
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
  ])('level %i gives proficiency %i', (level, pb) => {
    const s = sheet();
    set(s, 'level', level);
    set(s, 'pb', 999);
    expect(numericFields(s)[dndId('pb')]).toBe(pb);
  });
  it('applies negative/odd ability modifiers, saves, expertise, half proficiency, bonuses and exhaustion', () => {
    const s = sheet();
    set(s, 'score:0', 9);
    set(s, 'score:1', 17);
    set(s, 'level', 5);
    set(s, 'save-prof:0', 1);
    set(s, 'skill-prof:0', 2);
    set(s, 'skill-prof:16', 0.5);
    set(s, 'save-extra:0', 1);
    set(s, 'exhaustion', 1);
    const n = dndNumbers(s);
    expect(n[dndId('mod:0')]).toBe(-1);
    expect(n[dndId('mod:1')]).toBe(3);
    expect(n[dndId('check:0')]).toBe(-3);
    expect(n[dndId('save:0')]).toBe(1);
    expect(n[dndId('skill:0')]).toBe(7);
    expect(n[dndId('skill:16')]).toBe(2);
  });
  it('weapon attacks add proficiency, damage does not; criticals double dice only and damage cannot be negative', () => {
    const s = sheet();
    set(s, 'score:0', 18);
    set(s, 'level', 9);
    const fields = numericFields(s);
    expect(rollDice(`1d20 + @{${dndId('weapon-total:0')}}`, [20], fields, () => 10).total).toBe(18);
    expect(rollDice(dndDamageExpression('2d6', 0), [6], fields, () => 1).total).toBe(6);
    expect(rollDice(dndDamageExpression('2d6', 0, true), [6], fields, () => 1).total).toBe(8);
    set(s, 'score:0', 1);
    expect(rollDice(dndDamageExpression('1d4', 0), [4], numericFields(s), () => 1).total).toBe(0);
    set(s, 'weapon-add:0', 0);
    expect(rollDice(dndDamageExpression('1d4', 0), [4], numericFields(s), () => 1).total).toBe(1);
  });
  it('rolls fixed damage without inventing dice or doubling flat damage on a critical', () => {
    const s = sheet();
    set(s, 'score:0', 16);
    const ordinary = dndDamageExpression('1', 0);
    const critical = dndDamageExpression('1', 0, true);
    expect(ordinary).toBe(critical);
    expect(rollDice(ordinary, [20], numericFields(s)).total).toBe(4);
    expect(rollDice(critical, [20], numericFields(s)).dice).toEqual([]);
  });
  it('derives spell attacks and DC from the selected spellcasting ability', () => {
    const s = sheet();
    set(s, 'score:5', 18);
    set(s, 'spell-ability', 5);
    set(s, 'level', 5);
    expect(numericFields(s)[dndId('spell-attack')]).toBe(7);
    expect(numericFields(s)[dndId('spell-dc')]).toBe(15);
  });
  it('applies Alert to initiative only, including saved initiative rolls', () => {
    const state = fighterBuilder(5);
    state.humanFeat = blankFeat('feat-alert');
    const s = applySrdBuilder(sheet(), state);
    set(s, 'check-bonus', 1);
    set(s, 'exhaustion', 1);
    const n = numericFields(s);
    expect(n[dndId('initiative')]).toBe(n[dndId('check:1')] + 3);
    const initiative = s.sections
      .flatMap((section) => section.abilities)
      .find((ability) => ability.id === dndId('roll:initiative'))!;
    expect(initiative.expression).toBe(`1d20 + @{${dndId('initiative')}}`);
    expect(rollDice(initiative.expression, [20], n, () => 10).total).toBe(
      10 + n[dndId('initiative')],
    );
  });
  it('recomputes separate multiclass spell modifiers from scores rather than trusting resource values', () => {
    const state = multiclassBuilder();
    state.baseScores = [13, 13, 8, 14, 13, 13];
    const s = applySrdBuilder(sheet(), state);
    const wizard = dndId('srd-resource:spell-attack:Wizard');
    const cleric = dndId('srd-resource:spell-attack:Cleric');
    s.sections.flatMap((section) => section.fields).find((field) => field.id === wizard)!.value =
      999;
    set(s, 'attack-bonus', 3);
    set(s, 'exhaustion', 1);
    const n = numericFields(s);
    expect(n[wizard]).toBe(4 + 2 + 3 - 2);
    expect(n[cleric]).toBe(4 + 1 + 3 - 2);
    expect(n[dndId('srd-resource:spell-dc:Wizard')]).toBe(14);
    expect(n[dndId('srd-resource:spell-dc:Cleric')]).toBe(13);
  });
  it.each([
    ['level', 0],
    ['level', 21],
    ['score:0', 31],
    ['score:0', 1.5],
    ['exhaustion', 7],
    ['save-prof:0', 2],
    ['weapon-dice:0', '1d6 + 100'],
  ])('rejects invalid %s=%s', (key, value) => {
    const s = sheet();
    set(s, String(key), value);
    expect(sheetSchema.safeParse(s).success).toBe(false);
  });
  it('does not reinterpret a generic sheet', () => {
    expect(dndNumbers({ version: 1, sections: [] })).toEqual({});
  });
});
