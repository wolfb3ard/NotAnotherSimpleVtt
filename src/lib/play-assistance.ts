import { dndId, dndNumbers, isDndSheet } from './dnd';
import { healthChanges, playResources, type ResourceChange } from './resources';
import { deriveSrd } from './srd-engine';
import { automaticPreparedIds, classLevels } from './srd-state';
import { srdCastingSources } from './srd-casting';
import { srdById } from './srd-catalog';
import type { CharacterDetails } from './character-details';
import type { Sheet } from './types';

export const slotId = (level: number) => dndId(`slot:${level - 1}`);
const managed = (key: string) => dndId(`srd-resource:${key}`);
export const hitDieSizes = [6, 8, 10, 12];
export const hitDieId = (size: number) => managed(`hit-die:${size}`);
const pools = (sheet: Sheet) => new Map(playResources(sheet).map((field) => [field.id, field]));

export function castChoices(sheet: Sheet, spell: CharacterDetails['spells'][number]) {
  const resources = pools(sheet);
  const state = sheet.character?.builder;
  const allSources = state ? srdCastingSources(state) : [];
  const entry = allSources
    .flatMap((source) => source.spells)
    .find((id) => dndId(`srd:${id}`) === spell.id);
  const catalogSpell = entry ? srdById.get(entry) : undefined;
  const sources = state && entry ? allSources.filter((s) => s.spells.includes(entry)) : [];
  const choices: { key: string; label: string; available: boolean; changes: ResourceChange[] }[] = [
    {
      key: 'manual',
      label: spell.level === 0 ? 'Cantrip · no slot' : 'Manual · no expenditure',
      available: true,
      changes: [],
    },
  ];
  if (
    !state ||
    !entry ||
    catalogSpell?.level !== spell.level ||
    !spell.prepared ||
    spell.level === 0
  )
    return choices;
  const derived = deriveSrd(state);
  const add = (source: string, label: string, id: string) => {
    const pool = resources.get(id);
    if (!pool || !(pool.max && pool.max > 0)) return;
    const remaining = Number(pool.value);
    choices.push({
      key: `${source}:${id}`,
      label: `${label} · ${remaining}/${pool.max} remaining`,
      available: Number.isInteger(remaining) && remaining >= 1,
      changes: [{ id, value: remaining - 1 }],
    });
  };
  for (const source of sources) {
    const latest = state.levels.findLast((step) => `class:${step.className}` === source.id);
    // A Wizard spellbook entry is not necessarily prepared via Wizard even if another source grants it.
    const eligible = latest
      ? latest.spells.includes(entry) || automaticPreparedIds(state, latest.className).has(entry)
      : true;
    if (eligible) {
      for (let level = spell.level; level <= 9; level++)
        if (derived.slots[level - 1])
          add(source.id, `${source.label} · Level ${level} spell slot`, slotId(level));
      if (derived.pact.count && derived.pact.level >= spell.level)
        add(source.id, `${source.label} · Pact Magic level ${derived.pact.level}`, managed('pact'));
    }
  }
  return choices;
}

// Only builder-managed pools with a deterministic SRD recovery rule belong here.
const recoverAllOnShort = ['pact', 'focus', 'action-surge', 'stroke-of-luck'];
const recoverOneOnShort = [
  'rage',
  'second-wind',
  'channel-divinity',
  'paladin-channel',
  'wild-shape',
];
const recoverOnLong = [
  'sorcery',
  'lay-on-hands',
  'bardic-inspiration',
  'hunters-mark',
  'indomitable',
  'innate-sorcery',
  'arcane-recovery',
  'magical-cunning',
  'natural-recovery',
  'divine-intervention',
  'wholeness-of-body',
  'uncanny-metabolism',
  'intimidating-presence',
  'faithful-steed',
  'holy-nimbus',
  'wild-resurgence',
  'dragon-wings',
  'dragon-companion',
  'dark-ones-luck',
  'contact-patron',
  'hurl-through-hell',
  'relentless-endurance',
  'speak-with-animals',
  'species-spell-3',
  'species-spell-5',
  'species',
  'draconic-flight',
  'large-form',
  'gift-of-depths',
  ...[6, 7, 8, 9].map((level) => `arcanum:${level}`),
  ...['Cleric', 'Druid', 'Wizard'].map((list) => `magic-initiate:${list}`),
];

export function restChanges(
  sheet: Sheet,
  rest: 'short' | 'long',
  rolls: Record<number, number[]> = {},
  excluded: ReadonlySet<string> = new Set(),
): ResourceChange[] {
  const state = sheet.character?.builder;
  if (!state || !isDndSheet(sheet))
    throw new Error('Rest automation requires an SRD builder sheet.');
  const resources = pools(sheet);
  const hp = resources.get(dndId('hp'));
  if (!hp || Number(hp.value) < 1)
    throw new Error('Rest requires at least 1 HP; adjudicate manually.');
  const changes: ResourceChange[] = [];
  const set = (id: string, value: number, allowExclude = true) => {
    const field = resources.get(id);
    if (field && value !== field.value && !(allowExclude && excluded.has(id)))
      changes.push({ id, value });
  };
  const restore = (id: string, count = Infinity) => {
    const field = resources.get(id);
    if (field?.max !== undefined) set(id, Math.min(field.max, Number(field.value) + count));
  };
  const all =
    rest === 'long'
      ? [...recoverAllOnShort, ...recoverOneOnShort, ...recoverOnLong]
      : recoverAllOnShort;
  for (const key of all) restore(managed(key));
  for (const level of state.levels)
    for (const id of level.choices['signature-spells'] ?? [])
      if (!changes.some((c) => c.id === managed(`signature:${id}`)))
        restore(managed(`signature:${id}`));
  if (rest === 'long') {
    restore(hp.id);
    for (let level = 1; level <= 9; level++) restore(slotId(level));
    for (const die of hitDieSizes) restore(hitDieId(die));
  } else {
    for (const key of recoverOneOnShort) restore(managed(key), 1);
    if ((classLevels(state.levels).Bard ?? 0) >= 5) restore(managed('bardic-inspiration'));
    const con = dndNumbers(sheet)[dndId('mod:2')];
    let healing = 0;
    for (const size of hitDieSizes) {
      const values = rolls[size] ?? [];
      const pool = resources.get(hitDieId(size));
      if (!values.length) continue;
      if (
        !pool ||
        values.length > Number(pool.value) ||
        values.some((value) => !Number.isInteger(value) || value < 1 || value > size)
      )
        throw new Error(`Enter one result (1–${size}) per available d${size} spent.`);
      set(pool.id, Number(pool.value) - values.length, false);
      healing += values.reduce((sum, value) => sum + Math.max(1, value + con), 0);
    }
    if (healing) set(hp.id, healthChanges(sheet, healing, 'heal')[0].value, false);
  }
  return changes;
}
