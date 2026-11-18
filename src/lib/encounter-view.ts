import type { Encounter, Snapshot } from './types';
import { visibleAt } from './geometry';

export function encounterFocusToken(snapshot: Snapshot, tokenId: string) {
  if (snapshot.preparedSceneId) return;
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  if (!scene) return;
  return snapshot.tokens.find(
    (t) =>
      t.id === tokenId &&
      t.scene_id === scene.id &&
      (snapshot.role === 'gm' || (!t.hidden && visibleAt(scene.fog, t.x, t.y))),
  );
}

/** Intersect separately fetched projections with the current authorized board. */
export function boardEncounter(snapshot: Snapshot): Encounter | null {
  const encounter = snapshot.encounter;
  if (!encounter || encounter.scene_id !== snapshot.game.active_scene_id) return null;
  const tokens = new Map(
    snapshot.tokens.filter((t) => t.scene_id === encounter.scene_id).map((t) => [t.id, t]),
  );
  const participants = encounter.participants
    .filter((p) => tokens.has(p.token_id))
    .map((p) => ({ ...p, label: tokens.get(p.token_id)!.label }));
  const inOrder = (id: string | null | undefined) =>
    participants.some((p) => p.token_id === id && (!p.outcome || p.outcome === 'active'));
  return {
    ...encounter,
    participants,
    active_token_id: inOrder(encounter.active_token_id) ? encounter.active_token_id : null,
    next_token_id:
      inOrder(encounter.active_token_id) && inOrder(encounter.next_token_id)
        ? encounter.next_token_id
        : null,
  };
}
export function encounterTurn(snapshot: Snapshot) {
  const encounter = boardEncounter(snapshot);
  const token =
    encounter?.status === 'active'
      ? snapshot.tokens.find((t) => t.id === encounter.active_token_id)
      : undefined;
  const yours =
    !!token &&
    snapshot.role === 'player' &&
    (token.controller_id === snapshot.userId ||
      snapshot.actors.some((a) => a.id === token.actor_id && a.owner_id === snapshot.userId));
  const upNext = token && snapshot.tokens.find((t) => t.id === encounter?.next_token_id);
  return { encounter, token, yours, upNext };
}
