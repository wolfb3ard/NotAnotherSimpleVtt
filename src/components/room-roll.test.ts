// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Room } from './room';
import { createDndSheet, dndId } from '@/lib/dnd';
import type { Snapshot } from '@/lib/types';

const { roll } = vi.hoisted(() => ({ roll: vi.fn() }));
vi.mock('@/app/actions', () => ({ roll, mutate: vi.fn(), uploadAsset: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
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
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(['public', 'private'] as const)(
  'submits %s sheet rolls immediately, ignores manual modifiers, prevents concurrent requests and keeps the sheet open',
  async (visibility) => {
    const snapshot: Snapshot = {
      userId: 'owner',
      role: 'player',
      game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
      actors: [
        {
          id: 'actor',
          game_id: 'game',
          owner_id: 'owner',
          name: 'Hero',
          kind: 'character',
          sheet: createDndSheet(),
          revision: 0,
        },
      ],
      grants: [],
      tokens: [],
      members: [],
      scenes: [],
      templates: [],
      rolls: [],
      rollCues: [],
      diceStyles: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => snapshot })),
    );
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Room, { initial: snapshot })));
    const diceTab = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Dice',
    )!;
    await act(async () => diceTab.click());
    const modifier = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === 'Extra modifier')!
      .querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        modifier,
        '99',
      );
      modifier.dispatchEvent(new Event('input', { bubbles: true }));
      const select = [...container.querySelectorAll('select')].find((s) =>
        s.parentElement?.textContent?.includes('Visibility'),
      )!;
      select.value = visibility;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const partyTab = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Party',
    )!;
    await act(async () => partyTab.click());
    const card = container.querySelector<HTMLElement>('.actor-card')!;
    await act(async () =>
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    let finish!: (result: { error: string }) => void;
    roll.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const attack = container.querySelector<HTMLButtonElement>('[aria-label="Roll Attack roll"]')!;
    await act(async () => {
      attack.click();
      attack.click();
    });
    expect(roll).toHaveBeenCalledTimes(1);
    expect(roll).toHaveBeenCalledWith('game', {
      id: expect.any(String),
      actor_id: 'actor',
      expression: `1d20 + @{${dndId('weapon-total:0')}}`,
      visibility,
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish({ error: 'Roll rejected' }));
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain('Roll rejected');
  },
);
