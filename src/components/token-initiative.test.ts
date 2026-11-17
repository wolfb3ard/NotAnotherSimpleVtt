// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TokenInitiative } from './token-initiative';
import { createDndSheet } from '@/lib/dnd';
import type { Actor, Snapshot, Token } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let root: Root;
let container: HTMLDivElement;
async function setup() {
  const actor: Actor = {
    id: id(1),
    game_id: id(2),
    name: 'Hero',
    kind: 'character',
    owner_id: id(3),
    revision: 0,
    sheet: createDndSheet(),
  };
  const token: Token = {
    id: id(4),
    game_id: id(2),
    scene_id: id(5),
    actor_id: actor.id,
    controller_id: id(3),
    label: 'Hero',
    x: 10,
    y: 10,
    size: 50,
    asset_id: null,
    hidden: false,
    revision: 0,
  };
  const snapshot: Snapshot = {
    userId: id(3),
    role: 'gm',
    game: { id: id(2), gm_id: id(3), name: 'Game', active_scene_id: id(5), dice: [20] },
    actors: [actor],
    tokens: [token],
    scenes: [],
    members: [],
    grants: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  const run = vi
    .fn<(...args: unknown[]) => Promise<Record<string, string> | undefined>>()
    .mockResolvedValue({ id: id(6), revision: '1' });
  const busy = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = async (access = true, disabled = false) =>
    act(async () =>
      root.render(
        createElement(TokenInitiative, {
          token,
          actor: access ? actor : undefined,
          snapshot,
          disabled,
          run,
          refresh: vi.fn(async () => {}),
          onBusyChange: busy,
        }),
      ),
    );
  await render();
  return { token, snapshot, actor, run, busy, render };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
}
async function total(value: string) {
  await act(async () => {
    const input = container.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('starts, adds, rerolls and manually updates only the selected token using authoritative encounter commands', async () => {
  const { token, snapshot, run, render } = await setup();
  await act(async () => button('Start encounter with token').click());
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({
      action: 'start',
      scene_id: token.scene_id,
      participants: [{ token_id: token.id, initiative: null }],
    }),
  );
  snapshot.encounter = {
    id: id(6),
    scene_id: token.scene_id,
    status: 'active',
    round: 2,
    revision: 4,
    active_token_id: id(7),
    participants: [{ token_id: id(7), label: 'Other', initiative: 18 }],
  };
  // Include the other participant on the board for projection intersection.
  snapshot.tokens.push({ ...token, id: id(7) });
  await render();
  await act(async () => button('Add token to encounter').click());
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({
      action: 'add',
      id: id(6),
      revision: 4,
      participants: [{ token_id: token.id, initiative: null }],
    }),
  );
  snapshot.encounter.participants.push({ token_id: token.id, label: token.label, initiative: 12 });
  await render();
  await act(async () => button('Reroll token initiative').click());
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({
      action: 'roll',
      token_ids: [token.id],
      revision: 4,
    }),
  );
  await total('21');
  await act(async () => button('Set token initiative').click());
  expect(run).toHaveBeenLastCalledWith(
    'encounter',
    expect.objectContaining({
      action: 'initiative',
      changes: [{ token_id: token.id, value: 21 }],
    }),
  );
});
it('requires a manual total without a saved/readable rule and respects blocking', async () => {
  const { render, run } = await setup();
  await render(false);
  expect(button('Start encounter with token').disabled).toBe(true);
  expect(container.textContent).toContain('No saved initiative rule');
  await total('15');
  await render(false, true);
  expect(button('Start encounter with token').disabled).toBe(true);
  await render(false);
  await act(async () => button('Start encounter with token').click());
  expect(run).toHaveBeenCalledWith(
    'encounter',
    expect.objectContaining({
      participants: [expect.objectContaining({ initiative: 15 })],
    }),
  );
});
it('persists uncertain initiative and retries the exact operation across remount without rerolling twice', async () => {
  const { run, render, busy } = await setup();
  run.mockResolvedValueOnce(undefined);
  await act(async () => button('Start encounter with token').click());
  const payload = run.mock.calls[0][1];
  expect(button('Start encounter with token').disabled).toBe(true);
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  await act(async () => button('Retry token initiative').click());
  expect(run.mock.calls[1][1]).toEqual(payload);
  expect(container.textContent).toContain('Encounter change confirmed');
  expect(busy).toHaveBeenLastCalledWith(false);
});
