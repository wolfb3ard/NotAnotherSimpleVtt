// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Room } from './room';
import { createDndSheet } from '@/lib/dnd';
import type { Snapshot } from '@/lib/types';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/app/actions', () => ({ mutate, roll: vi.fn(), uploadAsset: vi.fn() }));
vi.mock('next/dynamic', () => ({
  default:
    () => (props: { openQuickActions?: (id: string, anchor: { x: number; y: number }) => void }) =>
      props.openQuickActions
        ? createElement(
            'div',
            null,
            ...['one', 'two'].map((id) =>
              createElement(
                'button',
                { key: id, onClick: () => props.openQuickActions!(id, { x: 100, y: 100 }) },
                `Right-click ${id}`,
              ),
            ),
          )
        : null,
}));
vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: () => ({
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
async function setup() {
  const snapshot: Snapshot = {
    userId: 'owner',
    role: 'player',
    game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: 'scene', dice: [20] },
    actors: ['one', 'two'].map((id) => ({
      id,
      game_id: 'game',
      owner_id: 'owner',
      name: id,
      kind: 'character',
      revision: 0,
      sheet: createDndSheet(),
    })),
    tokens: ['one', 'two'].map((id) => ({
      id,
      game_id: 'game',
      actor_id: id,
      scene_id: 'scene',
      label: id,
      controller_id: 'owner',
      x: 100,
      y: 100,
      size: 50,
      hidden: false,
      asset_id: null,
      revision: 0,
    })),
    scenes: [],
    grants: [],
    members: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  mutate.mockResolvedValue({ error: 'Unconfirmed' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
  await click('Right-click one');
  return { snapshot };
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === text || b.getAttribute('aria-label') === text)!
      .click(),
  );
}
async function value(label: string, next: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
it('blocks card writes while the same sheet has an unsaved configuration draft', async () => {
  await setup();
  await click('Open character sheet');
  await click('Edit character');
  await value('Name', 'Unsaved name');
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Quick Hit Points"]')!.disabled,
  ).toBe(true);
  expect(container.textContent).toContain('Save or reload sheet edits');
  expect(mutate).not.toHaveBeenCalled();
});
it('guards closing and switching unconfirmed cards and prevents same-sheet configuration edits', async () => {
  await setup();
  await value('Quick Hit Points', '4');
  expect(container.textContent).toContain('Resources: Failed');
  await click('Open character sheet');
  expect(container.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click('Close quick actions');
  expect(container.querySelector('.token-actions-header h2')!.getAttribute('aria-label')).toBe(
    'one quick actions',
  );
  await click('Right-click two');
  expect(container.querySelector('.token-actions-header h2')!.getAttribute('aria-label')).toBe(
    'one quick actions',
  );
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockReturnValue(true);
  await click('Right-click two');
  expect(container.querySelector('.token-actions-header h2')!.getAttribute('aria-label')).toBe(
    'two quick actions',
  );
  expect(container.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
});
it('removes the card if a reconciliation removes its token or changes the active scene', async () => {
  const { snapshot } = await setup();
  snapshot.tokens = [];
  // A normal failed write still reconciles the authorized room snapshot.
  await value('Quick Hit Points', '4');
  expect(container.querySelector('.token-actions-window')).toBeNull();
});
