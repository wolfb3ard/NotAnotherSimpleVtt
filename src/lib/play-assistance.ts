import { dndId, dndNumbers, isDndSheet } from './dnd';
import { healthChanges, playResources, type ResourceChange } from './resources';
import { deriveSrd } from './srd-engine';
import { automaticPreparedIds, classLevels } from './srd-state';
import { invocationSpellNames, srdCastingSources } from './srd-casting';
import { srdById, srdEntry } from './srd-catalog';
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
  const choices: {
    key: string;
    label: string;
    available: boolean;
    changes: ResourceChange[];
    note?: string;
  }[] = [
    {
      key: 'manual',
      label: spell.level === 0 ? 'Cantrip · no slot' : 'Manual · no expenditure',
      available: true,
      changes: [],
    },
  ];
  if (!state || !entry || catalogSpell?.level !== spell.level || spell.level === 0) return choices;
  const derived = deriveSrd(state);
  const add = (source: string, label: string, id: string, note?: string) => {
    const pool = resources.get(id);
    if (!pool || !(pool.max && pool.max > 0)) return;
    const remaining = Number(pool.value);
    choices.push({
      key: `${source}:${id}`,
      label: `${label} · ${remaining}/${pool.max} remaining`,
      available: Number.isInteger(remaining) && remaining >= 1,
      changes: [{ id, value: Math.max(0, remaining - 1) }],
      ...(note ? { note } : {}),
    });
  };
  for (const source of sources) {
    const noSlot = (key: string, label: string, note: string) =>
      choices.push({ key: `${source.id}:${key}`, label, available: true, changes: [], note });
    const latest = state.levels.findLast((step) => `class:${step.className}` === source.id);
    const classSteps = state.levels.filter((row) => `class:${row.className}` === source.id);
    const mastery =
      latest?.className === 'Wizard' &&
      classSteps
        .findLast((row) => row.choices['spell-mastery'])
        ?.choices['spell-mastery'].includes(entry);
    const signature =
      latest?.className === 'Wizard' &&
      classSteps.some((row) => row.choices['signature-spells']?.includes(entry));
    // A Wizard spellbook entry is not necessarily prepared via Wizard even if another source grants it.
    const eligible =
      spell.prepared &&
      (latest
        ? mastery ||
          signature ||
          latest.spells.includes(entry) ||
          automaticPreparedIds(state, latest.className).has(entry)
        : true);
    const free = (key: string, feature?: string, note?: string, short = false) =>
      add(
        source.id,
        `${source.label}${feature ? ` · ${feature}` : ''} · Free cast (${short ? 'Short or Long Rest' : 'Long Rest'})`,
        managed(key),
        note,
      );
    if (spell.prepared && source.freeCastPool && spell.level === 1) free(source.freeCastPool);
    if (spell.prepared && source.id.startsWith('species:')) {
      if (state.lineage === 'Forest Gnome' && entry === 'spell-speak-with-animals')
        free('speak-with-animals');
      if (['Elf', 'Tiefling'].includes(state.species))
        for (const [at, index] of [
          [3, 1],
          [5, 2],
        ])
          if (state.levels.length >= at && source.spells[index] === entry)
            free(`species-spell-${at}`);
    }
    if (spell.prepared && latest) {
      for (const [className, spellId, key, feature, note] of [
        ['Ranger', 'spell-hunter-s-mark', 'hunters-mark', 'Favored Enemy', undefined],
        ['Paladin', 'spell-find-steed', 'faithful-steed', 'Faithful Steed', undefined],
        [
          'Sorcerer',
          'spell-summon-dragon',
          'dragon-companion',
          'Dragon Companion',
          'No Material component. You may waive Concentration, reducing the duration to 1 minute.',
        ],
        [
          'Warlock',
          'spell-contact-other-plane',
          'contact-patron',
          'Contact Patron',
          'To contact your patron only. You automatically succeed on the spell’s saving throw.',
        ],
        ['Warlock', 'spell-water-breathing', 'gift-of-depths', 'Gift of the Depths', undefined],
      ] as const) {
        if (latest.className === className && entry === spellId) free(key, feature, note);
      }
      if (
        latest.className === 'Warlock' &&
        classSteps.some((row) => row.choices['mystic-arcanum']?.includes(entry))
      )
        free(`arcanum:${spell.level}`, 'Mystic Arcanum');
      if (signature)
        free(
          `signature:${entry}`,
          'Signature Spells',
          'Free at level 3 only. Spend a slot to cast at a higher level.',
          true,
        );
      if (mastery)
        noSlot(
          'mastery',
          'Wizard · Spell Mastery (no slot)',
          'Cast at the spell’s lowest level. Spend a slot to cast at a higher level.',
        );
      if (latest.className === 'Warlock')
        for (const id of latest.options) {
          const invocation = srdById.get(id);
          if (
            !invocation ||
            invocation.name === 'Gift of the Depths' ||
            srdEntry('spell', invocationSpellNames[invocation.name])?.id !== entry
          )
            continue;
          noSlot(id, `${invocation.name} (no slot)`, invocation.text.replace(/\s+/g, ' '));
        }
      if (
        latest.className === 'Druid' &&
        classSteps.length >= 2 &&
        entry === 'spell-find-familiar'
      ) {
        add(
          source.id,
          'Wild Companion · Spend 1 Wild Shape use',
          managed('wild-shape'),
          'The familiar is Fey and disappears when you finish a Long Rest.',
        );
        // This feature also permits slots, without adding Find Familiar to the normal Druid spell list.
        for (let level = spell.level; level <= 9; level++)
          if (derived.slots[level - 1])
            add(
              'wild-companion',
              `Wild Companion · Level ${level} spell slot`,
              slotId(level),
              'The familiar is Fey and disappears when you finish a Long Rest.',
            );
        if (derived.pact.count && derived.pact.level >= spell.level)
          add(
            'wild-companion',
            `Wild Companion · Pact Magic level ${derived.pact.level}`,
            managed('pact'),
            'The familiar is Fey and disappears when you finish a Long Rest.',
          );
      }
    }
    const inBook = latest?.className === 'Wizard' && latest.spellbook.includes(entry);
    const tome =
      spell.prepared &&
      latest?.className === 'Warlock' &&
      latest.options.some(
        (id) => srdById.get(id)?.name === 'Pact of the Tome' && latest.choices[id]?.includes(entry),
      );
    if ((inBook || eligible || tome) && /^Casting Time:[^\n]*\bRitual\b/m.test(catalogSpell.text))
      noSlot(
        'ritual',
        `${source.label} · Ritual (no slot)`,
        `Takes 10 minutes longer than normal. Cannot be upcast.${inBook ? ' Read from your spellbook; preparation is not required.' : tome ? ' Requires your Book of Shadows.' : ''}`,
      );
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
