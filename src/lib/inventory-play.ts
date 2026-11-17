import { emptyCharacterDetails } from './character-details';
import { dndId } from './dnd';
import { monsterId } from './monster-sheet';
import { applySrdBuilder } from './srd-engine';
import { armorProfile, isShield, resolveLoadout } from './srd-equipment';
import type { Sheet } from './types';

export const additionalShield = dndId('monster:additional-shield');
const legacyShieldId = dndId('monster:legacy-shield-item');

export function inventoryEntries(sheet: Sheet) {
  const items = sheet.character?.items ?? [];
  const monster = !!monsterId(sheet);
  const fields = sheet.sections.flatMap((s) => s.fields);
  const shield = monster ? fields.find((f) => f.id === additionalShield) : undefined;
  const canShield = monster && fields.some((f) => f.id === dndId('monster:ac'));
  const builder = sheet.character?.builder;
  const loadout = builder && resolveLoadout(builder, items);
  const legacy =
    shield?.value === 1
      ? [
          {
            id: legacyShieldId,
            name: 'Additional shield',
            description: 'An extra shield beyond the printed stat block.',
            rarity: 'Common' as const,
            quantity: 1,
            requiresAttunement: false,
            attuned: false,
          },
        ]
      : [];
  return [...items, ...legacy].map((item) => {
    const extra = item.id === legacyShieldId || item.name === 'Shield';
    const equipped = monster
      ? shield?.value === item.id || (item.id === legacyShieldId && shield?.value === 1)
      : [
          loadout?.armor?.id,
          loadout?.shield?.id,
          ...(loadout?.weapons.map((w) => w?.id) ?? []),
        ].includes(item.id);
    return {
      item,
      equipped,
      equippable: monster
        ? canShield && extra
        : !!loadout && !!(isShield(item.name) || armorProfile(item.name)),
    };
  });
}

export function changeInventory(
  sheet: Sheet,
  action: { type: 'toggle' | 'use'; id: string } | { type: 'add'; id: string; name: string },
) {
  const next = structuredClone(sheet);
  if (action.type === 'add') {
    if (!monsterId(sheet)) throw new Error('Use character editing to add inventory.');
    const details = (next.character ??= emptyCharacterDetails());
    if (details.items.length >= 200) throw new Error('Inventory is full.');
    const name = action.name.trim();
    if (!name || name.length > 80) throw new Error('Enter an item name of up to 80 characters.');
    details.items.push({
      id: action.id,
      name,
      quantity: 1,
      description: '',
      rarity: 'Common',
      requiresAttunement: false,
      attuned: false,
    });
    return { sheet: next, message: `${name} added.` };
  }
  const entry = inventoryEntries(next).find((e) => e.item.id === action.id);
  if (!entry) throw new Error('Item is no longer in inventory.');
  const { item, equipped, equippable } = entry;
  if (action.type === 'use') {
    if (item.quantity < 1 || equipped || equippable) throw new Error('This item cannot be spent.');
    item.quantity--;
    return { sheet: next, message: `${item.name} used · ${item.quantity} remaining.` };
  }
  if (!equippable || (!equipped && !item.quantity))
    throw new Error('This item cannot be equipped.');
  if (monsterId(next)) {
    const stats = next.sections.find((s) => s.fields.some((f) => f.id === dndId('monster:ac')))!;
    const ac = stats.fields.find((f) => f.id === dndId('monster:ac'))!;
    const old = stats.fields.find((f) => f.id === additionalShield);
    if (old?.value === 1 && next.character?.items.length === 200)
      throw new Error('Inventory is full.');
    if (old?.value === 1)
      (next.character ??= emptyCharacterDetails()).items.push(
        inventoryEntries(next).find((e) => e.item.id === legacyShieldId)!.item,
      );
    stats.fields = stats.fields.filter((f) => f.id !== additionalShield);
    if (!equipped)
      stats.fields.push({
        id: additionalShield,
        label: 'Additional shield equipped',
        kind: 'text',
        value: item.id,
      });
    ac.value = Number(ac.value) + (equipped ? -2 : old ? 0 : 2);
  } else {
    const state = next.character!.builder!;
    state.equipment[isShield(item.name) ? 'shieldId' : 'armorId'] = equipped ? '' : item.id;
    return {
      sheet: applySrdBuilder(sheet, state),
      message: `${item.name} ${equipped ? 'unequipped' : 'equipped'}.`,
    };
  }
  return { sheet: next, message: `${item.name} ${equipped ? 'unequipped' : 'equipped'}.` };
}
