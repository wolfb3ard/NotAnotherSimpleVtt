import { z } from 'zod';
import { sheetSchema } from './sheets';

const id = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const revision = z.number().int().nonnegative();
const fog = z
  .array(
    z.object({
      x: z.number().min(0).max(4096),
      y: z.number().min(0).max(4096),
      width: z.number().min(0.01).max(4096),
      height: z.number().min(0.01).max(4096),
      reveal: z.boolean(),
    }),
  )
  .max(500);
export const commandSchemas = {
  invite: z.object({}),
  revoke_invites: z.object({}),
  dice: z.object({ dice: z.array(z.number().int().min(2).max(1000000)).min(1).max(30) }),
  actor_create: z.object({
    name,
    kind: z.enum(['character', 'npc', 'enemy']),
    owner_id: id,
    sheet: sheetSchema,
  }),
  actor_save: z.object({ id, name, sheet: sheetSchema, revision }),
  grant: z.object({ actor_id: id, user_id: id, access: z.enum(['none', 'view', 'edit']) }),
  template_create: z.object({ actor_id: id, name }),
  template_copy: z.object({ id }),
  scene_create: z.object({ name, asset_id: id }),
  scene_activate: z.object({ id }),
  scene_update: z.object({
    id,
    revision,
    fog: fog.optional(),
    units_per_pixel: z.number().positive().max(100000000).optional(),
    unit: z.string().trim().min(1).max(20).optional(),
  }),
  token_create: z.object({ actor_id: id, scene_id: id, asset_id: id.nullable() }),
  token_update: z.object({
    id,
    revision,
    x: z.number().min(0).max(4096).optional(),
    y: z.number().min(0).max(4096).optional(),
    size: z.number().min(16).max(256).optional(),
    hidden: z.boolean().optional(),
    controller_id: id.optional(),
  }),
};
export type Command = keyof typeof commandSchemas;
