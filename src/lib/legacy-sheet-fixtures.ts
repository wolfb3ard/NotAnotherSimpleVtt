import { createDndSheet, dndId } from './dnd';
import { applySrdBuilder } from './srd-engine';
import { fighterBuilder, classBuilder } from './srd-test-fixtures';

export const oldInitiative = `1d20 + @{${dndId('check:1')}}`;

/** Pre-tabs manual sheet and pre-equipment builder sheet, with ongoing campaign state. */
export function legacySheet(kind: 'manual' | 'fighter' | 'bard') {
  const sheet =
    kind === 'manual'
      ? createDndSheet()
      : applySrdBuilder(
          createDndSheet(),
          kind === 'fighter' ? fighterBuilder(4) : classBuilder('Bard', 1),
        );
  const fields = sheet.sections.flatMap((s) => s.fields);
  fields.find((f) => f.id === dndId('hp'))!.value = 2;
  fields.find((f) => f.id === dndId('ac'))!.value = 19;
  if (kind === 'bard') fields.find((f) => f.id === dndId('slot:0'))!.value = 0;
  const initiative = sheet.sections
    .flatMap((s) => s.abilities)
    .find((a) => a.id === dndId('roll:initiative'))!;
  initiative.expression = oldInitiative;
  sheet.sections[0].abilities.push({
    id: 'd1364a45-9cdc-42f2-9f43-76a94d342c91',
    name: 'Homebrew clock',
    description: 'Campaign-specific roll',
    expression: oldInitiative,
  });
  if (sheet.character?.builder) {
    Reflect.deleteProperty(sheet.character.builder, 'equipment');
    Reflect.deleteProperty(sheet.character.builder, 'companions');
  }
  return sheet;
}
