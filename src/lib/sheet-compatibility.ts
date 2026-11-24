import { z } from 'zod';
import { emptyCharacterDetails } from './character-details';
import { dndId, isDndSheet } from './dnd';
import { sheetSchema } from './sheets';
import { defaultEquipment } from './srd-equipment';
import { defaultCompanions } from './srd-shapes';
import type { Sheet } from './types';
import { withoutSrdPageReferences } from './srd-citations';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Compatibility revisions are additive within storage format v1. Keep each step deterministic
// and never run the builder here: rebuilding can change equipment, rolls, and live counters.
function upgradeV1(input: unknown) {
  if (
    !record(input) ||
    input.version !== 1 ||
    input.compatibilityVersion !== undefined ||
    !Array.isArray(input.sections) ||
    !input.sections.some((s) => record(s) && s.id === dndId('character'))
  )
    return input;

  const legacyInitiative = `1d20 + @{${dndId('check:1')}}`;
  const sections = input.sections.map((section) =>
    record(section) && Array.isArray(section.abilities)
      ? {
          ...section,
          abilities: section.abilities.map((ability) =>
            record(ability) &&
            ability.id === dndId('roll:initiative') &&
            ability.expression === legacyInitiative
              ? { ...ability, expression: `1d20 + @{${dndId('initiative')}}` }
              : ability,
          ),
        }
      : section,
  );
  let character = input.character === undefined ? emptyCharacterDetails() : input.character;
  if (record(character) && record(character.builder)) {
    const builder = character.builder;
    character = {
      ...character,
      builder: {
        ...builder,
        // Old sheets managed AC and attack slots directly. Don't auto-equip or grant gear.
        equipment:
          builder.equipment === undefined
            ? {
                ...defaultEquipment(),
                grantStarting: false,
                armorId: '',
                shieldId: '',
                acMode: 'manual',
                weaponIds: ['', '', ''],
              }
            : builder.equipment,
        companions: builder.companions === undefined ? defaultCompanions() : builder.companions,
      },
    };
  }
  return { ...input, compatibilityVersion: 1, sections, character };
}

export const compatibleSheetSchema = z.preprocess(upgradeV1, sheetSchema);

function withoutPageCitations(sheet: Sheet): Sheet {
  let changed = false;
  function clean<T extends { description?: string }>(entry: T): T {
    const description = entry.description && withoutSrdPageReferences(entry.description);
    if (description === entry.description) return entry;
    changed = true;
    return { ...entry, description };
  }
  const sections = sheet.sections.map((section) => ({
    ...section,
    abilities: section.abilities.map(clean),
  }));
  const character = sheet.character && {
    ...sheet.character,
    spells: sheet.character.spells.map(clean),
    features: sheet.character.features.map(clean),
    items: sheet.character.items.map(clean),
  };
  return changed ? { ...sheet, sections, ...(character && { character }) } : sheet;
}

/** Read-only view of a stored sheet. Failed upgrades never replace the source document. */
export function loadCompatibleSheet(sheet: Sheet): {
  sheet: Sheet;
  sheetUpgradeIssue?: string;
} {
  if (
    sheet.compatibilityVersion === 1 ||
    (!isDndSheet(sheet) && sheet.compatibilityVersion === undefined)
  )
    return { sheet: withoutPageCitations(sheet) };
  const result = compatibleSheetSchema.safeParse(sheet);
  return result.success
    ? { sheet: withoutPageCitations(result.data) }
    : { sheet, sheetUpgradeIssue: result.error.issues[0].message };
}
