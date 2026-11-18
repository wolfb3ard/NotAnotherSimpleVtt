import { z } from 'zod';

const id = z.string().uuid().toLowerCase();
const base = { scene_id: id, operation_id: id };
const current = { ...base, id, revision: z.number().int().min(0).max(2147483647) };
const score = z.number().finite().min(-1000000).max(1000000);
const tokens = z.array(id).min(1).max(50);
const participants = z
  .array(z.object({ token_id: id, initiative: score.nullable() }).strict())
  .min(1)
  .max(50);
export const encounterCommandSchema = z
  .discriminatedUnion('action', [
    z.object({ ...base, action: z.literal('start'), participants }).strict(),
    z.object({ ...base, action: z.literal('prepare'), participants }).strict(),
    z.object({ ...current, action: z.literal('add'), participants }).strict(),
    z.object({ ...current, action: z.literal('queue'), participants }).strict(),
    z.object({ ...current, action: z.literal('roll'), token_ids: tokens }).strict(),
    z.object({ ...current, action: z.literal('remove'), token_ids: tokens }).strict(),
    z.object({ ...current, action: z.literal('reorder'), token_ids: tokens }).strict(),
    z
      .object({
        ...current,
        action: z.literal('initiative'),
        changes: z
          .array(z.object({ token_id: id, value: score }).strict())
          .min(1)
          .max(50),
      })
      .strict(),
    z
      .object({
        ...current,
        action: z.literal('outcome'),
        token_id: id,
        outcome: z.enum(['active', 'defeated', 'fled']),
      })
      .strict(),
    z.object({ ...current, action: z.enum(['begin', 'next', 'pause', 'resume', 'end']) }).strict(),
  ])
  .superRefine((request, ctx) => {
    const ids =
      'participants' in request
        ? request.participants.map((p) => p.token_id)
        : 'token_ids' in request
          ? request.token_ids
          : 'changes' in request
            ? request.changes.map((p) => p.token_id)
            : [];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Select each token only once.' });
  });
export type EncounterRequest = z.infer<typeof encounterCommandSchema>;
export function initiativeTokenIds(request: EncounterRequest): string[] {
  return request.action === 'roll'
    ? request.token_ids
    : request.action === 'start' || request.action === 'add'
      ? request.participants.filter((p) => p.initiative === null).map((p) => p.token_id)
      : [];
}
