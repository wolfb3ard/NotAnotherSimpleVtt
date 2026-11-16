import { describe, expect, it } from 'vitest';
import { emptyCharacterDetails } from './character-details';
import { createDndSheet, dndId } from './dnd';
import { sheetSchema } from './sheets';
import { srdEntry } from './srd-catalog';
import { applySrdBuilder, deriveSrd } from './srd-engine';
import { blankFeat, blankLevel, builderErrors, builderScores, srdBuilderSchema } from './srd-state';
import {
  classBuilder,
  fighterBuilder,
  multiclassBuilder,
  warlockTomeBuilder,
} from './srd-test-fixtures';
import { srdClasses } from './srd-rules';

describe('guided SRD progression', () => {
  it('validates repeatable invocations and their Pact of the Tome cantrip targets', () => {
    const state = warlockTomeBuilder();
    expect(builderErrors(state)).toEqual([]);
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(
      sheet.character?.spells.some((spell) => spell.name === 'Fire Bolt' && spell.prepared),
    ).toBe(true);
    const id = srdEntry('option', 'Agonizing Blast')!.id;
    state.levels[1].choices[id] = ['Fire Bolt', 'Fire Bolt'].map(
      (name) => srdEntry('spell', name)!.id,
    );
    expect(builderErrors(state).join()).toContain('different known damaging');
  });
  it('records valid generated ability rolls and rejects invented totals', () => {
    const state = fighterBuilder();
    state.abilityMethod = 'point-buy';
    expect(builderErrors(state)).toEqual([]);
    state.abilityMethod = 'rolled';
    state.rolls = [
      [6, 5, 4, 1],
      [6, 4, 4, 1],
      [5, 4, 4, 1],
      [4, 4, 4, 1],
      [4, 3, 3, 1],
      [3, 3, 2, 1],
    ];
    expect(builderErrors(state)).toEqual([]);
    state.rolls[0] = [6, 6, 6, 6];
    expect(builderErrors(state).join()).toContain('Rolled scores must match');
  });
  it('treats always-prepared subclass spells as additional to prepared quotas', () => {
    const state = classBuilder('Cleric', 3);
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(
      sheet.character?.spells.filter((spell) => spell.prepared && spell.level > 0),
    ).toHaveLength(10);
    expect(sheet.character?.spells.some((spell) => spell.name === 'Aid' && spell.prepared)).toBe(
      true,
    );
    state.levels[2].spells[0] = srdEntry('spell', 'Aid')!.id;
    expect(builderErrors(state).join()).toContain('additional to the selection quota');
  });
  it('applies a legal twelve-class build, gaining only multiclass proficiencies and class-level spell choices', () => {
    const state = multiclassBuilder();
    expect(builderErrors(state)).toEqual([]);
    const derived = deriveSrd(state);
    expect(derived.total).toBe(12);
    expect(derived.pb).toBe(4);
    expect(derived.attacks).toBe(1);
    expect(derived.casterLevel).toBe(7);
    expect(derived.pact).toEqual({ count: 1, level: 1 });
    expect(derived.slots).toEqual([4, 3, 3, 1, 0, 0, 0, 0, 0]);
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
    expect(sheet.character?.features.some((feature) => feature.name === 'Extra Attack')).toBe(
      false,
    );
  });
  it.each(srdClasses)('supports legal %s choices and sheet application at every level', (name) => {
    for (let level = 1; level <= 20; level++) {
      const state = classBuilder(name, level);
      expect(builderErrors(state), `${name} ${level}`).toEqual([]);
      expect(
        sheetSchema.safeParse(applySrdBuilder(createDndSheet(), state)).success,
        `${name} ${level} sheet`,
      ).toBe(true);
    }
  });
  it('validates Fighter creation and every level through 20, applying exact grants', () => {
    for (let level = 1; level <= 20; level++) {
      const state = fighterBuilder(level);
      expect(builderErrors(state), `level ${level}`).toEqual([]);
      const sheet = applySrdBuilder(createDndSheet(), state);
      expect(sheetSchema.safeParse(sheet).success).toBe(true);
      expect(sheet.character?.builder?.levels).toHaveLength(level);
      if (level >= 3)
        expect(sheet.character?.features.some((entry) => entry.name === 'Improved Critical')).toBe(
          true,
        );
      if (level < 3)
        expect(sheet.character?.features.some((entry) => entry.name === 'Improved Critical')).toBe(
          false,
        );
    }
  });
  it('keeps class level distinct from total, checks both multiclass prerequisites', () => {
    const state = fighterBuilder();
    state.levels.push({ ...blankLevel('Paladin'), mastery: ['Longsword', 'Spear'] });
    expect(builderErrors(state).join()).toContain('multiclass prerequisites');
    state.baseScores = [15, 14, 13, 10, 8, 12];
    state.backgroundBoosts = [1, 0, 2, 0, 0, 0];
    // Charisma remains 12: still illegal despite having enough Strength.
    expect(builderErrors(state).join()).toContain('Paladin');
    const derived = deriveSrd(state);
    expect(derived.total).toBe(2);
    expect(derived.counts).toEqual({ Fighter: 1, Paladin: 1 });
    expect(derived.pb).toBe(2);
    expect(derived.hitDice).toEqual({ 10: 2 });
  });
  it('rounds EACH 2024 half-caster upward; Pact Magic stays separate', () => {
    const state = fighterBuilder();
    state.levels = [blankLevel('Paladin'), blankLevel('Ranger'), blankLevel('Warlock')];
    const derived = deriveSrd(state);
    expect(derived.casterLevel).toBe(2);
    expect(derived.slots).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(derived.pact).toEqual({ count: 1, level: 1 });
    state.levels = [blankLevel('Ranger'), blankLevel('Ranger')];
    expect(deriveSrd(state).slots[0]).toBe(2);
  });
  it('applies Constitution retroactively, species HP, and capstone score increases', () => {
    const state = fighterBuilder(5);
    state.species = 'Dwarf';
    state.speciesSkill = '';
    state.humanFeat = undefined;
    expect(deriveSrd(state).hp).toBe(
      state.levels.reduce((sum, level) => sum + level.hp, 0) +
        5 * Math.floor((builderScores(state)[2] - 10) / 2) +
        5,
    );
    state.levels = Array.from({ length: 20 }, () => blankLevel('Monk'));
    expect(builderScores(state)[1]).toBe(state.baseScores[1] + state.backgroundBoosts[1] + 4);
    expect(builderScores(state)[4]).toBe(state.baseScores[4] + state.backgroundBoosts[4] + 4);
  });
  it('preserves user entries, immutable drafts, and spent resources across levelup', () => {
    const initial = createDndSheet();
    initial.character = emptyCharacterDetails();
    initial.character.features.push({
      id: '12345678-1234-4123-8123-123456789abc',
      name: 'Homebrew',
      description: 'Do not overwrite',
      actionType: 'Passive',
      source: 'Other',
      uses: 1,
      maxUses: 3,
    });
    const untouched = structuredClone(initial);
    const sheet = applySrdBuilder(initial, fighterBuilder());
    expect(initial).toEqual(untouched);
    const annotated = sheet.character!.features.find((feature) => feature.name === 'Second Wind')!;
    annotated.description += '\nPlayer annotation';
    annotated.maxUses = 3;
    annotated.uses = 1;
    const hp = sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('hp'))!;
    hp.value = Number(hp.value) - 4;
    const wind = sheet.sections
      .flatMap((s) => s.fields)
      .find((f) => f.id === dndId('srd-resource:second-wind'))!;
    wind.value = Number(wind.value) - 1;
    const next = applySrdBuilder(sheet, fighterBuilder(4));
    const nextHp = next.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('hp'))!;
    expect(nextHp.max! - Number(nextHp.value)).toBe(4);
    const nextWind = next.sections.flatMap((s) => s.fields).find((f) => f.id === wind.id)!;
    expect(nextWind.max! - Number(nextWind.value)).toBe(1);
    expect(next.character?.features.find((e) => e.name === 'Homebrew')).toEqual(
      untouched.character?.features[0],
    );
    expect(next.character?.items).toEqual(sheet.character?.items);
    expect(
      next.character?.items.some((item) => item.name === 'Gold Pieces' && item.quantity === 18),
    ).toBe(true);
    const preserved = next.character?.features.find((feature) => feature.id === annotated.id);
    expect(preserved?.description).toContain('Player annotation');
    expect(preserved?.maxUses).toBe(3);
    expect(preserved?.uses).toBe(1);
  });
  it('enforces spell class/level quotas even if multiclass slots are higher', () => {
    const state = fighterBuilder();
    state.levels.push({ ...blankLevel('Wizard'), spells: [srdEntry('spell', 'Fireball')!.id] });
    expect(builderErrors(state).join()).toContain('spell level or class list');
    expect(builderErrors(state).join()).toContain('spellbook');
  });
  it('rejects forged origin/feat/choice data at the create/save sheet schema', () => {
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder());
    const mutate = (edit: (state: NonNullable<typeof sheet.character>['builder']) => void) => {
      const forged = structuredClone(sheet);
      edit(forged.character!.builder);
      return sheetSchema.safeParse(forged).success;
    };
    expect(
      mutate((s) => {
        s!.baseScores = [18, 18, 18, 18, 18, 18];
      }),
    ).toBe(false);
    expect(
      mutate((s) => {
        s!.levels[0].feat = blankFeat(srdEntry('feat', 'Boon of Fate')!.id);
      }),
    ).toBe(false);
    expect(
      mutate((s) => {
        s!.levels[0].choices['forged-feature'] = ['anything'];
      }),
    ).toBe(false);
    expect(
      mutate((s) => {
        s!.levels[0].mastery = ['Plasma Sword', 'Longsword', 'Battleaxe'];
      }),
    ).toBe(false);
    expect(
      mutate((s) => {
        s!.humanFeat = s!.originFeat;
      }),
    ).toBe(false);
    const mismatched = structuredClone(sheet);
    mismatched.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('level'))!.value = 20;
    expect(sheetSchema.safeParse(mismatched).success).toBe(false);
  });
  it('keeps old manual sheets valid and rejects backward progression', () => {
    expect(sheetSchema.safeParse(createDndSheet()).success).toBe(true);
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder(3));
    expect(() => applySrdBuilder(sheet, fighterBuilder(2))).toThrow('cannot remove');
    const invalid = { ...fighterBuilder(), backgroundBoosts: [3, 0, 0, 0, 0, 0] };
    expect(srdBuilderSchema.safeParse(invalid).success).toBe(false);
  });
});
