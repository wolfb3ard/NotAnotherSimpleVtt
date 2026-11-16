import { expect, it } from 'vitest';
import { boardEncounter, encounterTurn } from './encounter-view';
import type { Snapshot } from './types';

function fixture() {
  return {
    userId: 'player',
    role: 'player',
    game: { active_scene_id: 'scene' },
    actors: [],
    tokens: [
      {
        id: 'visible',
        scene_id: 'scene',
        label: 'Hero',
        controller_id: 'player',
        actor_id: 'actor',
      },
    ],
    encounter: {
      id: 'encounter',
      scene_id: 'scene',
      status: 'active',
      round: 2,
      revision: 0,
      active_token_id: 'visible',
      participants: [
        { token_id: 'visible', label: 'Old label', initiative: 12 },
        { token_id: 'removed', label: 'Stale label', initiative: 15 },
      ],
    },
  } as unknown as Snapshot;
}
it('intersects tracker projections with the authorized active board, not stale entries or other scenes', () => {
  const snapshot = fixture();
  expect(boardEncounter(snapshot)!.participants).toEqual([
    { token_id: 'visible', label: 'Hero', initiative: 12 },
  ]);
  snapshot.encounter!.active_token_id = 'removed';
  expect(boardEncounter(snapshot)!.active_token_id).toBeNull();
  snapshot.game.active_scene_id = 'other';
  expect(boardEncounter(snapshot)).toBeNull();
});
it('shows Your turn only for active visible owned/controlled tokens, never paused/ended or missing tokens', () => {
  const snapshot = fixture();
  expect(encounterTurn(snapshot).yours).toBe(true);
  snapshot.encounter!.status = 'paused';
  expect(encounterTurn(snapshot).yours).toBe(false);
  snapshot.encounter!.status = 'active';
  snapshot.encounter!.active_token_id = 'removed';
  expect(encounterTurn(snapshot).token).toBeUndefined();
  snapshot.encounter!.active_token_id = 'visible';
  snapshot.role = 'gm';
  expect(encounterTurn(snapshot).yours).toBe(false);
});
