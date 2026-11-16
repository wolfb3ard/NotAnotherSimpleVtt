import { describe, expect, it } from 'vitest';
import { createDndSheet, dndId, dndDamageExpression } from './dnd';
import { numericFields, sheetSchema } from './sheets';
import { rollDice } from './dice';
import { applySrdBuilder } from './srd-engine';
import {
  armorProfiles,
  deriveEquipment,
  equipmentErrors,
  equipmentPacks,
  equipmentShop,
  shopByKey,
  startingBudget,
  startingInventory,
  startingItemId,
} from './srd-equipment';
import { blankLevel, builderErrors, builderScores } from './srd-state';
import { classBuilder, fighterBuilder, multiclassBuilder } from './srd-test-fixtures';
import { srdClasses } from './srd-rules';
import { emptyCharacterDetails } from './character-details';
import type { Sheet } from './types';

const field = (sheet: Sheet, key: string) =>
  sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId(key))!;
const purchase = (name: string) => ({
  key: equipmentShop.find((offer) => offer.name === name)!.key,
  quantity: 1,
});
describe('source-audited starting equipment', () => {
  it('uses source-indexed variants and table prices without duplicate shop keys', () => {
    expect(shopByKey.size).toBe(equipmentShop.length);
    expect(equipmentShop.find((offer) => offer.name === 'Horse, Riding')?.copper).toBe(7500);
    expect(shopByKey.get('variant:Needles')).toMatchObject({
      name: 'Needles',
      copper: 100,
      quantity: 50,
    });
    expect(equipmentShop.some((offer) => ['Crew', 'Coins', 'Cantrips'].includes(offer.name))).toBe(
      false,
    );
  });
  it('equips a Blowgun and applies its fixed damage to ordinary and critical rolls', () => {
    const state = fighterBuilder();
    state.equipment.purchases = [purchase('Blowgun')];
    state.equipment.weaponIds[0] = startingItemId('Blowgun');
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(field(sheet, 'weapon-dice:0').value).toBe('1');
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
    const ordinary = rollDice(dndDamageExpression('1', 0), [20], numericFields(sheet));
    const critical = rollDice(dndDamageExpression('1', 0, true), [20], numericFields(sheet));
    expect(ordinary.total).toBe(3);
    expect(critical.total).toBe(ordinary.total);
    expect(ordinary.dice).toEqual([]);
  });
  it('grants a Wizard feature spellbook once with gold B or first multiclass acquisition, never replenishing it', () => {
    const wizard = classBuilder('Wizard');
    wizard.classEquipment = 'B';
    expect(startingInventory(wizard).filter((item) => item.name === 'Spellbook')).toHaveLength(1);
    const state = multiclassBuilder();
    const step = state.levels.pop()!;
    expect(step.className).toBe('Wizard');
    const before = applySrdBuilder(createDndSheet(), state);
    state.levels.push(step);
    const next = applySrdBuilder(before, state);
    const book = next.character!.items.find((item) => item.name === 'Spellbook')!;
    expect(book.quantity).toBe(1);
    book.quantity = 0;
    expect(
      applySrdBuilder(next, state).character!.items.find((item) => item.id === book.id)!.quantity,
    ).toBe(0);
  });
  it('has explicit pack contents, all 12 class packages and gold alternatives, not heading-count completeness', () => {
    expect(Object.keys(equipmentPacks)).toHaveLength(7);
    for (const name of srdClasses)
      for (const choice of name === 'Fighter'
        ? (['A', 'B', 'C'] as const)
        : (['A', 'B'] as const)) {
        const state = classBuilder(name);
        state.classEquipment = choice;
        const items = startingInventory(state);
        expect(equipmentErrors(state), `${name} ${choice}`).toEqual([]);
        expect(
          items.every(
            (item) => !item.name.endsWith(' Pack') && item.quantity > 0 && item.quantity <= 999,
          ),
        ).toBe(true);
        expect(items.some((item) => item.name === 'Gold Pieces')).toBe(true);
      }
    const state = fighterBuilder(),
      items = startingInventory(state);
    expect(items.find((item) => item.name === 'Javelin')?.quantity).toBe(8); // PDF47
    expect(items.find((item) => item.name === 'Arrows')?.quantity).toBe(20); // PDF83
    expect(items.find((item) => item.name === 'Rations')?.quantity).toBe(10); // PDF97
    expect(items.find((item) => item.name === 'Torch')?.quantity).toBe(10);
    expect(items.find((item) => item.name === 'Gold Pieces')?.quantity).toBe(18); // class4+background14
    expect(startingBudget(state).grantedCopper).toBe(1800);
    expect(Object.keys(armorProfiles)).toHaveLength(12); // body armor; Shield is separate
  });
  it('expands Bard/Monk variant choices and exact duplicate quantities', () => {
    const bard = classBuilder('Bard');
    bard.equipment.instrument = '';
    expect(builderErrors(bard).join()).toContain('Musical Instrument');
    bard.equipment.instrument = 'Lute';
    expect(
      startingInventory(bard).some((item) => item.name === 'Lute' && item.quantity === 1),
    ).toBe(true);
    const monk = classBuilder('Monk');
    expect(
      startingInventory(monk).some((item) => item.name === monk.levels[0].choices['monk-tool'][0]),
    ).toBe(true);
    const rogue = classBuilder('Rogue');
    rogue.background = 'Criminal';
    rogue.backgroundBoosts = [0, 2, 1, 0, 0, 0];
    rogue.tools = [];
    expect(startingInventory(rogue).find((item) => item.name === 'Dagger')?.quantity).toBe(4);
  });
  it('spends exact printed prices and keeps actual ammo quantities, rejecting forged/over-budget purchases', () => {
    const state = fighterBuilder();
    state.classEquipment = 'C';
    state.backgroundEquipment = 'B';
    state.equipment.purchases = [purchase('Leather Armor'), { key: 'variant:Arrows', quantity: 3 }];
    expect(startingBudget(state)).toEqual({
      grantedCopper: 20500,
      spentCopper: 1300,
      remainingCopper: 19200,
    });
    expect(startingInventory(state).find((item) => item.name === 'Arrows')?.quantity).toBe(60);
    expect(startingInventory(state).find((item) => item.name === 'Gold Pieces')?.quantity).toBe(
      192,
    );
    state.equipment.purchases = [purchase('Plate Armor')];
    expect(equipmentErrors(state).join()).toContain('exceed');
    state.equipment.purchases = [{ key: 'forged-free-plate', quantity: 1 }];
    expect(equipmentErrors(state).join()).toContain('priced SRD');
    expect(shopByKey.get('variant:Sling Bullets')?.copper).toBe(4); // PDF96, 20 bullets
  });
});
describe('equipped armor, Shields and ready weapons', () => {
  it('applies eligible Monk Dexterity and Martial Arts dice, but not while wearing armor/a Shield', () => {
    const state = classBuilder('Monk', 5);
    state.baseScores = [8, 15, 13, 10, 14, 12];
    const result = deriveEquipment(state, startingInventory(state), builderScores(state));
    const spear = result.weapons.find((weapon) => weapon?.name === 'Spear')!;
    expect(spear.ability).toBe(1);
    expect(spear.dice).toBe('1d8');
    state.equipment.purchases = [purchase('Shield')];
    const shielded = deriveEquipment(
      state,
      startingInventory(state),
      builderScores(state),
    ).weapons.find((weapon) => weapon?.name === 'Spear')!;
    expect(shielded.ability).toBe(0);
    expect(shielded.dice).toBe('1d6');
  });
  it('applies Heavy armor, Defense and Shield once; reports Strength/Stealth requirements', () => {
    const state = fighterBuilder();
    state.baseScores = [8, 15, 14, 13, 12, 10];
    state.backgroundBoosts = [2, 1, 0, 0, 0, 0];
    state.equipment.purchases = [purchase('Shield')];
    const items = startingInventory(state),
      result = deriveEquipment(state, items, builderScores(state));
    expect(result.ac).toBe(19);
    expect(result.speed).toBe(20);
    expect(result.warnings.join()).toContain('Strength 13');
    expect(result.warnings.join()).toContain('Stealth');
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(field(sheet, 'ac').value).toBe(19);
    expect(field(sheet, 'speed').value).toBe(20);
    state.equipment.shieldId = '';
    state.equipment.armorId = '';
    const unequipped = applySrdBuilder(sheet, state);
    expect(field(unequipped, 'ac').value).toBe(13);
    expect(field(unequipped, 'speed').value).toBe(30);
    expect(unequipped.character?.items.find((item) => item.name === 'Chain Mail')?.quantity).toBe(
      1,
    );
  });
  it('does not give an untrained Wizard a Shield bonus and clearly reports armor spellcasting restriction', () => {
    const state = classBuilder('Wizard');
    state.backgroundEquipment = 'B';
    state.baseScores = [8, 15, 14, 13, 12, 10];
    state.backgroundBoosts = [2, 1, 0, 0, 0, 0];
    state.equipment.purchases = [purchase('Leather Armor'), purchase('Shield')];
    const result = deriveEquipment(state, startingInventory(state), builderScores(state));
    expect(result.ac).toBe(14);
    expect(result.cannotCast).toBe(true);
    expect(result.warnings.join()).toContain('cannot cast spells');
    expect(result.warnings.join()).toContain('no AC benefit');
  });
  it('chooses one eligible Unarmored Defense formula, never stacking them or using Monk defense with a Shield', () => {
    const state = classBuilder('Barbarian');
    state.abilityMethod = 'point-buy';
    state.baseScores = [13, 13, 14, 8, 13, 13];
    state.levels.push(blankLevel('Monk'));
    expect(builderErrors(state)).toEqual([]);
    expect(deriveEquipment(state, startingInventory(state), builderScores(state)).ac).toBe(14);
    state.equipment.purchases = [purchase('Shield')];
    const withShield = deriveEquipment(state, startingInventory(state), builderScores(state));
    expect(withShield.ac).toBe(16);
    expect(withShield.formula).toContain('Barbarian');
  });
  it('configures Wizard Simple weapons and explicitly clears unused template Longswords', () => {
    const state = classBuilder('Wizard');
    state.baseScores = [8, 12, 13, 15, 14, 10];
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(field(sheet, 'weapon-name:0').value).toBe('Dagger');
    expect(field(sheet, 'weapon-dice:0').value).toBe('1d4');
    expect(field(sheet, 'weapon-type:0').value).toBe('Piercing');
    expect(field(sheet, 'weapon-ability:0').value).toBe(1);
    expect(field(sheet, 'weapon-prof:0').value).toBe(1);
    expect(
      sheet.sections
        .flatMap((s) => s.fields)
        .filter((f) => f.label === 'Weapon / spell name')
        .every((f) => f.value !== 'Longsword'),
    ).toBe(true);
    state.classEquipment = 'B';
    state.backgroundEquipment = 'B';
    const empty = applySrdBuilder(createDndSheet(), state);
    expect(field(empty, 'weapon-name:0').value).toBe('Unequipped');
    expect(field(empty, 'weapon-prof:0').value).toBe(0);
  });
  it('sets proficiency honestly for selected manual weapons and preserves annotations, bonuses, currency and consumed items', () => {
    const state = classBuilder('Wizard'),
      base = createDndSheet();
    base.character = emptyCharacterDetails();
    const id = dndId('test:manual-longsword');
    base.character.items.push({
      id,
      name: 'Longsword',
      quantity: 1,
      rarity: 'Common',
      description: 'Family sword; keep this note',
      requiresAttunement: false,
      attuned: false,
    });
    state.equipment.weaponIds[0] = id;
    const sheet = applySrdBuilder(base, state);
    expect(field(sheet, 'weapon-prof:0').value).toBe(0);
    expect(sheet.character?.items.find((item) => item.id === id)?.description).toContain(
      'Family sword',
    );
    const fighter = fighterBuilder(),
      first = applySrdBuilder(createDndSheet(), fighter);
    first.character!.items.find((item) => item.id === startingItemId('Rations'))!.quantity = 3;
    first.character!.items.find((item) => item.name === 'Gold Pieces')!.quantity = 7;
    field(first, 'ac').value = 19;
    field(first, 'speed').value = 35;
    field(first, 'weapon-hit:0').value = 3;
    const next = applySrdBuilder(first, fighterBuilder(4));
    expect(next.character?.items.find((item) => item.name === 'Rations')?.quantity).toBe(3);
    expect(next.character?.items.find((item) => item.name === 'Gold Pieces')?.quantity).toBe(7);
    expect(field(next, 'ac').value).toBe(19);
    expect(field(next, 'speed').value).toBe(35);
    expect(field(next, 'weapon-hit:0').value).toBe(3);
  });
  it('offers a truly manual AC/Speed and attack-slot escape hatch for homebrew', () => {
    const state = fighterBuilder(),
      base = createDndSheet();
    state.equipment.acMode = 'manual';
    state.equipment.weaponIds = ['', '', ''];
    field(base, 'ac').value = 25;
    field(base, 'speed').value = 45;
    field(base, 'weapon-name:0').value = 'Homebrew laser';
    const sheet = applySrdBuilder(base, state);
    expect(field(sheet, 'ac').value).toBe(25);
    expect(field(sheet, 'speed').value).toBe(45);
    expect(field(sheet, 'weapon-name:0').value).toBe('Homebrew laser');
  });
  it('adopts existing manual gear without granting duplicate starting items or currency', () => {
    const state = fighterBuilder(),
      base = createDndSheet();
    base.character = emptyCharacterDetails();
    base.character.items.push({
      id: dndId('existing:coins'),
      name: 'Gold Pieces',
      quantity: 13,
      description: 'Earned earlier',
      rarity: 'Common',
      requiresAttunement: false,
      attuned: false,
    });
    state.equipment.grantStarting = false;
    state.equipment.acMode = 'manual';
    state.equipment.weaponIds = ['', '', ''];
    const next = applySrdBuilder(base, state);
    expect(next.character?.items).toEqual(base.character.items);
    expect(startingBudget(state).grantedCopper).toBe(0);
  });
});
