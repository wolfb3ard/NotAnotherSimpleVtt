import { z } from 'zod';
import { srdBuilderSchema } from './srd-state';

export const actionTypes = ['Action', 'Bonus action', 'Reaction', 'Other', 'Passive'] as const;
export const rarities = [
  'Common',
  'Uncommon',
  'Rare',
  'Very rare',
  'Legendary',
  'Artifact',
] as const;
const counter = z.number().int().min(0).max(999);
const entry = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(4000),
});
const action = entry.extend({ actionType: z.enum(actionTypes) });
export const characterDetailsSchema = z
  .object({
    builder: srdBuilderSchema.optional(),
    spells: z
      .array(
        action.extend({
          level: z.number().int().min(0).max(9),
          prepared: z.boolean(),
          casting: z
            .array(
              z
                .object({
                  sourceId: z.string().min(1).max(120),
                  ability: z.number().int().min(0).max(5),
                  label: z.string().min(1).max(120),
                })
                .strict(),
            )
            .max(30)
            .optional(),
        }),
      )
      .max(200),
    items: z
      .array(
        entry
          .extend({
            rarity: z.enum(rarities),
            quantity: counter,
            requiresAttunement: z.boolean(),
            attuned: z.boolean(),
          })
          .refine(
            (item) => !item.attuned || item.requiresAttunement,
            'Item does not require attunement',
          ),
      )
      .max(200),
    features: z
      .array(
        action
          .extend({
            source: z.enum(['Class', 'Species', 'Background', 'Feat', 'Other']),
            uses: counter,
            maxUses: counter,
          })
          .refine((feature) => feature.uses <= feature.maxUses, 'Uses exceed maximum'),
      )
      .max(200),
    biography: z.object({
      physical: z.string().max(4000),
      personality: z.string().max(4000),
      history: z.string().max(4000),
    }),
  })
  .superRefine((details, ctx) => {
    const ids = [...details.spells, ...details.items, ...details.features].map((entry) => entry.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Character entry identifiers must be unique' });
    const attunementLimit =
      (details.builder?.levels.filter((level) => level.className === 'Rogue').length ?? 0) >= 13
        ? 4
        : 3;
    if (details.items.filter((item) => item.attuned).length > attunementLimit)
      ctx.addIssue({
        code: 'custom',
        message: `A character can attune to at most ${attunementLimit === 3 ? 'three' : 'four'} items`,
      });
  });

export type CharacterDetails = z.infer<typeof characterDetailsSchema>;
export function emptyCharacterDetails(): CharacterDetails {
  return {
    spells: [],
    items: [],
    features: [],
    biography: { physical: '', personality: '', history: '' },
  };
}
