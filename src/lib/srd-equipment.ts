import { z } from 'zod';
import { dndId } from './dnd';
import { srdCatalog, srdExcerpt, type SrdEntry } from './srd-catalog';
import { instruments, progressions, type SrdClass } from './srd-rules';
import type { SrdBuilderState } from './srd-state';
import type { CharacterDetails } from './character-details';

export const armorProfiles = {
  'Padded Armor': { category: 'Light', ac: 11, dex: 99, strength: 0, stealth: true },
  'Leather Armor': { category: 'Light', ac: 11, dex: 99, strength: 0, stealth: false },
  'Studded Leather Armor': { category: 'Light', ac: 12, dex: 99, strength: 0, stealth: false },
  'Hide Armor': { category: 'Medium', ac: 12, dex: 2, strength: 0, stealth: false },
  'Chain Shirt': { category: 'Medium', ac: 13, dex: 2, strength: 0, stealth: false },
  'Scale Mail': { category: 'Medium', ac: 14, dex: 2, strength: 0, stealth: true },
  Breastplate: { category: 'Medium', ac: 14, dex: 2, strength: 0, stealth: false },
  'Half Plate Armor': { category: 'Medium', ac: 15, dex: 2, strength: 0, stealth: true },
  'Ring Mail': { category: 'Heavy', ac: 14, dex: 0, strength: 0, stealth: true },
  'Chain Mail': { category: 'Heavy', ac: 16, dex: 0, strength: 13, stealth: true },
  'Splint Armor': { category: 'Heavy', ac: 17, dex: 0, strength: 15, stealth: true },
  'Plate Armor': { category: 'Heavy', ac: 18, dex: 0, strength: 15, stealth: true },
} as const;
export type ArmorName = keyof typeof armorProfiles;
export const acModes = [
  'auto',
  'standard',
  'armor',
  'barbarian',
  'monk',
  'draconic',
  'manual',
] as const;
const inventoryRef = z.union([z.literal(''), z.literal('auto'), z.string().uuid()]);
export const equipmentSchema = z
  .object({
    grantStarting: z.boolean().default(true),
    classSymbol: z.enum(['Amulet', 'Emblem', 'Reliquary']),
    backgroundSymbol: z.enum(['Amulet', 'Emblem', 'Reliquary']),
    instrument: z.string().max(40),
    purchases: z
      .array(
        z
          .object({ key: z.string().max(160), quantity: z.number().int().min(1).max(30000) })
          .strict(),
      )
      .max(100),
    armorId: inventoryRef,
    shieldId: inventoryRef,
    acMode: z.enum(acModes),
    weaponIds: z.array(inventoryRef).length(3),
    weaponAbilities: z.array(z.union([z.literal(-1), z.literal(0), z.literal(1)])).length(3),
    twoHanded: z.array(z.boolean()).length(3),
    expandLegacyBundles: z.boolean(),
    appliedAC: z.number().int().min(0).max(1000).optional(),
    appliedSpeed: z.number().int().min(0).max(1000).optional(),
    appliedWeaponBonuses: z.array(z.number().int().min(0).max(5)).length(3).optional(),
    appliedDamageBonuses: z.array(z.number().int().min(0).max(3)).length(3).optional(),
  })
  .strict();
export type SrdEquipment = z.infer<typeof equipmentSchema>;
export function defaultEquipment(): SrdEquipment {
  return {
    grantStarting: true,
    classSymbol: 'Amulet',
    backgroundSymbol: 'Amulet',
    instrument: '',
    purchases: [],
    armorId: 'auto',
    shieldId: 'auto',
    acMode: 'auto',
    weaponIds: ['auto', 'auto', 'auto'],
    weaponAbilities: [-1, -1, -1],
    twoHanded: [false, false, false],
    expandLegacyBundles: false,
  };
}
type Lot = { name: string; quantity: number; page: number };
const lot = (name: string, quantity = 1, page = 97): Lot => ({ name, quantity, page });
/** Manually transcribed and independently checked against PDF pp.96–99.
 * Quantities are actual units (rations = days, oil = flasks), not opaque packs. */
