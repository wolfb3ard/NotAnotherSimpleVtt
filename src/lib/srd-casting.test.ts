import { describe, expect, it } from 'vitest';
import { createDndSheet, dndId, dndNumbers } from './dnd';
import { applySrdBuilder, srdTransitionErrors } from './srd-engine';
import { blankFeat, blankLevel, builderErrors } from './srd-state';
import { classBuilder, fighterBuilder, warlockTomeBuilder } from './srd-test-fixtures';
import { srdEntry } from './srd-catalog';
import { srdCastingSources } from './srd-casting';
import { sheetSchema } from './sheets';

const spell = (name: string) => srdEntry('spell', name)!.id;
function initiate() {
  const state = fighterBuilder();
  state.humanFeat = {
    ...blankFeat(srdEntry('feat', 'Magic Initiate')!.id),
    spellList: 'Wizard',
    spellAbility: 5,
    spells: ['Fire Bolt', 'Mage Hand', 'Shield'].map(spell),
  };
  return state;
}
describe('source-governed SRD spellcasting', () => {
  it('tags Pact of the Tome choices with Warlock Charisma, regardless of catalog spell lists', () => {
    const state = warlockTomeBuilder();
    const source = srdCastingSources(state).find((entry) => entry.id === 'class:Warlock')!;
    expect(source.spells).toContain(spell('Find Familiar'));
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(
      sheet.character!.spells.find((entry) => entry.name === 'Fire Bolt')!.casting,
    ).toContainEqual({ sourceId: 'class:Warlock', ability: 5, label: 'Warlock' });
  });
  it('initializes a later-acquired first caster to Wisdom instead of template Intelligence', () => {
    const state = fighterBuilder();
    state.baseScores = [15, 10, 13, 12, 14, 8];
    state.backgroundBoosts = [2, 0, 1, 0, 0, 0];
    const old = applySrdBuilder(createDndSheet(), state);
    const cleric = structuredClone(classBuilder('Cleric').levels[0]);
    cleric.hp = 5;
    cleric.skills = [];
    cleric.replacementSkills = [];
    state.levels.push(cleric);
    expect(builderErrors(state)).toEqual([]);
    const next = applySrdBuilder(old, state);
    expect(
      next.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('spell-ability'))?.value,
    ).toBe(4);
    expect(dndNumbers(next)[dndId('spell-dc')]).toBe(12);
    const manual = structuredClone(old);
    manual.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('spell-ability'))!.value =
      5;
    expect(
      applySrdBuilder(manual, state)
        .sections.flatMap((s) => s.fields)
        .find((f) => f.id === dndId('spell-ability'))?.value,
    ).toBe(5);
  });
  it('uses chosen feat ability even on a noncaster and emits authoritative source keys', () => {
    const state = initiate(),
      source = srdCastingSources(state).find((source) => source.id === 'feat:human')!;
    expect(source.ability).toBe(5);
    expect(source.dcKey).toBe('srd-resource:casting:feat:human:dc');
    const sheet = applySrdBuilder(createDndSheet(), state);
    const selected = sheet.character!.spells.find((s) => s.name === 'Fire Bolt')!;
    expect(selected.casting).toEqual([
      { sourceId: 'feat:human', ability: 5, label: 'Human · Magic Initiate' },
    ]);
    expect(
      sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId(source.dcKey))?.value,
    ).toBe(9);
    selected.casting![0].ability = 3;
    expect(sheetSchema.safeParse(sheet).success).toBe(false);
  });
  it('uses the chosen species ability, not the spell catalog’s Wizard/Sorcerer list', () => {
    const state = fighterBuilder();
    state.species = 'Tiefling';
    state.lineage = 'Infernal';
    state.speciesSkill = '';
    state.humanFeat = undefined;
    state.speciesSpellAbility = 4;
    state.baseScores = [15, 10, 13, 12, 14, 8];
    state.backgroundBoosts = [2, 0, 1, 0, 0, 0];
    const sheet = applySrdBuilder(createDndSheet(), state);
    expect(sheet.character!.spells.find((s) => s.name === 'Fire Bolt')!.casting?.[0]).toMatchObject(
      { sourceId: 'species:Tiefling', ability: 4 },
    );
    expect(
      sheet.sections
        .flatMap((s) => s.fields)
        .find((f) => f.id === dndId('srd-resource:casting:species:Tiefling:dc'))?.value,
    ).toBe(12);
  });
  it('permits one same-level Magic Initiate replacement per gained character level, never refilling its daily use', () => {
    const state = initiate(),
      old = applySrdBuilder(createDndSheet(), state);
    const changed = structuredClone(state);
    changed.humanFeat!.spells[0] = spell('Ray of Frost');
    expect(srdTransitionErrors(old.character!.builder!, changed)).toEqual([]);
    const level = blankLevel('Fighter');
    level.mastery = [...state.levels[0].mastery];
    changed.levels.push(level);
    expect(builderErrors(changed)).toEqual([]);
    expect(srdTransitionErrors(old.character!.builder!, changed)).toEqual([]);
    const resource = old.sections
      .flatMap((s) => s.fields)
      .find((f) => f.id === dndId('srd-resource:magic-initiate:Wizard'))!;
    resource.value = 0;
    const next = applySrdBuilder(old, changed);
    expect(next.character!.spells.some((s) => s.name === 'Ray of Frost')).toBe(true);
    expect(next.sections.flatMap((s) => s.fields).find((f) => f.id === resource.id)?.value).toBe(0);
    changed.humanFeat!.spells[1] = spell('Light');
    expect(srdTransitionErrors(old.character!.builder!, changed).join()).toContain('only one');
  });
  it('allows multiple Ranger prepared spell changes across snapshots (multiple Long Rests)', () => {
    const state = classBuilder('Ranger', 3),
      step = state.levels[2];
    const candidates = [
      'Animal Friendship',
      'Cure Wounds',
      'Detect Magic',
      'Ensnaring Strike',
      'Entangle',
      'Fog Cloud',
      'Goodberry',
      'Longstrider',
      'Speak with Animals',
    ]
      .map((name) => srdEntry('spell', name))
      .filter((entry) => !!entry && entry.classes?.includes('Ranger'))
      .map((entry) => entry!.id);
    step.spells = [...new Set(candidates)]
      .filter((id) => !state.levels[1].spells.includes(id))
      .slice(0, 4);
    expect(step.spells.length).toBe(4);
    expect(builderErrors(state)).toEqual([]);
  });
});
