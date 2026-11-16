import { dndId } from './dnd';
import type { Sheet } from './types';

// Small marker helpers: ordinary sheets need not download the monster catalog.
export const monsterSourceId = dndId('monster:source');
export const monsterHpId = dndId('monster:hp');
export const monsterTemporaryHpId = dndId('monster:temporary-hp');
export function monsterId(sheet: Sheet): string | undefined {
  const value = sheet.sections
    .flatMap((s) => s.fields)
    .find((f) => f.id === monsterSourceId)?.value;
  return typeof value === 'string' && value.startsWith('monster-') ? value : undefined;
}
