import { z } from 'zod';
import { sheetSchema } from './sheets';
import { tokenRings } from './token-appearance';
import { encounterCommandSchema } from './encounter-commands';
import { combatCommandSchema } from './combat';
import { gridSchema } from './navigation';
import { tacticalCommandSchema } from './tactical-templates';

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
  scene_draft: z.object({ name, asset_id: id }),
  scene_publish: z.object({ scene_id: id, previous: id.nullable(), revision, party: z.boolean() }),
  group_save: z.object({ scene_id: id, name }),
  group_place: z.object({
    scene_id: id,
    group_id: id,
    member: z.number().int().min(0).max(19).optional(),
    x: z.number().finite().nonnegative().optional(),
    y: z.number().finite().nonnegative().optional(),
  }),
  tactical_template: tacticalCommandSchema,
  scene_grid: z.object({
    preparing: z.boolean().optional(),
    scene_id: id,
    revision,
    operation_id: id,
    feet_per_cell: z.number().min(0.001).max(100000).optional(),
    grid: gridSchema,
  }),
  scene_calibrate: z.object({
    preparing: z.boolean().optional(),
    scene_id: id,
    revision,
    units_per_pixel: z.number().finite().positive().max(100000000),
    unit: z.string().trim().min(1).max(20),
  }),
  party_spawn: z.object({
    preparing: z.boolean().optional(),
    scene_id: id,
    revision,
    x: z.number().finite().min(0).max(4096),
    y: z.number().finite().min(0).max(4096),
  }),
  token_place: z
    .object({
      preparing: z.boolean().optional(),
      actor_id: id,
      scene_id: id,
      revision,
      operation_id: id,
      x: z.number().finite().min(0).max(4096).optional(),
      y: z.number().finite().min(0).max(4096).optional(),
    })
    .refine((p) => (p.x === undefined) === (p.y === undefined), 'Choose both coordinates.'),
  actor_combat: combatCommandSchema,
  assist_damage: z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('apply'),
        id,
        token_id: id,
        operation_id: id,
        revision,
        combat_revision: revision,
        amount: z.number().int().min(1).max(1e12),
      })
      .strict(),
    z
      .object({
        action: z.literal('undo'),
        id,
        token_id: id,
        operation_id: id,
      })
      .strict(),
  ]),
  encounter: encounterCommandSchema,
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
  actor_resources: z.object({
    id,
    revision,
    operation_id: id,
    changes: z
      .array(
        z
          .object({
            id,
            value: z.number().finite().min(0).max(1e12),
            target: z.literal('feature').optional(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  }),
  actor_appearance: z.object({
    id,
    asset_id: id.nullable(),
    ring: z.enum(
      Object.keys(tokenRings) as [keyof typeof tokenRings, ...(keyof typeof tokenRings)[]],
    ),
    revision,
  }),
  actor_delete: z.object({ id, revision }),
  actor_owner: z.object({ actor_id: id, owner_id: id, revision }),
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
  token_create: z.object({ actor_id: id, scene_id: id }),
  creature_add: z
    .object({
      scene_id: id,
      operation_id: id,
      count: z.number().int().min(1).max(20),
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('srd'), monster_id: z.string().min(1).max(120) }).strict(),
        z.object({ kind: z.literal('actor'), actor_id: id, revision }).strict(),
      ]),
    })
    .strict(),
  tabletop_history: z.object({ preparing: z.boolean().optional(), scene_id: id }),
  tabletop_undo: z.object({ preparing: z.boolean().optional(), scene_id: id, operation_id: id }),
  tabletop_move: z.object({
    preparing: z.boolean().optional(),
    id,
    scene_id: id,
    operation_id: id,
    revision,
    x: z.number().finite().min(0).max(4096),
    y: z.number().finite().min(0).max(4096),
  }),
  tabletop_move_group: z
    .object({
      preparing: z.boolean().optional(),
      scene_id: id,
      operation_id: id,
      moves: z
        .array(
          z
            .object({
              id,
              revision,
              x: z.number().min(0).max(4096),
              y: z.number().min(0).max(4096),
            })
            .strict(),
        )
        .min(2)
        .max(1000)
        .refine((moves) => new Set(moves.map((move) => move.id)).size === moves.length),
    })
    .strict(),
  tabletop_fog: z.object({
    preparing: z.boolean().optional(),
    id,
    scene_id: id,
    operation_id: id,
    revision,
    fog,
  }),
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
