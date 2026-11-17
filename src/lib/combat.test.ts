import { expect, it } from 'vitest';
import { combatSchema, combatSummary, emptyCombat } from './combat';
import { createDndSheet, dndId } from './dnd';
import type { Actor } from './types';

const actor = (): Actor => ({
  id: 'actor',
  game_id: 'game',
  owner_id: 'owner',
  kind: 'character',
  name: 'Hero',
  revision: 0,
  sheet: createDndSheet(),
});
it('keeps old/generic sheets valid and reports known HP only', () => {
  const old = actor();
  expect(combatSchema.parse(emptyCombat())).toEqual(emptyCombat());
  expect(combatSummary(old)).toContain('HP');
  old.sheet = { version: 1, sections: [] };
  expect(combatSummary(old)).toBe('');
});
it('summarizes at-zero, expiry, concentration and death thresholds without mutating state', () => {
  const hero = actor();
  hero.sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('hp'))!.value = 0;
  hero.combat = emptyCombat();
  hero.combat.conditions = [
    {
      id: crypto.randomUUID(),
      name: 'Poisoned',
      source: 'Private source',
      notes: 'Private notes',
      due: true,
      expiry: null,
    },
  ];
  hero.combat.concentration = {
    source: 'Bless',
    notes: '',
    checks: [{ id: crypto.randomUUID(), damage: 20, dc: 10 }],
  };
  hero.combat.death.failures = 3;
  const summary = combatSummary(hero);
  expect(summary).toContain('At 0 HP');
  expect(summary).toContain('Poisoned (expiry review)');
  expect(summary).toContain('Concentrating: Bless (check pending)');
  expect(summary).toContain('Dead');
  expect(summary).not.toContain('Private source');
  expect(summary).not.toContain('Private notes');
  expect(hero.combat.death.failures).toBe(3);
});