export const equipmentPacks: Record<string, { page: number; items: Lot[] }> = {
  'Burglar’s Pack': {
    page: 96,
    items: [
      lot('Backpack'),
      lot('Ball Bearings'),
      lot('Bell'),
      lot('Candle', 10, 96),
      lot('Crowbar'),
      lot('Hooded Lantern', 1, 98),
      lot('Oil', 7, 98),
      lot('Rations', 5, 99),
      lot('Rope', 1, 99),
      lot('Tinderbox', 1, 100),
      lot('Waterskin', 1, 100),
    ],
  },
  'Dungeoneer’s Pack': {
    page: 97,
    items: [
      lot('Backpack'),
      lot('Caltrops', 1, 96),
      lot('Crowbar'),
      lot('Oil', 2, 98),
      lot('Rations', 10, 99),
      lot('Rope', 1, 99),
      lot('Tinderbox', 1, 100),
      lot('Torch', 10, 100),
      lot('Waterskin', 1, 100),
    ],
  },
  'Entertainer’s Pack': {
    page: 97,
    items: [
      lot('Backpack'),
      lot('Bedroll', 1, 96),
      lot('Bell'),
      lot('Bullseye Lantern', 1, 98),
      lot('Costume', 3),
      lot('Mirror', 1, 98),
      lot('Oil', 8, 98),
      lot('Rations', 9, 99),
      lot('Tinderbox', 1, 100),
      lot('Waterskin', 1, 100),
    ],
  },
  'Explorer’s Pack': {
    page: 97,
    items: [
      lot('Backpack'),
      lot('Bedroll', 1, 96),
      lot('Oil', 2, 98),
      lot('Rations', 10, 99),
      lot('Rope', 1, 99),
      lot('Tinderbox', 1, 100),
      lot('Torch', 10, 100),
      lot('Waterskin', 1, 100),
    ],
  },
  'Priest’s Pack': {
    page: 99,
    items: [
      lot('Backpack'),
      lot('Blanket', 1, 96),
      lot('Holy Water'),
      lot('Lamp', 1, 98),
      lot('Rations', 7, 99),
      lot('Robe', 1, 99),
      lot('Tinderbox', 1, 100),
    ],
  },
  'Scholar’s Pack': {
    page: 99,
    items: [
      lot('Backpack'),
      lot('Book', 1, 96),
      lot('Ink', 1, 98),
      lot('Ink Pen', 1, 98),
      lot('Lamp', 1, 98),
      lot('Oil', 10, 98),
      lot('Parchment', 10, 99),
      lot('Tinderbox', 1, 100),
    ],
  },
  'Diplomat’s Pack': {
    page: 97,
    items: [
      lot('Chest'),
      lot('Fine Clothes'),
      lot('Ink', 1, 98),
      lot('Ink Pen', 5, 98),
      lot('Lamp', 1, 98),
      lot('Map or Scroll Case', 2, 96),
      lot('Oil', 4, 98),
      lot('Paper', 5, 99),
      lot('Parchment', 5, 99),
      lot('Perfume', 1, 99),
      lot('Tinderbox', 1, 100),
    ],
  },
};
export const classStartingGold: Record<SrdClass, number[]> = {
  Barbarian: [15, 75],
  Bard: [19, 90],
  Cleric: [7, 110],
  Druid: [9, 50],
  Fighter: [4, 11, 155],
  Monk: [11, 50],
  Paladin: [9, 150],
  Ranger: [7, 150],
  Rogue: [8, 100],
  Sorcerer: [28, 50],
  Warlock: [15, 100],
  Wizard: [5, 55],
};
export function classLots(state: SrdBuilderState): Lot[] {
  const name = state.levels[0].className,
    choice = state.classEquipment;
  if (name === 'Fighter' && choice === 'B')
    return [
      lot('Studded Leather Armor'),
      lot('Scimitar'),
      lot('Shortsword'),
      lot('Longbow'),
      lot('Arrows', 20, 96),
      lot('Quiver', 1, 99),
      lot('Dungeoneer’s Pack'),
    ];
  if (choice !== 'A') return [];
  const gear = state.equipment ?? defaultEquipment();
  const symbol = `Holy Symbol (${gear.classSymbol})`;
  const packages: Record<SrdClass, Lot[]> = {
    Barbarian: [lot('Greataxe'), lot('Handaxe', 4), lot('Explorer’s Pack')],
    Bard: [
      lot('Leather Armor'),
      lot('Dagger', 2),
      lot(gear.instrument, 1, 94),
      lot('Entertainer’s Pack'),
    ],
    Cleric: [lot('Chain Shirt'), lot('Shield'), lot('Mace'), lot(symbol), lot('Priest’s Pack')],
    Druid: [
      lot('Leather Armor'),
      lot('Shield'),
      lot('Sickle'),
      lot('Quarterstaff (Druidic Focus)'),
      lot('Explorer’s Pack'),
      lot('Herbalism Kit', 1, 94),
    ],
    Fighter: [
      lot('Chain Mail'),
      lot('Greatsword'),
      lot('Flail'),
      lot('Javelin', 8),
      lot('Dungeoneer’s Pack'),
    ],
    Monk: [
      lot('Spear'),
      lot('Dagger', 5),
      lot(state.levels[0].choices['monk-tool']?.[0] ?? ''),
      lot('Explorer’s Pack'),
    ],
    Paladin: [
      lot('Chain Mail'),
      lot('Shield'),
      lot('Longsword'),
      lot('Javelin', 6),
      lot(symbol),
      lot('Priest’s Pack'),
    ],
    Ranger: [
      lot('Studded Leather Armor'),
      lot('Scimitar'),
      lot('Shortsword'),
      lot('Longbow'),
      lot('Arrows', 20, 96),
      lot('Quiver', 1, 99),
      lot('Druidic Focus (sprig of mistletoe)'),
      lot('Explorer’s Pack'),
    ],
    Rogue: [
      lot('Leather Armor'),
      lot('Dagger', 2),
      lot('Shortsword'),
      lot('Shortbow'),
      lot('Arrows', 20, 96),
      lot('Quiver', 1, 99),
      lot('Thieves’ Tools', 1, 94),
      lot('Burglar’s Pack', 1, 96),
    ],
    Sorcerer: [
      lot('Spear'),
      lot('Dagger', 2),
      lot('Arcane Focus (Crystal)', 1, 96),
      lot('Dungeoneer’s Pack'),
    ],
    Warlock: [
      lot('Leather Armor'),
      lot('Sickle'),
      lot('Dagger', 2),
      lot('Arcane Focus (Orb)', 1, 96),
      lot('Book (occult lore)', 1, 96),
      lot('Scholar’s Pack', 1, 99),
    ],
    Wizard: [
      lot('Dagger', 2),
      lot('Quarterstaff (Arcane Focus)', 1, 96),
      lot('Robe', 1, 99),
      lot('Spellbook', 1, 100),
      lot('Scholar’s Pack', 1, 99),
    ],
  };
  return packages[name];
}
export function backgroundLots(state: SrdBuilderState): Lot[] {
  if (state.backgroundEquipment !== 'A') return [];
  const gear = state.equipment ?? defaultEquipment();
  return {
    Acolyte: [
      lot('Calligrapher’s Supplies', 1, 93),
      lot('Book (prayers)', 1, 96),
      lot(`Holy Symbol (${gear.backgroundSymbol})`),
      lot('Parchment', 10, 99),
      lot('Robe', 1, 99),
    ],
    Criminal: [
      lot('Dagger', 2),
      lot('Thieves’ Tools', 1, 94),
      lot('Crowbar'),
      lot('Pouch', 2, 99),
      lot('Traveler’s Clothes'),
    ],
    Sage: [
      lot('Quarterstaff'),
      lot('Calligrapher’s Supplies', 1, 93),
      lot('Book (history)', 1, 96),
      lot('Parchment', 8, 99),
      lot('Robe', 1, 99),
    ],
    Soldier: [
      lot('Spear'),
      lot('Shortbow'),
      lot('Arrows', 20, 96),
      lot(state.tools[0] ?? '', 1, 94),
      lot('Healer’s Kit'),
      lot('Quiver', 1, 99),
      lot('Traveler’s Clothes'),
    ],
  }[state.background];
}
const aliases: Record<string, string> = {
  'Bullseye Lantern': 'Lantern, Bullseye',
  'Hooded Lantern': 'Lantern, Hooded',
  'Fine Clothes': 'Clothes, Fine',
  'Traveler’s Clothes': 'Clothes, Traveler’s',
  'Map or Scroll Case': 'Case, Map or Scroll',
  Arrows: 'Ammunition',
};
export function equipmentEntry(name: string): SrdEntry | undefined {
  const exact = srdCatalog.find(
    (entry) =>
      entry.category === 'equipment' && (entry.inventoryName === name || entry.name === name),
  );
  if (exact) return exact;
  const base = name.replace(/ \+\d$/, '').replace(/ \(.*\)$/, '');
  const key = aliases[base] ?? base;
  return (
    srdCatalog.find(
      (entry) =>
        entry.category === 'equipment' &&
        entry.name.replace(/ \(.*/, '') === key &&
        (entry.kind === 'weapon' || entry.kind === 'armor'),
    ) ??
    srdCatalog.find(
      (entry) => entry.category === 'equipment' && entry.name.replace(/ \(.*/, '') === key,
    )
  );
}
export type ShopOffer = {
  key: string;
  entryId: string;
  name: string;
  copper: number;
  quantity: number;
  page: number;
};
/** Printed price extraction, not guessed replacement values. Ambiguous "Varies"
 * entries are excluded and supplied only when an explicit variant price exists. */
export const equipmentShop: ShopOffer[] = srdCatalog
  .filter((entry) => entry.category === 'equipment' && entry.addable !== false)
  .flatMap((entry) => {
    if (entry.costCopper === undefined) return [];
    return [
      {
        key: entry.shopKey ?? entry.id,
        entryId: entry.id,
        name: entry.inventoryName ?? entry.name.replace(/ \(.*/, ''),
        copper: entry.costCopper,
        quantity: entry.purchaseQuantity ?? 1,
        page: entry.page,
      },
    ];
  });
export const shopByKey = new Map(equipmentShop.map((offer) => [offer.key, offer]));
const backgroundStartingGold = (state: SrdBuilderState) =>
  state.backgroundEquipment === 'B'
    ? 50
    : { Acolyte: 8, Criminal: 16, Sage: 8, Soldier: 14 }[state.background];

export function startingEquipmentOptions(state: SrdBuilderState) {
  function option<T extends string>(letter: T, gold: number, lots: Lot[], pending?: string) {
    const items = lots.map(({ name, quantity }) =>
      name ? (quantity > 1 ? `${name} ×${quantity}` : name) : (pending ?? ''),
    );
    return {
      letter,
      gold,
      items,
      label: items.slice(0, 2).join(' & ') || `${gold} GP only`,
    };
  }

  const className = state.levels[0].className;
  const classChoices = className === 'Fighter' ? (['A', 'B', 'C'] as const) : (['A', 'B'] as const);
  return {
    classOptions: classChoices.map((letter, index) =>
      option(
        letter,
        classStartingGold[className][index],
        classLots({ ...state, classEquipment: letter }),
        className === 'Bard'
          ? 'Musical instrument (choose below)'
          : 'Monk tool or instrument (class choice)',
      ),
    ),
    backgroundOptions: (['A', 'B'] as const).map((letter) => {
      const draft = { ...state, backgroundEquipment: letter };
      return option(
        letter,
        backgroundStartingGold(draft),
        backgroundLots(draft),
        'Gaming set (background choice)',
      );
    }),
  };
}

export function startingBudget(state: SrdBuilderState) {
  if (state.equipment?.grantStarting === false)
    return { grantedCopper: 0, spentCopper: 0, remainingCopper: 0 };
  const index = ['A', 'B', 'C'].indexOf(state.classEquipment);
  const classGold = classStartingGold[state.levels[0].className][index] ?? 0;
  const backgroundGold = backgroundStartingGold(state);
  const spent = (state.equipment?.purchases ?? []).reduce(
    (sum, buy) => sum + (shopByKey.get(buy.key)?.copper ?? 0) * buy.quantity,
    0,
  );
  return {
    grantedCopper: (classGold + backgroundGold) * 100,
    spentCopper: spent,
    remainingCopper: (classGold + backgroundGold) * 100 - spent,
  };
}
export function equipmentErrors(state: SrdBuilderState): string[] {
  const gear = state.equipment ?? defaultEquipment(),
    errors: string[] = [];
  if (
    gear.grantStarting !== false &&
    state.levels[0].className === 'Bard' &&
    state.classEquipment === 'A' &&
    !instruments.includes(gear.instrument)
  )
    errors.push('Bard equipment A requires a particular Musical Instrument.');
  if (gear.grantStarting === false && gear.purchases.length)
    errors.push(
      'Adopting existing equipment does not grant or spend starting currency; remove creation purchases.',
    );
  if (gear.grantStarting === false && gear.expandLegacyBundles)
    errors.push(
      'Legacy bundle expansion requires the original starting grant; existing-equipment adoption grants nothing.',
    );
  if (gear.instrument && !instruments.includes(gear.instrument))
    errors.push('Invalid starting Musical Instrument.');
  if (gear.purchases.some((buy) => !shopByKey.has(buy.key)))
    errors.push('Choose a priced SRD equipment offer; ambiguous variants are not valid purchases.');
  if (new Set(gear.purchases.map((buy) => buy.key)).size !== gear.purchases.length)
    errors.push('Combine repeated equipment purchases into one quantity.');
  if (startingBudget(state).remainingCopper < 0)
    errors.push('Starting equipment purchases exceed your class/background currency.');
  const counts = state.levels.reduce(
    (map, step) => ({ ...map, [step.className]: (map[step.className] ?? 0) + 1 }),
    {} as Partial<Record<SrdClass, number>>,
  );
  if (
    (gear.acMode === 'barbarian' && !counts.Barbarian) ||
    (gear.acMode === 'monk' && !counts.Monk) ||
    (gear.acMode === 'draconic' && (counts.Sorcerer ?? 0) < 3)
  )
    errors.push('The selected AC formula requires its class feature.');
  return errors;
}
export const startingItemId = (name: string) => dndId(`srd:starting-item:${name}`);
const legacyBundleIds = new Set(
  srdCatalog
    .filter((entry) => entry.category === 'class' || entry.category === 'background')
    .map((entry) => dndId(`srd:starting-equipment:${entry.id}`)),
);
export function isLegacyStartingBundle(item: { id: string; name: string; quantity: number }) {
  return (
    legacyBundleIds.has(item.id) &&
    / starting equipment · [ABC]$/.test(item.name) &&
    item.quantity > 0
  );
}
export function startingInventory(state: SrdBuilderState): CharacterDetails['items'] {
  if (state.equipment?.grantStarting === false) return [];
  const lots: Lot[] = [...classLots(state), ...backgroundLots(state)];
  // Wizard Spellcasting creates the starting spellbook (p.78). Package A
  // already lists that book; the 55 GP alternative does not remove the feature.
  if (state.levels[0].className === 'Wizard' && state.classEquipment === 'B')
    lots.push(lot('Spellbook', 1, 78));
  for (const buy of state.equipment?.purchases ?? []) {
    const offer = shopByKey.get(buy.key);
    if (offer) lots.push(lot(offer.name, offer.quantity * buy.quantity, offer.page));
  }
  const expanded: Lot[] = [];
  for (const value of lots) {
    const pack = equipmentPacks[value.name];
    if (pack)
      expanded.push(
        ...pack.items.map((item) => ({ ...item, quantity: item.quantity * value.quantity })),
      );
    else if (value.name) expanded.push(value);
  }
  const remaining = Math.max(0, startingBudget(state).remainingCopper);
  if (remaining >= 100) expanded.push(lot('Gold Pieces', Math.floor(remaining / 100), 89));
  if (remaining % 100 >= 10)
    expanded.push(lot('Silver Pieces', Math.floor((remaining % 100) / 10), 89));
  if (remaining % 10) expanded.push(lot('Copper Pieces', remaining % 10, 89));
  const merged = new Map<string, Lot>();
  for (const item of expanded) {
    const existing = merged.get(item.name);
    merged.set(item.name, { ...item, quantity: (existing?.quantity ?? 0) + item.quantity });
  }
  return [...merged.values()].flatMap((item) => {
    const source = equipmentEntry(item.name);
    const currency = /^(Gold|Silver|Copper) Pieces$/.test(item.name);
    return Array.from({ length: Math.ceil(item.quantity / 999) }, (_, index) => ({
      id: index ? startingItemId(`${item.name}:stack:${index}`) : startingItemId(item.name),
      name: item.name,
      quantity: Math.min(999, item.quantity - index * 999),
      description: `${currency ? 'Currency; quantity is the number of coins.' : source ? srdExcerpt(source, 3500) : 'Selected SRD equipment variant.'}\n\nStarting grant or purchase. Pack contents are listed individually.${item.name === 'Spellbook' && state.levels[0].className === 'Wizard' ? ' Wizard Spellcasting creates its starting spellbook; package A already includes it, gold B does not remove that feature.' : ''}`,
      rarity: 'Common' as const,
      requiresAttunement: false,
      attuned: false,
    }));
  });
}
type Item = Pick<CharacterDetails['items'][number], 'id' | 'name' | 'quantity'>;
export const pactConjuredId = dndId('srd:pact-conjured');
export function conjuredPactItem(
  state: SrdBuilderState,
): CharacterDetails['items'][number] | undefined {
  const selected = state.companions;
  if (!selected?.pactActive || selected.pactOwnedId || !selected.pactWeapon) return;
  const weapon = weaponProfile(selected.pactWeapon);
  if (!weapon || weapon.ranged) return;
  return {
    id: pactConjuredId,
    name: `${selected.pactWeapon} (Conjured Pact)`,
    quantity: 1,
    rarity: 'Common',
    requiresAttunement: false,
    attuned: false,
    description: `Conjured Pact weapon, not a purchased or converted manual item. Only this one conjured weapon exists; it disappears when the bond ends. Active configuration, not an encounter action/charge tracker.\n\n${srdExcerpt(weapon.entry, 3500)}`,
  };
}
export function recognizableMagicWeapon(
  item: Item & { rarity?: string; requiresAttunement?: boolean },
) {
  return (
    !!weaponProfile(item.name) &&
    ((!!item.rarity && item.rarity !== 'Common') ||
      item.requiresAttunement ||
      / \+[1-3]$/.test(item.name))
  );
}
export function armorProfile(name: string): { name: ArmorName; bonus: number } | undefined {
  const normalized = name.replace(/ \((?:[\d,]+\s*(?:GP|SP|CP))\)$/, '');
  for (const base of Object.keys(armorProfiles) as ArmorName[])
    if (normalized === base || new RegExp(`^${base} \\+[1-3]$`).test(normalized))
      return { name: base, bonus: Number(/\+([1-3])$/.exec(normalized)?.[1] ?? 0) };
}
export function isShield(name: string) {
  return /^Shield(?: \+[1-3])?$/.test(name);
}
export function weaponProfile(name: string) {
  const base = name.replace(/ \+\d$/, '').replace(/ \(.*\)$/, '');
  const entry = srdCatalog.find((value) => value.kind === 'weapon' && value.name === base);
  if (!entry) return;
  const lines = entry.text.split('\n'),
    damage = /^(\d+d\d+|\d+) (.+)$/.exec(lines[0]);
  if (!damage) return;
  const ranged = [
    'Dart',
    'Light Crossbow',
    'Shortbow',
    'Sling',
    'Blowgun',
    'Hand Crossbow',
    'Heavy Crossbow',
    'Longbow',
    'Musket',
    'Pistol',
  ].includes(base);
  return {
    entry,
    name: base,
    dice: damage[1],
    damageType: damage[2],
    finesse: /\bFinesse\b/.test(entry.text),
    ranged,
    versatile: /Versatile \((\d+d\d+)\)/.exec(entry.text)?.[1],
    bonus: Number(/\+([1-3])$/.exec(name)?.[1] ?? 0),
  };
}
export function armorTraining(state: SrdBuilderState) {
  const result = new Set<string>();
  const first = state.levels[0].className;
  if (
    [
      'Barbarian',
      'Bard',
      'Cleric',
      'Druid',
      'Fighter',
      'Paladin',
      'Ranger',
      'Rogue',
      'Warlock',
    ].includes(first)
  )
    result.add('Light');
  if (['Barbarian', 'Cleric', 'Fighter', 'Paladin', 'Ranger'].includes(first)) result.add('Medium');
  if (['Fighter', 'Paladin'].includes(first)) result.add('Heavy');
  for (const step of state.levels) {
    const name = step.className;
    if (
      ['Bard', 'Cleric', 'Druid', 'Fighter', 'Paladin', 'Ranger', 'Rogue', 'Warlock'].includes(name)
    )
      result.add('Light');
    if (['Cleric', 'Fighter', 'Paladin', 'Ranger'].includes(name)) result.add('Medium');
    if (['Barbarian', 'Cleric', 'Druid', 'Fighter', 'Paladin', 'Ranger'].includes(name))
      result.add('Shield');
    if (step.choices['divine-order']?.includes('Protector')) result.add('Heavy');
    if (step.choices['primal-order']?.includes('Warden')) result.add('Medium');
  }
  return result;
}
export function weaponTrained(state: SrdBuilderState, name: string): boolean {
  const index = srdCatalog
    .filter((entry) => entry.kind === 'weapon')
    .findIndex((entry) => entry.name === name);
  const profile = weaponProfile(name);
  if (index >= 0 && index < 14) return true; // PDF p.91: the fourteen Simple weapons.
  if (
    state.levels.some(
      (step) =>
        ['Barbarian', 'Fighter', 'Paladin', 'Ranger'].includes(step.className) ||
        step.choices['divine-order']?.includes('Protector') ||
        step.choices['primal-order']?.includes('Warden'),
    )
  )
    return true;
  if (
    state.levels[0].className === 'Rogue' &&
    profile &&
    /\b(Finesse|Light)\b/.test(profile.entry.text)
  )
    return true;
  return state.levels[0].className === 'Monk' && !!profile && /\bLight\b/.test(profile.entry.text);
}
export function resolveLoadout(state: SrdBuilderState, items: Item[]) {
  const gear = state.equipment ?? defaultEquipment(),
    granted = startingInventory(state);
  const existing = (id: string) => items.find((item) => item.id === id && item.quantity > 0);
  const autoArmor = granted.find((item) => armorProfile(item.name) && existing(item.id));
  const autoShield = granted.find((item) => isShield(item.name) && existing(item.id));
  const armor =
    gear.armorId === 'auto' ? autoArmor && existing(autoArmor.id) : existing(gear.armorId);
  const shield =
    gear.shieldId === 'auto' ? autoShield && existing(autoShield.id) : existing(gear.shieldId);
  const autoWeapons = granted.filter((item) => weaponProfile(item.name) && existing(item.id));
  const pact = state.companions?.pactActive
    ? existing(state.companions.pactOwnedId || pactConjuredId)
    : undefined;
  const autoIds = [...new Set([...(pact ? [pact.id] : []), ...autoWeapons.map((item) => item.id)])];
  const weapons = gear.weaponIds.map((id, i) =>
    id === 'auto' ? existing(autoIds[i] ?? '') : existing(id),
  );
  return { armor, shield, weapons };
}
export function deriveEquipment(state: SrdBuilderState, items: Item[], scores: number[]) {
  const gear = state.equipment ?? defaultEquipment(),
    loadout = resolveLoadout(state, items);
  const errors: string[] = [],
    warnings: string[] = [],
    training = armorTraining(state);
  const profile = loadout.armor && armorProfile(loadout.armor.name),
    armor = profile && armorProfiles[profile.name];
  if (loadout.armor && !profile && gear.acMode !== 'manual')
    errors.push(
      'The worn armor name is no longer a recognized SRD base armor; select Manual AC / Speed for homebrew armor.',
    );
  if (loadout.shield && !isShield(loadout.shield.name) && gear.acMode !== 'manual')
    errors.push('The wielded Shield name is unrecognized; select Manual AC / Speed or unequip it.');
  if (
    gear.armorId &&
    gear.armorId !== 'auto' &&
    (!loadout.armor || (!profile && gear.acMode !== 'manual'))
  )
    errors.push(
      'Equipped armor must reference an owned, positive-quantity item with a recognized SRD base armor name.',
    );
  if (
    gear.shieldId &&
    gear.shieldId !== 'auto' &&
    (!loadout.shield || (!isShield(loadout.shield.name) && gear.acMode !== 'manual'))
  )
    errors.push('Equipped shield must reference an owned Shield (quantity greater than zero).');
  if (loadout.armor && !training.has(armor?.category ?? ''))
    warnings.push(
      'No training with this armor: disadvantage on Strength/Dexterity D20 Tests, and you cannot cast spells.',
    );
  const shieldTrained = training.has('Shield');
  if (loadout.shield && !shieldTrained)
    warnings.push('No Shield training: this Shield supplies no AC benefit.');
  if (armor?.stealth)
    warnings.push('This armor imposes disadvantage on Dexterity (Stealth) checks.');
  const mods = scores.map((score) => Math.floor((score - 10) / 2));
  const companion = state.companions;
  const pactId = companion?.pactActive ? companion.pactOwnedId || pactConjuredId : '';
  if (companion?.pactOwnedId) {
    const owned = items.find((item) => item.id === companion.pactOwnedId && item.quantity > 0);
    if (!owned || !recognizableMagicWeapon(owned))
      errors.push(
        'The selected owned Pact weapon must be an available, recognizable magic weapon.',
      );
  }
  const itemWeapon = (item: Item) =>
    item.id === pactConjuredId && companion?.pactActive && !companion.pactOwnedId
      ? weaponProfile(companion.pactWeapon)
      : weaponProfile(item.name);
  if (pactId) {
    const pact = items.find((item) => item.id === pactId && item.quantity > 0);
    if (!pact || !itemWeapon(pact))
      errors.push(
        'The active Pact weapon must be present and have a recognized SRD weapon profile.',
      );
    else if (companion.pactOwnedId && !recognizableMagicWeapon(pact))
      errors.push(
        'Pact of the Blade can bond an existing magic weapon, not an ordinary mundane item; use conjuration or a clearly marked magic variant.',
      );
  }
  const counts = state.levels.reduce(
    (map, step) => ({ ...map, [step.className]: (map[step.className] ?? 0) + 1 }),
    {} as Partial<Record<SrdClass, number>>,
  );
  const shieldBonus =
    loadout.shield && shieldTrained
      ? 2 + Number(/\+([1-3])$/.exec(loadout.shield.name)?.[1] ?? 0)
      : 0;
  const formulas: { mode: SrdEquipment['acMode']; label: string; ac: number }[] = [];
  if (armor && profile)
    formulas.push({
      mode: 'armor',
      label: profile.name,
      ac:
        armor.ac +
        (armor.category === 'Heavy' ? 0 : Math.min(armor.dex, mods[1])) +
        profile.bonus +
        shieldBonus,
    });
  else {
    formulas.push({ mode: 'standard', label: 'Unarmored', ac: 10 + mods[1] + shieldBonus });
    if (counts.Barbarian)
      formulas.push({
        mode: 'barbarian',
        label: 'Barbarian Unarmored Defense',
        ac: 10 + mods[1] + mods[2] + shieldBonus,
      });
    if (counts.Monk && !loadout.shield)
      formulas.push({ mode: 'monk', label: 'Monk Unarmored Defense', ac: 10 + mods[1] + mods[4] });
    if ((counts.Sorcerer ?? 0) >= 3)
      formulas.push({
        mode: 'draconic',
        label: 'Draconic Resilience',
        ac: 10 + mods[1] + mods[5] + shieldBonus,
      });
  }
  const selected =
    gear.acMode === 'auto'
      ? [...formulas].sort((a, b) => b.ac - a.ac)[0]
      : formulas.find((value) => value.mode === gear.acMode);
  if (!selected && gear.acMode !== 'manual')
    errors.push(
      'The chosen AC formula is incompatible with your armor/shield or unavailable class feature.',
    );
  const defense =
    !!armor &&
    state.levels.some(
      (step) =>
        step.choices['fighting-style']?.includes('Defense') ||
        srdCatalog.find((entry) => entry.id === step.feat?.id)?.name === 'Defense',
    )
      ? 1
      : 0;
  let speed = state.species === 'Goliath' || state.lineage === 'Wood Elf' ? 35 : 30;
  if (armor?.category !== 'Heavy') {
    if ((counts.Barbarian ?? 0) >= 5) speed += 10;
    if ((counts.Ranger ?? 0) >= 6) speed += 10;
  }
  if (!armor && !loadout.shield && (counts.Monk ?? 0) >= 2)
    speed += 10 + 5 * Math.floor((counts.Monk! - 2) / 4);
  if (armor?.strength && scores[0] < armor.strength) {
    speed -= 10;
    warnings.push(
      `Strength ${armor.strength} required to avoid this armor’s 10-foot Speed reduction.`,
    );
  }
  const weapons = loadout.weapons.map((item, i) => {
    if (!item) {
      if (gear.weaponIds[i] && gear.weaponIds[i] !== 'auto')
        errors.push(
          `Weapon slot ${i + 1} must reference an owned weapon (quantity greater than zero).`,
        );
      return;
    }
    const weapon = itemWeapon(item);
    if (!weapon) {
      errors.push(
        `Weapon slot ${i + 1}: unrecognized weapon; leave this slot manual for homebrew.`,
      );
      return;
    }
    if (!/^(?:\d+d(?:4|6|8|10|12|20)|(?:0|[1-9]\d{0,2}))$/.test(weapon.dice)) {
      errors.push(
        `${weapon.name} has an unsupported damage profile; leave its attack slot manual.`,
      );
      return;
    }
    const weaponIndex = srdCatalog
      .filter((entry) => entry.kind === 'weapon')
      .findIndex((entry) => entry.name === weapon.name);
    const monkWeapon =
      !armor &&
      !loadout.shield &&
      !!counts.Monk &&
      !weapon.ranged &&
      ((weaponIndex >= 0 && weaponIndex < 10) || /\bLight\b/.test(weapon.entry.text));
    const canDex = weapon.finesse || monkWeapon;
    const automaticAbility = weapon.ranged ? 1 : canDex && mods[1] > mods[0] ? 1 : 0;
    const bonded = item.id === pactId;
    const ability =
      bonded && companion?.pactCharisma !== false
        ? 5
        : gear.weaponAbilities[i] < 0
          ? automaticAbility
          : gear.weaponAbilities[i];
    if (!(bonded && ability === 5) && !canDex && ability !== (weapon.ranged ? 1 : 0))
      errors.push(
        `${weapon.name}: Strength is required for melee and Dexterity for ranged unless Finesse or eligible Monk Martial Arts permits either. Leave the slot manual for other feature-specific overrides.`,
      );
    if (
      loadout.shield &&
      (/\bTwo-Handed\b/.test(weapon.entry.text) || (gear.twoHanded[i] && weapon.versatile))
    )
      warnings.push(`${weapon.name}: a two-handed attack requires putting away the Shield first.`);
    const archery =
      weapon.ranged &&
      state.levels.some(
        (step) =>
          step.choices['fighting-style']?.includes('Archery') ||
          srdCatalog.find((entry) => entry.id === step.feat?.id)?.name === 'Archery',
      )
        ? 2
        : 0;
    let dice = gear.twoHanded[i] && weapon.versatile ? weapon.versatile : weapon.dice;
    if (monkWeapon) {
      const martial = String(progressions.Monk.rows[counts.Monk! - 1].values[0]);
      const average = (value: string) => {
        const match = /^(\d+)d(\d+)$/.exec(value);
        return match ? (Number(match[1]) * (Number(match[2]) + 1)) / 2 : Number(value);
      };
      if (average(martial) > average(dice)) dice = martial;
    }
    return {
      ...weapon,
      item,
      ability,
      attackBonus: weapon.bonus + archery,
      proficient: bonded || weaponTrained(state, weapon.name),
      dice,
      damageType:
        bonded && companion?.pactDamage !== 'Normal' ? companion!.pactDamage : weapon.damageType,
    };
  });
  return {
    ...loadout,
    weapons,
    errors,
    warnings,
    training: [...training],
    formula: selected?.label ?? 'Manual AC',
    ac: selected ? selected.ac + defense : undefined,
    speed: Math.max(0, speed),
    stealthDisadvantage: armor?.stealth ?? false,
    cannotCast: !!armor && !training.has(armor.category),
  };
}
