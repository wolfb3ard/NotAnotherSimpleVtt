import { dndId, isDndSheet } from './dnd';
import { numericFields } from './sheets';
import { compatibleSheetSchema } from './sheet-compatibility';
import type { Sheet } from './types';

/** Saved rules only. Missing generic/summoned initiative requires a manual total. */
export function initiativeExpression(sheet: Sheet): string | undefined {
  if (isDndSheet(sheet)) return `1d20 + @{${dndId('initiative')}}`;
  const abilities = sheet.sections.flatMap((s) => s.abilities);
  const ability =
    abilities.find((a) => a.id === dndId('monster:initiative')) ??
    abilities.find((a) => a.name.trim().toLowerCase() === 'initiative');
  if (ability?.expression.trim()) return ability.expression;
  const field = sheet.sections
    .flatMap((s) => s.fields)
    .find((f) => f.kind === 'number' && f.label.trim().toLowerCase() === 'initiative');
  return field ? `1d20 + @{${field.id}}` : undefined;
}
export function initiativeInput(sheet: Sheet) {
  const validated = compatibleSheetSchema.parse(sheet);
  const expression = initiativeExpression(validated);
  if (!expression)
    throw new Error(
      'No saved initiative rule. Enter a manual total or configure an Initiative ability/modifier on the sheet.',
    );
  return { expression, fields: numericFields(validated) };
}
