import { createDndSheet, dndId, scoreOverrideId } from './dnd';
import {
  backgrounds,
  classRules,
  lineages,
  srdAlignments,
  srdBackgrounds,
  srdClasses,
  srdSpecies,
} from './srd-rules';
import { blankLevel, defaultBackgroundFeat, newSrdState } from './srd-state';
import type { Sheet } from './types';

export function isLegacySrdCharacter(sheet: Sheet) {
  if (sheet.character?.builder) return false;
  const fields = new Map(sheet.sections.flatMap((section) => section.fields).map((f) => [f.id, f]));
  return (
    !!sheet.character?.items.length ||
    !!sheet.character?.features.length ||
    !!sheet.character?.spells.length ||
    Array.from({ length: 6 }, (_, i) => scoreOverrideId(i)).some((id) => fields.has(id)) ||
    createDndSheet().sections.some((section) =>
      section.fields.some((base) => {
        const field = fields.get(base.id);
        return field && (field.value !== base.value || field.max !== base.max);
      }),
    )
  );
}

export function seedSrdBuilder(sheet: Sheet) {
  const draft = newSrdState();
  if (isLegacySrdCharacter(sheet)) {
    const fields = new Map(
      sheet.sections.flatMap((section) => section.fields).map((f) => [f.id, f.value]),
    );
    const text = (key: string) => String(fields.get(dndId(key)) ?? '').trim();
    const known = <T extends string>(options: readonly T[], value: string) =>
      options.find((option) => option.toLowerCase() === value.toLowerCase());
    const total = Math.min(20, Math.max(1, Math.trunc(Number(fields.get(dndId('level'))) || 1)));
    const classes = text('class')
      .split('/')
      .map((part) => {
        const [, label, count] = /^([a-z]+)(?:\s+(\d+))?\b/i.exec(part.trim()) ?? [];
        return { name: known(srdClasses, label ?? ''), count: Math.max(1, Number(count ?? 1)) };
      });
    const first = classes[0].name ?? draft.levels[0].className;
    const history =
      classes.every(({ name }) => name) &&
      classes.reduce((sum, { count }) => sum + count, 0) === total
        ? classes.flatMap(({ name, count }) => Array.from({ length: count }, () => name!))
        : Array.from({ length: total }, () => first);
    draft.levels = history.map((name, i) =>
      i ? blankLevel(name) : { ...blankLevel(name), hp: classRules[name].die },
    );
    draft.background = known(srdBackgrounds, text('background')) ?? draft.background;
    const [, species, lineage] = /^(\w+)(?: \(([^)]+)\))?$/.exec(text('species')) ?? [];
    draft.species = known(srdSpecies, species ?? '') ?? draft.species;
    draft.lineage = known(lineages[draft.species] ?? [], lineage ?? '') ?? '';
    if (['Gnome', 'Halfling'].includes(draft.species)) draft.size = 'Small';
    draft.alignment = known(srdAlignments, text('alignment')) ?? draft.alignment;
    const base = draft.baseScores.map((_, i) =>
      Math.max(1, Math.min(30, Math.trunc(Number(fields.get(dndId(`score:${i}`)) ?? 10)))),
    );
    const eligible = [...backgrounds[draft.background].abilities].sort((a, b) => base[b] - base[a]);
    draft.backgroundBoosts = base.map((_, i) =>
      base[eligible[0]] < 3 && base[eligible[2]] >= 2 && eligible.some((index) => index === i)
        ? 1
        : i === eligible[0]
          ? 2
          : i === eligible[1]
            ? 1
            : 0,
    );
    draft.abilityMethod = 'manual';
    draft.baseScores = base.map((score, i) => Math.max(1, score - draft.backgroundBoosts[i]));
    Object.assign(draft.equipment, {
      grantStarting: false,
      acMode: 'manual',
      weaponIds: ['', '', ''],
    });
  }
  draft.originFeat = defaultBackgroundFeat(draft.background);
  return draft;
}
