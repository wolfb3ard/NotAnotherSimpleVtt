import { z } from 'zod';
import data from './srd-data/shapes.json' with { type: 'json' };
import manifest from './srd-data/shapes-manifest.json' with { type: 'json' };
import { srdById, srdEntry } from './srd-catalog';
import { srdCastingSources } from './srd-casting';
import type { SrdBuilderState } from './srd-state';
import { weaponProfile } from './srd-equipment';

export const srdShapes = data;
export const srdShapesManifest = manifest;
export const shapeById = new Map(srdShapes.map((shape) => [shape.id, shape]));
export function wildShapeLimits(level: number) {
  return {
    count: level >= 8 ? 8 : level >= 4 ? 6 : level >= 2 ? 4 : 0,
    cr: level >= 8 ? 1 : level >= 4 ? 0.5 : 0.25,
    fly: level >= 8,
  };
}
export function eligibleWildShapes(level: number) {
  const limits = wildShapeLimits(level);
  if (!limits.count) return [];
  return srdShapes.filter(
    (shape) => shape.beast && !shape.swarm && shape.cr <= limits.cr && (limits.fly || !shape.fly),
  );
}
export function familiarShapes(pactChain = false) {
  return srdShapes.filter(
    (shape) => (shape.beast && !shape.swarm && shape.cr === 0) || (pactChain && shape.pactChain),
  );
}
export const companionSchema = z
  .object({
    familiarMode: z.enum(['none', 'spell', 'wild-companion', 'pact-chain']),
    familiarForm: z.string().max(120),
    familiarType: z.enum(['Celestial', 'Fey', 'Fiend']),
    steedAppearance: z.string().max(80),
    steedType: z.enum(['Celestial', 'Fey', 'Fiend']),
    pactWeapon: z.string().max(80),
    pactDamage: z.enum(['Normal', 'Necrotic', 'Psychic', 'Radiant']),
    pactActive: z.boolean().default(false),
    pactOwnedId: z.union([z.literal(''), z.string().uuid()]).default(''),
    pactCharisma: z.boolean().default(true),
  })
  .strict();
export type SrdCompanions = z.infer<typeof companionSchema>;
export function defaultCompanions(): SrdCompanions {
  return {
    familiarMode: 'none',
    familiarForm: '',
    familiarType: 'Fey',
    steedAppearance: '',
    steedType: 'Celestial',
    pactWeapon: '',
    pactDamage: 'Normal',
    pactActive: false,
    pactOwnedId: '',
    pactCharisma: true,
  };
}
export function pactWeaponOptions() {
  return [...srdById.values()]
    .filter((entry) => entry.kind === 'weapon' && !weaponProfile(entry.name)?.ranged)
    .map((entry) => entry.name);
}
export function companionCapabilities(state: SrdBuilderState) {
  const counts = new Map<string, number>();
  const latest = new Map<string, (typeof state.levels)[number]>();
  state.levels.forEach((step) => {
    counts.set(step.className, (counts.get(step.className) ?? 0) + 1);
    latest.set(step.className, step);
  });
  const chain =
    latest.get('Warlock')?.options.some((id) => srdById.get(id)?.name === 'Pact of the Chain') ??
    false;
  const findFamiliar = srdEntry('spell', 'Find Familiar')!.id;
  const sources = srdCastingSources(state);
  const normal =
    sources.some(
      (source) =>
        source.id !== 'class:Druid' &&
        source.id !== 'class:Warlock' &&
        source.spells.includes(findFamiliar),
    ) ||
    latest
      .get('Warlock')
      ?.options.some(
        (id) =>
          srdById.get(id)?.name === 'Pact of the Tome' &&
          latest.get('Warlock')?.choices[id]?.includes(findFamiliar),
      ) ||
    false;
  const findSteed = srdEntry('spell', 'Find Steed')!.id;
  const blade =
    latest.get('Warlock')?.options.some((id) => srdById.get(id)?.name === 'Pact of the Blade') ??
    false;
  return {
    normal,
    chain,
    blade,
    wild: (counts.get('Druid') ?? 0) >= 2,
    steed: sources.some((source) => source.spells.includes(findSteed)),
  };
}
export function companionErrors(state: SrdBuilderState): string[] {
  const selected = state.companions ?? defaultCompanions(),
    capability = companionCapabilities(state),
    errors: string[] = [];
  if (selected.familiarMode === 'none') {
    if (selected.familiarForm) errors.push('An unused familiar preset must have no form selected.');
  } else {
    if (
      (selected.familiarMode === 'spell' && !capability.normal) ||
      (selected.familiarMode === 'wild-companion' && !capability.wild) ||
      (selected.familiarMode === 'pact-chain' && !capability.chain)
    )
      errors.push('The selected familiar source is not granted by your builder choices.');
    if (
      !familiarShapes(selected.familiarMode === 'pact-chain').some(
        (shape) => shape.id === selected.familiarForm,
      )
    )
      errors.push('Choose an eligible SRD familiar form for that source.');
    if (selected.familiarMode === 'wild-companion' && selected.familiarType !== 'Fey')
      errors.push('Wild Companion familiars must be Fey.');
  }
  if (selected.steedAppearance && !capability.steed)
    errors.push('A steed preset requires the Find Steed spell/feature.');
  if (
    selected.pactWeapon &&
    (!capability.blade || !pactWeaponOptions().includes(selected.pactWeapon))
  )
    errors.push(
      'A Pact weapon preset requires Pact of the Blade and a Simple/Martial Melee weapon profile.',
    );
  if (selected.pactOwnedId && !capability.blade)
    errors.push('Bonding an owned magic weapon requires Pact of the Blade.');
  if (selected.pactOwnedId && selected.pactWeapon)
    errors.push('Choose either a conjured Pact profile or an owned magic weapon, not both.');
  if (selected.pactActive && (!capability.blade || (!selected.pactOwnedId && !selected.pactWeapon)))
    errors.push('An active Pact bond needs Pact of the Blade and a selected weapon.');
  return errors;
}
