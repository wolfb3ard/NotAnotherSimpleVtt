import { describe, expect, it } from 'vitest';
import {
  createMonsterSheet,
  monsterById,
  monsterSource,
  srdMonsters,
  monsterSpells,
} from './srd-monsters';
import { sheetSchema } from './sheets';
import { numericFields } from './sheets';
import { rollDice } from './dice';
import { healthChanges, previewResources } from './resources';

describe('complete PDF monster library', () => {
  it('includes all 336 blocks, including six spell/item creatures and independent dragon variants', () => {
    expect(srdMonsters).toHaveLength(336);
    for (const name of [
      'animated-object',
      'otherworldly-steed',
      'giant-insect',
      'draconic-spirit',
      'giant-fly',
      'avatar-of-death',
      'ancient-red-dragon',
      'adult-red-dragon',
    ])
      expect(monsterById.has(`monster-${name}`)).toBe(true);
  });
  it('builds valid independent sheets for every record without changing source text', () => {
    for (const monster of srdMonsters) {
      const sheet = createMonsterSheet(monster.id);
      expect(sheetSchema.safeParse(sheet).success, monster.name).toBe(true);
      expect(monsterSource(sheet)?.id).toBe(monster.id);
      const source = sheet.sections.find((s) => s.title === 'Published stat block')!;
      expect(source.fields.map((f) => f.value).join('')).toBe(monster.text);
      for (const ability of sheet.sections.flatMap((s) => s.abilities))
        if (ability.expression)
          expect(
            () => rollDice(ability.expression, [4, 6, 8, 10, 12, 20, 100], numericFields(sheet)),
            `${monster.name}: ${ability.name}`,
          ).not.toThrow();
    }
  });
  it('keeps printed modifiers, saves, attack and multiple damage components rather than PC calculations', () => {
    const sheet = createMonsterSheet('monster-aboleth');
    const abilities = sheet.sections.flatMap((s) => s.abilities);
    expect(abilities.find((a) => a.name === 'Dex save')?.expression).toBe('1d20 + 3');
    expect(abilities.find((a) => a.name === 'Tentacle · Attack')?.expression).toBe('1d20 + 9');
    expect(abilities.find((a) => a.name === 'Tentacle · Damage 1')?.expression).toBe('2d6 + 5');
    expect(abilities.find((a) => a.name === 'Tentacle · Critical damage 1')?.expression).toBe(
      '4d6 + 5',
    );
    const imp = createMonsterSheet('monster-imp').sections.flatMap((s) => s.abilities);
    expect(imp.filter((a) => a.name.startsWith('Sting · Damage'))).toHaveLength(2);
    expect(
      createMonsterSheet('monster-spy')
        .sections.flatMap((s) => s.abilities)
        .find((a) => a.name === 'Sleight of Hand')?.expression,
    ).toBe('1d20 + 4');
    expect(
      createMonsterSheet('monster-weasel')
        .sections.flatMap((s) => s.abilities)
        .find((a) => a.name === 'Bite · Damage 1')?.expression,
    ).toBe('1');
  });
  it('exposes all printed spells, including spells outside a Spellcasting entry', () => {
    expect(monsterSpells(monsterById.get('monster-balor')!)).toEqual([]);
    expect(monsterSpells(monsterById.get('monster-incubus')!).map((s) => s.entry.name)).toEqual(
      expect.arrayContaining(['Dream', 'Disguise Self', 'Etherealness', 'Hypnotic Pattern']),
    );
    expect(
      monsterSpells(monsterById.get('monster-imp')!).some((s) => s.entry.name === 'Invisibility'),
    ).toBe(true);
    const fields = createMonsterSheet('monster-incubus').sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f.label === 'Dream uses')?.max).toBe(1);
    expect(fields.find((f) => f.label === 'Nightmare (Recharge 6) uses')?.max).toBe(1);
  });
  it('uses printed spell attack/DC and explicitly printed higher-level versions', () => {
    const hag = createMonsterSheet('monster-green-hag');
    expect(
      hag.sections
        .flatMap((s) => s.abilities)
        .find((a) => a.name === 'Ray of Sickness · Spell attack')?.expression,
    ).toBe('1d20 + 4');
    expect(
      hag.sections.flatMap((s) => s.abilities).find((a) => a.name === 'Ray of Sickness · Dice 1')
        ?.expression,
    ).toBe('4d8');
    const mage = createMonsterSheet('monster-archmage');
    expect(
      mage.sections.flatMap((s) => s.abilities).find((a) => a.name === 'Cone of Cold · Dice 1')
        ?.expression,
    ).toBe('12d8');
    expect(
      mage.sections.flatMap((s) => s.fields).find((f) => f.label === 'Cone of Cold save DC')?.value,
    ).toBe(17);
  });
  it('tracks HP, temporary HP and counters through existing atomic resource controls', () => {
    const a = createMonsterSheet('monster-aboleth'),
      b = createMonsterSheet('monster-aboleth');
    const changes = healthChanges(a, 12, 'damage');
    const damaged = previewResources(a, changes);
    expect(damaged.sections.flatMap((s) => s.fields).find((f) => f.label === 'HP')?.value).toBe(
      138,
    );
    expect(b.sections.flatMap((s) => s.fields).find((f) => f.label === 'HP')?.value).toBe(150);
    expect(() => createMonsterSheet('missing')).toThrow(/Unknown/);
  });
});
