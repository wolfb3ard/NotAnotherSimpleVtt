import { numericFields } from './sheets';
import { tokenRolls } from './token-rolls';
import { dndId } from './dnd';
import { monsterId } from './monster-sheet';
import { applySrdBuilder } from './srd-engine';
import type { Game, Sheet } from './types';

const defaultSystem = 'dnd-2024-srd-5.2.1';
// Printed monster AC may already include equipment. Only apply a bonus for
// a shield the GM explicitly adds beyond the printed stat block.
export const additionalShield = dndId('monster:additional-shield');
function changeMonsterShield(sheet: Sheet): Sheet {
  if (!monsterId(sheet)) throw new Error('A monster stat block is required.');
  const next = structuredClone(sheet);
  const stats = next.sections.find((s) => s.fields.some((f) => f.id === dndId('monster:ac')));
  const ac = stats?.fields.find((f) => f.id === dndId('monster:ac'));
  if (!stats || !ac) throw new Error('Set a numeric Armor Class first.');
  const equipped = stats.fields.find((f) => f.id === additionalShield);
  if (equipped) stats.fields = stats.fields.filter((f) => f.id !== additionalShield);
  else
    stats.fields.push({
      id: additionalShield,
      label: 'Additional shield equipped',
      kind: 'number',
      value: 1,
    });
  ac.value = Number(ac.value) + (equipped ? -2 : 2);
  return next;
}
const systems = new Map([
  [
    defaultSystem,
    {
      label: 'D&D 5.5e · SRD 5.2.1',
      numbers: numericFields,
      rolls: tokenRolls,
      applyProgression: applySrdBuilder,
      changeMonsterShield,
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
