import { numericFields } from './sheets';
import { tokenRolls } from './token-rolls';
import { dndId } from './dnd';
import { monsterId } from './monster-sheet';
import { applySrdBuilder } from './srd-engine';
import { changeInventory } from './inventory-play';
import type { Game, Sheet } from './types';

const defaultSystem = 'dnd-2024-srd-5.2.1';
const systems = new Map([
  [
    defaultSystem,
    {
      label: 'D&D 5.5e · SRD 5.2.1',
      numbers: numericFields,
      rolls: tokenRolls,
      applyProgression: applySrdBuilder,
      changeInventory,
      armorClass(sheet: Sheet) {
        const key = dndId(monsterId(sheet) ? 'monster:ac' : 'ac');
        return sheet.sections.flatMap((s) => s.fields).find((f) => f.id === key)?.value;
      },
    },
  ],
]);

export function tableSystem(game: Pick<Game, 'rule_system'>) {
  const system = systems.get(game.rule_system ?? defaultSystem);
  if (!system) throw new Error('This table requires an unsupported game system.');
  return system;
}
