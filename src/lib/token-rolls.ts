import { createDndSheet, dndDamageExpression, dndId, isDndSheet } from './dnd';
import type { Ability, Sheet } from './types';
import { monsterId } from './monster-sheet';

/** Use the same saved inputs/formulas as the play sheet. Never infer targeting or spend uses. */
export function tokenRolls(sheet: Sheet): Ability[] {
  if (!isDndSheet(sheet)) {
    const monster = !!monsterId(sheet);
    return sheet.sections.flatMap((s) => {
      let rules = '';
      return s.abilities.flatMap((a) => {
        if (!a.expression.trim()) {
          rules = a.description;
          return [];
        }
        return [{ ...a, description: a.description || (monster ? rules : '') }];
      });
    });
  }
  const fields = new Map(sheet.sections.flatMap((s) => s.fields).map((f) => [f.id, f.value]));
  const rolls: Ability[] = [];
  for (let i = 0; i < 3; i++) {
    const name = String(fields.get(dndId(`weapon-name:${i}`)) ?? '');
    if (!name || name === 'Unequipped') continue;
    rolls.push({
      id: `attack:${i}`,
      name: `Attack roll with ${name}`,
      description: '',
      expression: `1d20 + @{${dndId(`weapon-total:${i}`)}}`,
    });
    for (const critical of [false, true]) {
      try {
        rolls.push({
          id: `damage:${i}:${critical}`,
          name: `${critical ? 'Critical damage' : 'Damage'} with ${name}`,
          description: '',
          expression: dndDamageExpression(
            String(fields.get(dndId(`weapon-dice:${i}`)) ?? ''),
            i,
            critical,
          ),
        });
      } catch {
        // Invalid damage configuration must not prevent the attack roll.
      }
    }
  }
  const builtIn = new Set(createDndSheet().sections.flatMap((s) => s.abilities.map((a) => a.id)));
  // Spell attacks and custom abilities remain available; checks/saves live on the sheet.
  return [
    ...rolls,
    ...sheet.sections.flatMap((s) =>
      s.abilities.filter(
        (a) => a.expression.trim() && (a.id === dndId('roll:spell-attack') || !builtIn.has(a.id)),
      ),
    ),
  ];
}
