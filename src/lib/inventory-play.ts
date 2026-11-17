import { emptyCharacterDetails } from './character-details';
import { dndId } from './dnd';
import { monsterId } from './monster-sheet';
import { applySrdBuilder } from './srd-engine';
import {
  armorProfile,
  deriveEquipment,
  isShield,
  resolveLoadout,
  weaponProfile,
} from './srd-equipment';
import { builderScores } from './srd-state';
import type { Sheet } from './types';

export const additionalShield = dndId('monster:additional-shield');
const legacyShieldId = dndId('monster:legacy-shield-item');
const monsterWeapon = dndId('monster:additional-weapon');
const monsterArmor = dndId('monster:additional-armor');

function monsterSlot(item: { id: string; name: string }) {
  if (item.id === legacyShieldId || item.name === 'Shield') return additionalShield;
  if (weaponProfile(item.name)) return monsterWeapon;
  if (armorProfile(item.name)) return monsterArmor;
}

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
    const slot = monster ? monsterSlot(item) : undefined;
    const equipped = monster
      ? (slot !== undefined && fields.some((f) => f.id === slot && f.value === item.id)) ||
        (item.id === legacyShieldId && shield?.value === 1)
      : [
          loadout?.armor?.id,
          loadout?.shield?.id,
          ...(loadout?.weapons.map((w) => w?.id) ?? []),
        ].includes(item.id);
    return {
      item,
      equipped,
      equippable: monster
        ? !!slot && (slot !== additionalShield || canShield)
        : !!loadout &&
          !!(isShield(item.name) || armorProfile(item.name) || weaponProfile(item.name)),
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
  if (monsterId(next) && monsterSlot(item) !== additionalShield) {
    const slot = monsterSlot(item)!;
    const section =
      next.sections.find((s) => s.fields.some((f) => f.id === slot)) ??
      next.sections.find((s) => s.id === dndId('monster:section:stats')) ??
      next.sections[0];
    section.fields = section.fields.filter((f) => f.id !== slot);
    if (!equipped)
      section.fields.push({
        id: slot,
        label: slot === monsterWeapon ? 'Extra weapon equipped' : 'Extra armor equipped',
        kind: 'text',
        value: item.id,
      });
    return {
      sheet: next,
      message: `${item.name} ${equipped ? 'unequipped' : 'equipped'} · stat block unchanged.`,
    };
  }
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
    if (weaponProfile(item.name) && !isShield(item.name) && !armorProfile(item.name)) {
      const items = next.character!.items;
      const loadout = resolveLoadout(state, items);
      const fields = next.sections.flatMap((s) => s.fields);
      const field = (key: string, i: number) => fields.find((f) => f.id === dndId(`${key}:${i}`))!;
      if (equipped) {
        const derived = deriveEquipment(state, items, builderScores(state));
        for (const [i, weapon] of loadout.weapons.entries()) {
          if (weapon?.id !== item.id) continue;
          state.equipment.weaponIds[i] = '';
          state.equipment.twoHanded[i] = false;
          state.equipment.weaponAbilities[i] = -1;
          field('weapon-name', i).value = 'Unequipped';
          for (const [key, applied, fallback] of [
            ['weapon-hit', state.equipment.appliedWeaponBonuses, derived.weapons[i]?.attackBonus],
            ['weapon-damage', state.equipment.appliedDamageBonuses, derived.weapons[i]?.bonus],
          ] as const) {
            const adjustment = field(key, i);
            adjustment.value = Number(adjustment.value) - (applied?.[i] ?? fallback ?? 0);
            if (applied) applied[i] = 0;
          }
          const section = next.sections.find((s) => s.id === dndId(`weapon:${i}`));
          if (section?.title === `Attack ${i + 1} · ${item.name}`.slice(0, 80))
            section.title = `Attack ${i + 1} · Unequipped`;
        }
        return { sheet: next, message: `${item.name} unequipped.` };
      }
      const slot = loadout.weapons.findIndex(
        (weapon, i) => !weapon && field('weapon-name', i).value === 'Unequipped',
      );
      if (slot < 0)
        throw new Error(
          'No free attack slot. Unequip a weapon first or configure a slot in the builder.',
        );
      state.equipment.weaponIds[slot] = item.id;
      state.equipment.twoHanded[slot] = false;
      state.equipment.weaponAbilities[slot] = -1;
      return {
        sheet: applySrdBuilder(sheet, state),
        message: `${item.name} equipped in attack slot ${slot + 1}.`,
      };
    }
    state.equipment[isShield(item.name) ? 'shieldId' : 'armorId'] = equipped ? '' : item.id;
    return {
      sheet: applySrdBuilder(sheet, state),
      message: `${item.name} ${equipped ? 'unequipped' : 'equipped'}.`,
    };
  }
  return { sheet: next, message: `${item.name} ${equipped ? 'unequipped' : 'equipped'}.` };
}
