import { describe, expect, it } from 'vitest';
import { createDndSheet, dndId } from './dnd';
import { srdEntry } from './srd-catalog';
import { applySrdBuilder } from './srd-engine';
import { pactConjuredId } from './srd-equipment';
import { builderErrors } from './srd-state';
import { classBuilder } from './srd-test-fixtures';
import {
  companionErrors,
  eligibleWildShapes,
  familiarShapes,
  srdShapes,
  wildShapeLimits,
} from './srd-shapes';
import { sheetSchema } from './sheets';
import type { Sheet } from './types';
import { emptyCharacterDetails } from './character-details';

const field = (sheet: Sheet, key: string) =>
  sheet.sections.flatMap((section) => section.fields).find((entry) => entry.id === dndId(key))!;
function blade() {
  const state = classBuilder('Warlock');
  state.levels[0].options = [srdEntry('option', 'Pact of the Blade')!.id];
  state.companions.pactWeapon = 'Greatsword';
  state.companions.pactActive = true;
  state.companions.pactDamage = 'Radiant';
  return state;
}
describe('sourced forms and companions', () => {
  it('enforces Druid count/CR/Fly at class levels 2, 4 and 8, retaining Giant Fly provenance', () => {
    expect(wildShapeLimits(2)).toEqual({ count: 4, cr: 0.25, fly: false });
    expect(wildShapeLimits(4)).toEqual({ count: 6, cr: 0.5, fly: false });
    expect(wildShapeLimits(8)).toEqual({ count: 8, cr: 1, fly: true });
    for (const level of [2, 4, 8]) {
      const limits = wildShapeLimits(level);
      expect(
        eligibleWildShapes(level).every(
          (shape) => shape.cr <= limits.cr && (!shape.fly || limits.fly) && !shape.swarm,
        ),
      ).toBe(true);
    }
    expect(srdShapes.find((shape) => shape.name === 'Giant Fly')).toMatchObject({
      page: 222,
      cr: 0,
      fly: true,
    });
    expect(eligibleWildShapes(2).some((shape) => shape.name === 'Giant Fly')).toBe(false);
    expect(eligibleWildShapes(8).some((shape) => shape.name === 'Giant Fly')).toBe(true);
    const state = classBuilder('Druid', 4);
    delete state.levels[1].choices['wild-shape-forms'];
    expect(builderErrors(state)).toEqual([]);
    delete state.levels[3].choices['wild-shape-forms'];
    expect(builderErrors(state).join()).toContain('Wild Shape');
  });
  it('distinguishes Chain specials and Fey Wild Companion without transforming the actor', () => {
    expect(familiarShapes().some((shape) => shape.name === 'Imp')).toBe(false);
    expect(familiarShapes(true).filter((shape) => shape.pactChain)).toHaveLength(7);
    const state = classBuilder('Druid', 2);
    state.companions.familiarMode = 'wild-companion';
    state.companions.familiarForm = familiarShapes()[0].id;
    state.companions.familiarType = 'Fiend';
    expect(companionErrors(state).join()).toContain('Fey');
    state.companions.familiarType = 'Fey';
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
    expect(field(sheet, 'score:0').value).toBe(state.baseScores[0] + state.backgroundBoosts[0]);
    expect(sheet.character!.features.some((entry) => entry.name.startsWith('Wild Shape ·'))).toBe(
      true,
    );
    expect(
      sheet.character!.features.some((entry) => entry.name.startsWith('Familiar preset ·')),
    ).toBe(true);
  });
});
describe('active Pact weapon configuration', () => {
  it('conjures exactly one separate weapon, applies Charisma/proficiency/damage, and archives it on deactivation', () => {
    const state = blade();
    expect(builderErrors(state)).toEqual([]);
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
    expect(field(sheet, 'weapon-name:0').value).toBe('Greatsword (Conjured Pact)');
    expect(field(sheet, 'weapon-ability:0').value).toBe(5);
    expect(field(sheet, 'weapon-prof:0').value).toBe(1);
    expect(field(sheet, 'weapon-type:0').value).toBe('Radiant');
    expect(field(sheet, 'weapon-dice:0').value).toBe('2d6');
    sheet.character!.items.find((item) => item.name === 'Gold Pieces')!.quantity = 0;
    sheet.character!.items.find((item) => item.id === pactConjuredId)!.description +=
      '\nPersonal note';
    const repeated = applySrdBuilder(sheet, state);
    expect(repeated.character!.items.filter((item) => item.id === pactConjuredId)).toHaveLength(1);
    expect(repeated.character!.items.find((item) => item.name === 'Gold Pieces')!.quantity).toBe(0);
    state.companions.pactActive = false;
    const inactive = applySrdBuilder(repeated, state);
    expect(inactive.character!.items.find((item) => item.id === pactConjuredId)).toMatchObject({
      quantity: 0,
    });
    expect(
      inactive.character!.items.find((item) => item.id === pactConjuredId)!.description,
    ).toContain('Personal note');
    expect(field(inactive, 'weapon-ability:0').value).not.toBe(5);
  });
  it('bonds an owned magic ranged weapon without renaming or consuming ordinary inventory', () => {
    const state = blade(),
      sheet = createDndSheet();
    sheet.character = emptyCharacterDetails();
    const id = dndId('test:magic-longbow');
    sheet.character!.items.push({
      id,
      name: 'Longbow +1',
      quantity: 1,
      description: 'Keep note',
      rarity: 'Uncommon',
      requiresAttunement: false,
      attuned: false,
    });
    state.companions.pactWeapon = '';
    state.companions.pactOwnedId = id;
    const next = applySrdBuilder(sheet, state);
    expect(field(next, 'weapon-name:0').value).toBe('Longbow +1');
    expect(field(next, 'weapon-ability:0').value).toBe(5);
    expect(field(next, 'weapon-prof:0').value).toBe(1);
    expect(field(next, 'weapon-hit:0').value).toBe(1);
    expect(next.character!.items.find((item) => item.id === id)).toEqual(
      sheet.character!.items.find((item) => item.id === id),
    );
    state.companions.pactActive = false;
    expect(
      applySrdBuilder(next, state).character!.items.find((item) => item.id === id)!.quantity,
    ).toBe(1);
  });
});
