import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classBuilder,
  fighterBuilder,
  magicInitiateBuilder,
  multiclassBuilder,
  warlockTomeBuilder,
} from './srd-test-fixtures';
import { srdClasses } from './srd-rules';
import { applySrdBuilder } from './srd-engine';
import { createDndSheet, dndId } from './dnd';
import { blankFeat, blankLevel } from './srd-state';
import { equipmentShop, pactConjuredId } from './srd-equipment';
import { emptyCharacterDetails } from './character-details';
import { srdEntry } from './srd-catalog';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create function public.valid_sheet(jsonb) returns boolean language sql immutable as $$ select true $$;
    create table public.actors(sheet jsonb constraint actors_valid_sheet check(public.valid_sheet(sheet)));
    create table public.templates(sheet jsonb constraint templates_valid_sheet check(public.valid_sheet(sheet)));
  `);
  const migration = readFileSync(
    new URL('../../supabase/migrations/202611150004_srd_builder.sql', import.meta.url),
    'utf8',
  );
  try {
    await db.exec(migration);
  } catch (error) {
    const detail = error as { position?: number; where?: string };
    throw new Error(
      `${(error as Error).message}: ${detail.where}; near ${migration.slice(Number(detail.position) - 200, Number(detail.position) + 100)}`,
    );
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function valid(value: unknown) {
  try {
    return (
      await db.query<{ valid: boolean }>('select public.valid_srd_builder($1::jsonb) as valid', [
        JSON.stringify(value),
      ])
    ).rows[0].valid;
  } catch (error) {
    throw new Error(`${(error as Error).message}; ${(error as { where?: string }).where}`);
  }
}
describe('database SRD boundary', () => {
  it('validates required Druid forms and source-specific familiars at the SQL boundary', async () => {
    const state = classBuilder('Druid', 4);
    expect(await valid(state)).toBe(true);
    delete state.levels[1].choices['wild-shape-forms'];
    expect(await valid(state)).toBe(true);
    const missing = structuredClone(state);
    delete missing.levels[3].choices['wild-shape-forms'];
    expect(await valid(missing)).toBe(false);
    const flying = structuredClone(state);
    flying.levels[3].choices['wild-shape-forms'][0] = 'shape-giant-fly';
    expect(await valid(flying)).toBe(false);
    state.companions.familiarMode = 'wild-companion';
    state.companions.familiarForm = 'shape-cat';
    expect(await valid(state)).toBe(true);
    state.companions.familiarType = 'Fiend';
    expect(await valid(state)).toBe(false);
    state.companions.familiarType = 'Fey';
    state.companions.familiarForm = 'shape-imp';
    expect(await valid(state)).toBe(false);
    const chain = classBuilder('Warlock');
    chain.levels[0].options = [srdEntry('option', 'Pact of the Chain')!.id];
    chain.companions.familiarMode = 'pact-chain';
    chain.companions.familiarForm = 'shape-imp';
    expect(await valid(chain)).toBe(true);
  });
  it('validates conjured and owned ranged Pact bonds, rejecting missing and mundane targets', async () => {
    const state = classBuilder('Warlock');
    state.levels[0].options = [srdEntry('option', 'Pact of the Blade')!.id];
    state.companions.pactWeapon = 'Greatsword';
    state.companions.pactActive = true;
    const sheet = applySrdBuilder(createDndSheet(), state);
    const check = async (value: unknown) =>
      (
        await db.query<{ valid: boolean }>('select public.valid_sheet($1::jsonb) as valid', [
          JSON.stringify(value),
        ])
      ).rows[0].valid;
    expect(await check(sheet)).toBe(true);
    const missing = structuredClone(sheet);
    missing.character!.items = missing.character!.items.filter(
      (item) => item.id !== pactConjuredId,
    );
    expect(await check(missing)).toBe(false);
    const invalidAbility = applySrdBuilder(createDndSheet(), classBuilder('Warlock'));
    invalidAbility.character!.builder!.equipment.weaponAbilities[0] = 1;
    expect(await check(invalidAbility)).toBe(false);
    const base = createDndSheet();
    base.character = emptyCharacterDetails();
    const id = dndId('sql:magic-longbow');
    base.character.items.push({
      id,
      name: 'Longbow +1',
      quantity: 1,
      description: '',
      rarity: 'Uncommon',
      requiresAttunement: false,
      attuned: false,
    });
    state.companions.pactWeapon = '';
    state.companions.pactOwnedId = id;
    const owned = applySrdBuilder(base, state);
    expect(await check(owned)).toBe(true);
    owned.character!.items.find((item) => item.id === id)!.name = 'Longbow';
    owned.character!.items.find((item) => item.id === id)!.rarity = 'Common';
    expect(await check(owned)).toBe(false);
  });
  it('rejects forged equipment purchases, inventory references, and spell-source abilities', async () => {
    const state = magicInitiateBuilder(),
      sheet = applySrdBuilder(createDndSheet(), state);
    const check = async (value: unknown) =>
      (
        await db.query<{ valid: boolean }>('select public.valid_sheet($1::jsonb) as valid', [
          JSON.stringify(value),
        ])
      ).rows[0].valid;
    expect(await check(sheet)).toBe(true);
    const ability = structuredClone(sheet);
    ability.character!.spells.find((spell) => spell.name === 'Fire Bolt')!.casting![0].ability = 3;
    expect(await check(ability)).toBe(false);
    const missing = structuredClone(sheet);
    missing.character!.builder!.equipment.armorId = '12345678-1234-4123-8123-123456789abc';
    expect(await check(missing)).toBe(false);
    const costly = structuredClone(state);
    costly.equipment.purchases = [
      { key: equipmentShop.find((offer) => offer.name === 'Plate Armor')!.key, quantity: 1 },
    ];
    expect(await valid(costly)).toBe(false);
  });
  it('enforces Magic Initiate changes at the actor update boundary, not just the application helper', async () => {
    const state = magicInitiateBuilder(),
      old = applySrdBuilder(createDndSheet(), state),
      id = state.humanFeat!.id;
    await db.query('insert into actors values($1::jsonb)', [JSON.stringify(old)]);
    const changed = structuredClone(state);
    changed.humanFeat!.spells[0] = srdEntry('spell', 'Ray of Frost')!.id;
    const snapshot = applySrdBuilder(createDndSheet(), changed);
    expect(
      (
        await db.query<{ valid: boolean }>('select public.valid_sheet($1::jsonb) as valid', [
          JSON.stringify(snapshot),
        ])
      ).rows[0].valid,
    ).toBe(true);
    await expect(
      db.query(
        "update actors set sheet=$1::jsonb where sheet->'character'->'builder'->'humanFeat'->>'id'=$2",
        [JSON.stringify(snapshot), id],
      ),
    ).rejects.toThrow(/Illegal SRD progression/);
    const nextLevel = blankLevel('Fighter');
    nextLevel.mastery = [...state.levels[0].mastery];
    changed.levels.push(nextLevel);
    const next = applySrdBuilder(old, changed);
    await expect(
      db.query(
        "update actors set sheet=$1::jsonb where sheet->'character'->'builder'->'humanFeat'->>'id'=$2",
        [JSON.stringify(next), id],
      ),
    ).resolves.toBeDefined();
  });
  it('validates complete generated inventory/loadouts and source casting metadata for every class', async () => {
    for (const name of srdClasses)
      for (const level of [1, 3, 20]) {
        const sheet = applySrdBuilder(createDndSheet(), classBuilder(name, level));
        const result = await db.query<{ valid: boolean }>(
          'select public.valid_sheet($1::jsonb) as valid',
          [JSON.stringify(sheet)],
        );
        expect(result.rows[0].valid, `${name} ${level} complete sheet`).toBe(true);
      }
  });
  it('checks nested Tome/invocation choices without losing legitimate repeatable selections', async () => {
    const state = warlockTomeBuilder();
    expect(await valid(state)).toBe(true);
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(
      (
        await db.query<{ valid: boolean }>('select public.valid_sheet($1::jsonb) as valid', [
          JSON.stringify(sheet),
        ])
      ).rows[0].valid,
    ).toBe(true);
    const id = srdEntry('option', 'Agonizing Blast')!.id;
    state.levels[1].choices[id] = ['Fire Bolt', 'Fire Bolt'].map(
      (name) => srdEntry('spell', name)!.id,
    );
    expect(await valid(state)).toBe(false);
  });
  it('accepts legitimate multiclass prerequisites and rejects bypassing them', async () => {
    const state = multiclassBuilder();
    expect(await valid(state)).toBe(true);
    state.baseScores = [13, 13, 13, 13, 13, 10];
    expect(await valid(state)).toBe(false);
  });
  it('accepts source-defined progression choices across all classes', async () => {
    for (const name of srdClasses)
      for (const level of [1, 3, 5, 10, 13, 19, 20])
        expect(await valid(classBuilder(name, level)), `${name} ${level}`).toBe(true);
  });
  it('accepts valid creation and all twenty Fighter progression levels', async () => {
    for (let level = 1; level <= 20; level++)
      expect(await valid(fighterBuilder(level)), `Fighter ${level}`).toBe(true);
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder());
    await expect(
      db.query('insert into actors values ($1::jsonb)', [JSON.stringify(sheet)]),
    ).resolves.toBeDefined();
  });
  it('rejects forged feats, option grants, scores, and choices without trusting app validation', async () => {
    for (const edit of [
      (s: ReturnType<typeof fighterBuilder>) => {
        s.baseScores = [18, 18, 18, 18, 18, 18];
      },
      (s: ReturnType<typeof fighterBuilder>) => {
        s.levels[0].feat = blankFeat(srdEntry('feat', 'Boon of Fate')!.id);
      },
      (s: ReturnType<typeof fighterBuilder>) => {
        s.levels[0].choices['forged'] = ['fake'];
      },
      (s: ReturnType<typeof fighterBuilder>) => {
        s.levels[0].options = ['option-devouring-blade'];
      },
      (s: ReturnType<typeof fighterBuilder>) => {
        s.levels[0].skills = ['Not a skill', 'Insight'];
      },
      (s: ReturnType<typeof fighterBuilder>) => {
        s.levels[0].hp = 999;
      },
    ]) {
      const state = fighterBuilder();
      edit(state);
      expect(await valid(state)).toBe(false);
      const sheet = applySrdBuilder(createDndSheet(), fighterBuilder());
      sheet.character!.builder = state;
      await expect(
        db.query('insert into templates values ($1::jsonb)', [JSON.stringify(sheet)]),
      ).rejects.toThrow(/check constraint/);
    }
  });
  it('leaves sheets without the extension alone', async () => {
    expect(
      (
        await db.query<{ valid: boolean }>('select public.valid_sheet($1::jsonb) as valid', [
          JSON.stringify(createDndSheet()),
        ])
      ).rows[0].valid,
    ).toBe(true);
  });
});
