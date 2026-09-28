import { expect, it } from 'vitest';
import { sheetSchema, numericFields } from './sheets';
import type { Sheet } from './types';

const id = '550e8400-e29b-41d4-a716-446655440000';
const fieldId = '550e8400-e29b-41d4-a716-446655440001';
const sheet: Sheet = {
  version: 1,
  sections: [
    {
      id,
      title: 'Resources',
      fields: [{ id: fieldId, label: 'Slots', kind: 'resource', value: 2, max: 4 }],
      abilities: [],
    },
  ],
};
it('validates resource counters and resolves numeric fields', () => {
  expect(sheetSchema.safeParse(sheet).success).toBe(true);
  expect(numericFields(sheet)).toEqual({ [fieldId]: 2 });
  const invalid = structuredClone(sheet);
  invalid.sections[0].fields[0].value = 5;
  expect(sheetSchema.safeParse(invalid).success).toBe(false);
});
it('rejects duplicate stable identifiers', () => {
  const invalid = structuredClone(sheet);
  invalid.sections[0].fields[0].id = id;
  expect(sheetSchema.safeParse(invalid).success).toBe(false);
});
