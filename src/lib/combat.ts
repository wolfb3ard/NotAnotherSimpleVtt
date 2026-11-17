import { z } from 'zod';
import { dndId } from './dnd';
import { monsterHpId, monsterTemporaryHpId } from './monster-sheet';
import { temporaryHpId } from './resources';
import type { Actor } from './types';

export const conditionSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    source: z.string().max(160),
    notes: z.string().max(1000),
    expiry: z
      .object({
        encounter_id: z.string().uuid(),
        round: z.number().int().min(1).max(1000000),
        phase: z.enum(['start', 'end']),
      })
      .strict()
      .nullable(),
    due: z.boolean(),
  })
  .strict();
export const combatSchema = z
  .object({
    conditions: z.array(conditionSchema).max(30),
    concentration: z
      .object({
        source: z.string().trim().min(1).max(160),
        notes: z.string().max(1000),
        checks: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                damage: z.number().nonnegative().max(2e12),
                dc: z.number().int().min(10).max(30),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .nullable(),
    death: z
      .object({
        successes: z.number().int().min(0).max(3),
        failures: z.number().int().min(0).max(3),
        stable: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type Combat = z.infer<typeof combatSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export const emptyCombat = (): Combat => ({
  conditions: [],
  concentration: null,
  death: { successes: 0, failures: 0, stable: false },
});
export const combatCommandSchema = z
  .object({
    id: z.string().uuid(),
    operation_id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    state: combatSchema,
  })
  .strict();

/** Only call with an actor from the authorized snapshot, never a visible-token lookup. */
export function combatSummary(actor: Actor): string {
  const fields = actor.sheet.sections.flatMap((s) => s.fields);
  const hp = fields.find((f) => f.id === dndId('hp') || f.id === monsterHpId);
  const temp = fields.find((f) => f.id === temporaryHpId || f.id === monsterTemporaryHpId);
  const state = actor.combat ?? emptyCombat();
  return [
    ...(hp ? [`HP ${hp.value}/${hp.max}${Number(hp.value) === 0 ? ' · At 0 HP' : ''}`] : []),
    ...(temp && Number(temp.value) > 0 ? [`Temporary HP ${temp.value}`] : []),
    ...state.conditions.map((c) => `${c.name}${c.due ? ' (expiry review)' : ''}`),
    ...(state.concentration
      ? [
          `Concentrating: ${state.concentration.source}${state.concentration.checks.length ? ' (check pending)' : ''}`,
        ]
      : []),
    ...(state.death.failures >= 3
      ? ['Dead (manual recovery available)']
      : state.death.stable || state.death.successes >= 3
        ? ['Stable']
        : state.death.successes || state.death.failures
          ? [`Death saves ${state.death.successes} successes / ${state.death.failures} failures`]
          : []),
  ].join(' · ');
}
