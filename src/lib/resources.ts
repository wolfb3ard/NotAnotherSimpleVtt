import { dndId, isDndSheet } from './dnd';
import type { Field, Sheet } from './types';
import { monsterId, monsterHpId, monsterTemporaryHpId } from './monster-sheet';

export type ResourceChange = { id: string; value: number; target?: 'feature' };
export type PlayResource = Field & { target?: 'feature' };
export type QuickUpdate = (changes: ResourceChange[]) => void;
export const temporaryHpId = dndId('temp-hp');
export const groupedHitDice = [6, 8, 10, 12].map((die) => dndId(`srd-resource:hit-die:${die}`));

export function playResources(sheet: Sheet): PlayResource[] {
  const fields = sheet.sections.flatMap((s) => s.fields);
  const grouped = fields.some((f) => groupedHitDice.includes(f.id));
  const unusedSlots = new Set(
    isDndSheet(sheet) ? Array.from({ length: 9 }, (_, i) => dndId(`slot:${i}`)) : [],
  );
  const resources: PlayResource[] = fields.filter(
    (f) =>
      f.kind === 'resource' &&
      !(grouped && f.id === dndId('hit-dice')) &&
      !(f.max === 0 && unusedSlots.has(f.id)),
  );
  if (isDndSheet(sheet) && !fields.some((f) => f.id === temporaryHpId))
    resources.push({
      id: temporaryHpId,
      label: 'Temporary HP',
      kind: 'resource',
      value: 0,
      max: 1e12,
    });
  resources.push(
    ...(sheet.character?.features ?? [])
      .filter((f) => f.maxUses > 0)
      .map((f): PlayResource => ({
        id: f.id,
        label: `${f.name} uses`,
        kind: 'resource',
        value: f.uses,
        max: f.maxUses,
        target: 'feature',
      })),
  );
  return resources;
}

/** Preview only. The RPC validates every field again against the committed sheet. */
export function previewResources(sheet: Sheet, changes: ResourceChange[]): Sheet {
  const copy = structuredClone(sheet);
  for (const change of changes) {
    if (change.target === 'feature') {
      const feature = copy.character?.features.find((f) => f.id === change.id);
      if (
        !feature ||
        !Number.isInteger(change.value) ||
        change.value < 0 ||
        change.value > feature.maxUses
      )
        throw new Error('Feature uses must be between zero and maximum.');
      feature.uses = change.value;
      continue;
    }
    const fields = copy.sections.flatMap((s) => s.fields);
    let field = fields.find((f) => f.id === change.id);
    if (!field && change.id === temporaryHpId && isDndSheet(copy)) {
      const section = copy.sections.find((s) => s.fields.some((f) => f.id === dndId('hp')));
      field = playResources(copy).find((f) => f.id === temporaryHpId);
      if (section && field) section.fields.push(field);
    }
    if (
      !field ||
      field.kind !== 'resource' ||
      !Number.isFinite(change.value) ||
      change.value < 0 ||
      change.value > (field.max ?? 0)
    )
      throw new Error('Resource value must be between zero and its maximum.');
    field.value = change.value;
  }
  const fields = copy.sections.flatMap((s) => s.fields);
  if (fields.some((f) => groupedHitDice.includes(f.id))) {
    const total = fields.find((f) => f.id === dndId('hit-dice'));
    if (changes.some((c) => !c.target && c.id === total?.id))
      throw new Error('Adjust grouped Hit Dice instead.');
    if (total)
      total.value = Math.min(
        total.max ?? 0,
        fields
          .filter((f) => groupedHitDice.includes(f.id))
          .reduce((sum, f) => sum + Number(f.value), 0),
      );
  }
  return copy;
}

export function healthChanges(
  sheet: Sheet,
  amount: number,
  mode: 'damage' | 'heal',
  useTemporary = true,
): ResourceChange[] {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12)
    throw new Error('Enter a whole amount between 0 and 1,000,000,000,000.');
  const fields = playResources(sheet);
  const monster = !!monsterId(sheet);
  const hp = fields.find((f) => f.id === (monster ? monsterHpId : dndId('hp')));
  const tempId = monster ? monsterTemporaryHpId : temporaryHpId;
  const temp = fields.find((f) => f.id === tempId);
  if ((!isDndSheet(sheet) && !monster) || !hp) throw new Error('No D&D hit points available.');
  const absorbed =
    mode === 'damage' && useTemporary ? Math.min(Number(temp?.value ?? 0), amount) : 0;
  return [
    {
      id: hp.id,
      value:
        mode === 'heal'
          ? Math.min(hp.max ?? 0, Number(hp.value) + amount)
          : Math.max(0, Number(hp.value) - (amount - absorbed)),
    },
    ...(absorbed ? [{ id: tempId, value: Number(temp!.value) - absorbed }] : []),
  ];
}
