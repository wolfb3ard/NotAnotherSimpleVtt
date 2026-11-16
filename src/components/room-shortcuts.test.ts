// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomShortcuts } from './room-shortcuts';
import { emptySheet } from '@/lib/sheets';
import type { Actor } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const hero: Actor = {
  id: 'hero',
  game_id: 'game',
  owner_id: 'owner',
  name: 'Aria',
  kind: 'character',
  sheet: emptySheet(),
  revision: 0,
};
async function render(actors: Actor[], gm = false, visibility: 'public' | 'private' = 'public') {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onOpen = vi.fn();
  const onParty = vi.fn();
  const onVisibilityChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(RoomShortcuts, {
        actors,
        userId: 'owner',
        gm,
        visibility,
        onOpen,
        onParty,
        onVisibilityChange,
      }),
    ),
  );
  return { onOpen, onParty, onVisibilityChange };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
});

it('opens the only owned character directly, excluding other owners and non-character sheets', async () => {
  const { onOpen } = await render([
    hero,
    { ...hero, id: 'other', owner_id: 'someone-else' },
    { ...hero, id: 'npc', kind: 'npc' },
  ]);
  const button = container.querySelector<HTMLButtonElement>('[aria-label="My character"]')!;
  expect(button.textContent).toContain('Aria');
  await act(async () => button.click());
  expect(onOpen).toHaveBeenCalledWith('hero');
});

it('offers an explicit choice for multiple owned characters and resets the chooser', async () => {
  const { onOpen } = await render([hero, { ...hero, id: 'second', name: 'Bryn' }]);
  const select = container.querySelector<HTMLSelectElement>('[aria-label="My character"]')!;
  expect([...select.options].map((option) => option.text)).toEqual([
    'Choose character…',
    'Aria',
    'Bryn',
  ]);
  await act(async () => {
    select.value = 'second';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onOpen).toHaveBeenCalledWith('second');
  expect(select.value).toBe('');
});

it('explains the empty state and offers the Party panel, including for GMs', async () => {
  const { onParty } = await render([{ ...hero, owner_id: 'someone-else' }], true);
  expect(container.textContent).toContain(
    'Create a character in Party or ask the GM to assign one.',
  );
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(onParty).toHaveBeenCalledOnce();
});

it.each([
  [false, 'public', 'Everyone at the table can see your rolls.'],
  [false, 'private', 'Only you and the GM can see your rolls.'],
  [true, 'private', 'Only you can see your rolls.'],
] as const)('explains the actual roll audience (GM: %s, %s)', async (gm, visibility, message) => {
  await render([hero], gm, visibility);
  expect(container.querySelector('[role="status"]')!.textContent).toBe(message);
  expect(
    container.querySelector<HTMLSelectElement>('[aria-label="Quick roll visibility"]')!.value,
  ).toBe(visibility);
});

it('requests the same visibility state used by the room roll controls', async () => {
  const { onVisibilityChange } = await render([hero]);
  const select = container.querySelector<HTMLSelectElement>(
    '[aria-label="Quick roll visibility"]',
  )!;
  await act(async () => {
    select.value = 'private';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onVisibilityChange).toHaveBeenCalledWith('private');
});
