import { z } from 'zod';
import type { Sheet } from './types';

const field = z
  .object({
    id: z.string().uuid(),
    label: z.string().min(1).max(80),
    kind: z.enum(['text', 'number', 'resource']),
    value: z.union([z.string().max(4000), z.number().finite().min(-1e12).max(1e12)]),
    max: z.number().finite().nonnegative().max(1e12).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'text' && typeof v.value !== 'string')
      ctx.addIssue({ code: 'custom', message: 'Text fields require text' });
    if (v.kind !== 'text' && typeof v.value !== 'number')
      ctx.addIssue({ code: 'custom', message: 'Numeric fields require numbers' });
    if (
      v.kind === 'resource' &&
      (v.max === undefined || Number(v.value) < 0 || Number(v.value) > v.max)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Resources require a value between zero and maximum',
      });
  });

export const sheetSchema = z
  .object({
    version: z.literal(1),
    sections: z
      .array(
        z.object({
          id: z.string().uuid(),
          title: z.string().min(1).max(80),
          fields: z.array(field).max(40),
          abilities: z
            .array(
              z.object({
                id: z.string().uuid(),
                name: z.string().min(1).max(80),
                description: z.string().max(4000),
                expression: z.string().max(500),
              }),
            )
            .max(30),
        }),
      )
      .max(20),
  })
  .superRefine((sheet, ctx) => {
    const ids = sheet.sections.flatMap((s) => [
      s.id,
      ...s.fields.map((f) => f.id),
      ...s.abilities.map((a) => a.id),
    ]);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Sheet identifiers must be unique' });
  });

export function numericFields(sheet: Sheet): Record<string, number> {
  return Object.fromEntries(
    sheet.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.kind !== 'text' && typeof f.value === 'number')
      .map((f) => [f.id, Number(f.value)]),
  );
}

export function emptySheet(): Sheet {
  return { version: 1, sections: [] };
}
