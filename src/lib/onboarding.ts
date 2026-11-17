import { visibleAt } from './geometry';
import type { Snapshot } from './types';

export function findableTokens(snapshot: Snapshot) {
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  return snapshot.tokens.filter(
    (t) =>
      !!scene &&
      t.scene_id === scene.id &&
      !t.hidden &&
      visibleAt(scene.fog, t.x, t.y) &&
      (t.controller_id === snapshot.userId ||
        snapshot.actors.some(
          (a) => a.id === t.actor_id && a.kind === 'character' && a.owner_id === snapshot.userId,
        )),
  );
}

export type GuideStep = {
  id: string;
  label: string;
  done: boolean;
  action: 'settings' | 'scenes' | 'party' | 'dice' | 'sheet' | 'map';
};
export function firstSessionSteps(snapshot: Snapshot): GuideStep[] {
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const mine = snapshot.actors.filter(
    (a) => a.kind === 'character' && a.owner_id === snapshot.userId,
  );
  if (snapshot.role === 'gm') {
    const party = snapshot.actors.filter(
      (a) => a.kind === 'character' && a.owner_id !== snapshot.userId,
    );
    const placed =
      party.length > 0 &&
      party.every((a) =>
        snapshot.tokens.some(
          (t) => t.actor_id === a.id && t.scene_id === scene?.id && t.controller_id === a.owner_id,
        ),
      );
    return [
      {
        id: 'invite',
        label: 'Invite players · Room → Create invitation link',
        done: !!snapshot.onboarding?.invited || snapshot.members.some((m) => m.role === 'player'),
        action: 'settings',
      },
      { id: 'map', label: 'Upload and activate a map · Scenes', done: !!scene, action: 'scenes' },
      {
        id: 'scale',
        label: 'Calibrate · draw a known distance, then Set scale',
        done: !!scene?.calibrated,
        action: 'map',
      },
      {
        id: 'spawn',
        label: 'Set party spawn · click a safe starting point',
        done: !!snapshot.onboarding?.spawn,
        action: 'map',
      },
      {
        id: 'party',
        label: 'Assign characters to players, then place their tokens',
        done: placed,
        action: 'party',
      },
      {
        id: 'reveal',
        label: 'Reveal the party area · verify with Player view',
        done:
          placed &&
          party.every((a) =>
            snapshot.tokens.some(
              (t) =>
                t.actor_id === a.id &&
                t.scene_id === scene?.id &&
                !t.hidden &&
                !!scene &&
                visibleAt(scene.fog, t.x, t.y),
            ),
          ),
        action: 'map',
      },
    ];
  }
  return [
    {
      id: 'join',
      label: 'Join the campaign',
      done: snapshot.members.some((m) => m.user_id === snapshot.userId),
      action: 'settings',
    },
    {
      id: 'character',
      label: 'Create a character, or ask the GM to assign an existing one',
      done: mine.length > 0,
      action: 'party',
    },
    {
      id: 'portrait',
      label: 'Choose a portrait · open your sheet → token appearance',
      done: mine.length > 0 && mine.every((a) => !!a.token_asset_id),
      action: 'sheet',
    },
    {
      id: 'place',
      label: 'Place your character in a revealed party area',
      done:
        mine.length > 0 &&
        mine.every((a) => findableTokens(snapshot).some((t) => t.actor_id === a.id)),
      action: 'party',
    },
    {
      id: 'roll',
      label: 'Make a test roll · check its audience first',
      done:
        !!snapshot.onboarding?.hasRolled ||
        snapshot.rolls.some((r) => r.author_id === snapshot.userId),
      action: 'dice',
    },
  ];
}
