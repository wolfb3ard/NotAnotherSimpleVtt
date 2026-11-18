// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { EncounterPanel, EncounterTurnCue } from './encounter-panel';
import { useEncounterCommand } from './use-encounter-command';
import { createDndSheet } from '@/lib/dnd';
import type { Snapshot } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scene = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hero = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  enemy = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  encounter = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let root: Root, container: HTMLDivElement;
function fixture(live = true): Snapshot {
  return {
    userId: 'gm',
    role: 'gm',
    game: { id: game, name: 'Game', gm_id: 'gm', active_scene_id: scene, dice: [20] },
    scenes: [
      {
        id: scene,
        game_id: game,
        name: 'Map',
        asset_id: 'map',
        width: 300,
        height: 300,
        unit: 'ft',
        units_per_pixel: 1,
        revision: 0,
        fog: [],
      },
    ],
    actors: [
      {
        id: hero,
        game_id: game,
        name: 'Hero',
        kind: 'character',
        owner_id: 'player',
        sheet: createDndSheet(),
        revision: 0,
      },
      {
        id: enemy,
        game_id: game,
        name: 'Secret enemy',
        kind: 'enemy',
        owner_id: 'gm',
        sheet: { version: 1, sections: [] },
        revision: 0,
      },
    ],
    tokens: [hero, enemy].map((id) => ({
      id,
      actor_id: id,
      game_id: game,
      scene_id: scene,
      label: id === hero ? 'Hero' : 'Secret enemy',
      controller_id: id === hero ? 'player' : 'gm',
      x: 100,
      y: 100,
      size: 48,
      hidden: id === enemy,
      asset_id: null,
      revision: 0,
    })),
    encounter: live
      ? {
          id: encounter,
          scene_id: scene,
          status: 'active',
          round: 1,
          revision: 4,
          active_token_id: hero,
          participants: [
            { token_id: hero, label: 'Hero', initiative: 15 },
            { token_id: enemy, label: 'Secret enemy', initiative: 10 },
          ],
        }
      : null,
    grants: [],
    members: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
}
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}
const buttons = () => [...container.querySelectorAll('button')];
const button = (text: string) => buttons().find((b) => b.textContent === text)!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(label: string, next: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const refresh = vi.fn(async () => {});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
  refresh.mockClear();
});
it('selects board tokens in click order, requires a manual total for missing rules and sends no client dice', async () => {
  const run = vi.fn().mockResolvedValue({ id: encounter, revision: '1' });
  await mount(
    createElement(EncounterPanel, { snapshot: fixture(false), run, refresh, onSheet: vi.fn() }),
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('[aria-label="Include Secret enemy in encounter"]')!
      .click(),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>('[aria-label="Include Hero in encounter"]')!.click(),
  );
  expect(button('Start encounter').disabled).toBe(true);
  await value('Manual initiative for Secret enemy', '17');
  await click('Start encounter');
  expect(run).toHaveBeenCalledExactlyOnceWith(
    'encounter',
    expect.objectContaining({
      action: 'start',
      scene_id: scene,
      operation_id: expect.any(String),
      participants: [
        { token_id: enemy, initiative: 17 },
        { token_id: hero, initiative: null },
      ],
    }),
  );
});
it('prevents double advancement and waits for a snapshot rather than advancing optimistically', async () => {
  let resolve!: (v: Record<string, string>) => void;
  const run = vi.fn(
    () =>
      new Promise<Record<string, string>>((done) => {
        resolve = done;
      }),
  );
  const snapshot = fixture();
  await mount(createElement(EncounterPanel, { snapshot, run, refresh, onSheet: vi.fn() }));
  await act(async () => {
    button('Next turn').click();
    button('Next turn').click();
  });
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0]).toEqual([
    'encounter',
    expect.objectContaining({ action: 'next', id: encounter, revision: 4 }),
  ]);
  expect(container.querySelector('[aria-current="step"]')!.textContent).toContain('Hero');
  expect(button('Next turn').disabled).toBe(true);
  await act(async () => resolve({ id: encounter, revision: '5' }));
  expect(container.querySelector('[aria-current="step"]')!.textContent).toContain('Hero');
});
it('prepares without rolls, shows readiness and sends begin only when ready', async () => {
  const run = vi.fn().mockResolvedValue({ id: encounter, revision: '5' });
  const render = (snapshot: Snapshot) =>
    createElement(EncounterPanel, { snapshot, run, refresh, onSheet: vi.fn() });
  await mount(render(fixture(false)));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Include Hero in encounter"]')!.click(),
  );
  await click('Prepare encounter');
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({
      action: 'prepare',
      participants: [{ token_id: hero, initiative: null }],
    }),
  );
  const setup = fixture();
  setup.encounter!.status = 'setup';
  setup.encounter!.active_token_id = null;
  setup.encounter!.participants[0].initiative = null;
  await act(async () => root.render(render(setup)));
  expect(container.textContent).toContain('1 of 2 ready');
  expect(container.textContent).toContain('Not rolled');
  expect(button('Begin combat').disabled).toBe(true);
  setup.encounter!.participants[0].initiative = 15;
  await act(async () => root.render(render(setup)));
  await click('Begin combat');
  expect(run).toHaveBeenLastCalledWith('encounter', expect.objectContaining({ action: 'begin' }));
});
it('shows Up next and moves defeated or fled combatants out of the turn order', async () => {
  const run = vi.fn().mockResolvedValue({ id: encounter, revision: '5' });
  const snapshot = fixture();
  snapshot.encounter!.next_token_id = enemy;
  const render = () => createElement(EncounterPanel, { snapshot, run, refresh, onSheet: vi.fn() });
  await mount(render());
  expect(container.textContent).toContain('Up next: Secret enemy');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Mark Secret enemy fled"]')!.click(),
  );
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({
      action: 'outcome',
      token_id: enemy,
      outcome: 'fled',
    }),
  );
  snapshot.encounter!.participants[1].outcome = 'fled';
  await act(async () => root.render(render()));
  expect(container.querySelector('[aria-label="Turn order"]')?.textContent).not.toContain(
    'Secret enemy',
  );
  expect(container.querySelector('[aria-label="Out of the turn order"]')?.textContent).toContain(
    'Secret enemy · Fled',
  );
  expect(container.textContent).not.toContain('Up next: Secret enemy');
});
it('lets the current player end the turn and focus only authorized tokens; offers undo to the GM', async () => {
  const snapshot = fixture();
  snapshot.role = 'player';
  snapshot.userId = 'player';
  snapshot.scenes[0].fog = [{ x: 0, y: 0, width: 200, height: 200, reveal: true }];
  snapshot.encounter!.end_turn_key = 'a'.repeat(32);
  const run = vi.fn().mockResolvedValue({ id: encounter, revision: '0' });
  const onFocusToken = vi.fn();
  const render = () =>
    createElement(EncounterPanel, { snapshot, run, refresh, onSheet: vi.fn(), onFocusToken });
  await mount(render());
  expect(container.querySelector('[aria-label="Find Secret enemy on map"]')).toBeNull();
  await click('Hero');
  expect(onFocusToken).toHaveBeenCalledWith(hero);
  expect(run).not.toHaveBeenCalled();
  await click('End turn');
  expect(run).toHaveBeenCalledWith('encounter', {
    action: 'end_turn',
    id: encounter,
    scene_id: scene,
    turn_key: 'a'.repeat(32),
    operation_id: expect.any(String),
  });
  snapshot.role = 'gm';
  snapshot.encounter!.can_undo_turn = true;
  await act(async () => root.render(render()));
  expect(button('End turn')).toBeUndefined();
  await click('Undo turn');
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({ action: 'undo_turn' }),
  );
});
it('restores an uncertain command after remount and retries the same revision and operation', async () => {
  const run = vi.fn().mockResolvedValue(undefined),
    snapshot = fixture();
  await mount(createElement(EncounterPanel, { snapshot, run, refresh, onSheet: vi.fn() }));
  await click('Next turn');
  const request = run.mock.calls[0][1];
  expect(container.textContent).toContain('failed or unconfirmed');
  await act(async () => root.unmount());
  await mount(createElement(EncounterPanel, { snapshot, run, refresh, onSheet: vi.fn() }));
  expect(button('Next turn').disabled).toBe(true);
  run.mockResolvedValue({ id: encounter, revision: '5' });
  await click('Retry encounter change');
  expect(run.mock.calls[1]).toEqual(['encounter', request]);
  expect(sessionStorage.length).toBe(0);
});
it('shows initiative, offers manual editing and only allows ties to be reordered', async () => {
  const run = vi.fn().mockResolvedValue({ id: encounter, revision: '5' });
  await mount(
    createElement(EncounterPanel, { snapshot: fixture(), run, refresh, onSheet: vi.fn() }),
  );
  expect(container.querySelector('.initiative-score')?.textContent).toBe('Initiative 15');
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Move Hero down"]')!.disabled,
  ).toBe(true);
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '12.5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Set initiative for Hero');
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({ action: 'initiative', changes: [{ token_id: hero, value: 12.5 }] }),
  );
  const tied = fixture();
  tied.encounter!.participants[1].initiative = 15;
  await act(async () =>
    root.render(createElement(EncounterPanel, { snapshot: tied, run, refresh, onSheet: vi.fn() })),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Move Hero down"]')!.click(),
  );
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({ action: 'reorder', token_ids: [enemy, hero] }),
  );
  await click('Remove from encounter');
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({ action: 'remove', token_ids: [hero] }),
  );
});
it('exposes a read-only player tracker and Your turn cue without hidden labels or GM controls', async () => {
  const snapshot = fixture();
  snapshot.role = 'player';
  snapshot.userId = 'player';
  snapshot.tokens = snapshot.tokens.filter((t) => t.id === hero);
  snapshot.actors = snapshot.actors.filter((a) => a.id === hero);
  snapshot.encounter!.participants = snapshot.encounter!.participants.filter(
    (p) => p.token_id === hero,
  );
  await mount(
    createElement(
      Fragment,
      null,
      createElement(EncounterTurnCue, { snapshot }),
      createElement(EncounterPanel, { snapshot, run: vi.fn(), refresh, onSheet: vi.fn() }),
    ),
  );
  expect(container.textContent).toContain('Your turn');
  expect(container.textContent).not.toContain('Secret enemy');
  expect(buttons().map((b) => b.textContent)).toEqual(['Sheet for Hero']);
  snapshot.encounter = { ...snapshot.encounter!, active_token_id: null };
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(EncounterTurnCue, { snapshot }),
        createElement(EncounterPanel, { snapshot, run: vi.fn(), refresh, onSheet: vi.fn() }),
      ),
    ),
  );
  expect(container.textContent).toContain('Waiting for GM');
  expect(container.textContent).not.toContain('Your turn');
  expect(container.textContent).not.toContain('Hidden combatant');
});
it('does not show another scene encounter or paused Your turn cues', async () => {
  const snapshot = fixture();
  snapshot.role = 'player';
  snapshot.userId = 'player';
  snapshot.encounter!.status = 'paused';
  await mount(createElement(EncounterTurnCue, { snapshot }));
  expect(container.textContent).toContain('Encounter paused');
  expect(container.textContent).not.toContain('Your turn');
  snapshot.encounter!.scene_id = game;
  await act(async () => root.render(createElement(EncounterTurnCue, { snapshot })));
  expect(container.textContent).toBe('');
});
it('isolates late command failures and restored attempts across scene scopes', async () => {
  let resolve!: (v: undefined) => void;
  const run = vi.fn(
    () =>
      new Promise<undefined>((done) => {
        resolve = done;
      }),
  );
  function Harness({ scope }: { scope: string }) {
    const op = useEncounterCommand(scope, run, refresh);
    return createElement(
      'div',
      null,
      createElement('span', null, op.message),
      createElement(
        'button',
        {
          disabled: op.blocked,
          onClick: () =>
            void op.commit({ action: 'next', scene_id: scene, id: encounter, revision: 4 }),
        },
        'Next',
      ),
    );
  }
  await mount(createElement(Harness, { scope: 'scene-a' }));
  await click('Next');
  await act(async () => root.render(createElement(Harness, { scope: 'scene-b' })));
  await act(async () => resolve(undefined));
  expect(container.textContent).not.toContain('unconfirmed');
  expect(button('Next').disabled).toBe(false);
  expect(sessionStorage.getItem('vtt-encounter:scene-a')).not.toBeNull();
  expect(sessionStorage.getItem('vtt-encounter:scene-b')).toBeNull();
});
