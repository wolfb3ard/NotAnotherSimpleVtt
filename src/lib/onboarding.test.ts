import { expect, it } from 'vitest';
import { findableTokens, firstSessionSteps } from './onboarding';
import type { Snapshot } from './types';

const snapshot: Snapshot = {
  game: { id: 'game', name: 'Campaign', gm_id: 'gm', active_scene_id: 'scene', dice: [20] },
  userId: 'player',
  role: 'player',
  members: [{ user_id: 'player', display_name: 'Player', role: 'player' }],
  actors: [
    {
      id: 'hero',
      game_id: 'game',
      name: 'Hero',
      kind: 'character',
      owner_id: 'player',
      revision: 0,
      sheet: { version: 1, sections: [] },
    },
  ],
  scenes: [
    {
      id: 'scene',
      game_id: 'game',
      name: 'Map',
      asset_id: 'map',
      width: 600,
      height: 400,
      units_per_pixel: 1,
      unit: 'units',
      revision: 0,
      fog: [{ x: 0, y: 0, width: 300, height: 300, reveal: true }],
    },
  ],
  tokens: [
    {
      id: 'token',
      game_id: 'game',
      scene_id: 'scene',
      actor_id: 'hero',
      controller_id: 'player',
      label: 'Hero',
      asset_id: null,
      x: 100,
      y: 100,
      size: 48,
      hidden: false,
      revision: 0,
    },
  ],
  grants: [],
  templates: [],
  rolls: [],
  rollCues: [],
  diceStyles: [],
};
it('derives player completion from ownership, portrait, visible placement and durable own roll state', () => {
  expect(firstSessionSteps(snapshot).map((s) => s.done)).toEqual([true, true, false, true, false]);
  const ready = {
    ...snapshot,
    actors: [{ ...snapshot.actors[0], token_asset_id: 'portrait' }],
    onboarding: { invited: false, spawn: null, hasRolled: true },
  };
  expect(firstSessionSteps(ready).every((s) => s.done)).toBe(true);
  const transferred = { ...ready, actors: [{ ...ready.actors[0], owner_id: 'gm' }] };
  expect(firstSessionSteps(transferred).find((s) => s.id === 'character')?.done).toBe(false);
});
it('never infers ownership from a name or edit grant', () => {
  const unowned = {
    ...snapshot,
    actors: [{ ...snapshot.actors[0], name: 'Player', owner_id: 'gm' }],
    grants: [{ actor_id: 'hero', user_id: 'player', can_edit: true }],
  };
  expect(firstSessionSteps(unowned).find((s) => s.id === 'character')?.done).toBe(false);
});
it('finds multiple visible controlled tokens but excludes secrets, fog, other scenes and unrelated characters', () => {
  const token = snapshot.tokens[0];
  const varied = {
    ...snapshot,
    tokens: [
      token,
      { ...token, id: 'second' },
      { ...token, id: 'hidden', hidden: true },
      { ...token, id: 'fogged', x: 500 },
      { ...token, id: 'elsewhere', scene_id: 'other' },
      { ...token, id: 'unrelated', actor_id: 'other', controller_id: 'other' },
    ],
  };
  expect(findableTokens(varied).map((t) => t.id)).toEqual(['token', 'second']);
  expect(findableTokens({ ...varied, game: { ...snapshot.game, active_scene_id: null } })).toEqual(
    [],
  );
});
it('requires GM setup, assigned control and a revealed party; handles existing and empty games', () => {
  const gm = { ...snapshot, role: 'gm' as const, userId: 'gm' };
  expect(firstSessionSteps(gm).map((s) => s.done)).toEqual([true, true, false, false, true, true]);
  expect(
    firstSessionSteps({ ...gm, actors: [], scenes: [], tokens: [], members: [] }).every(
      (s) => !s.done,
    ),
  ).toBe(true);
  const controlledByGm = { ...gm, tokens: [{ ...snapshot.tokens[0], controller_id: 'gm' }] };
  expect(firstSessionSteps(controlledByGm).find((s) => s.id === 'party')?.done).toBe(false);
  expect(
    firstSessionSteps({ ...gm, tokens: [{ ...snapshot.tokens[0], hidden: true }] }).find(
      (s) => s.id === 'reveal',
    )?.done,
  ).toBe(false);
});
