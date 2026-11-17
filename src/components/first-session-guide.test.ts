// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FirstSessionGuide } from './first-session-guide';
import type { Snapshot } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
const snapshot: Snapshot = {
  game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
  userId: 'player',
  role: 'player',
  members: [{ user_id: 'player', role: 'player', display_name: 'Player' }],
  actors: [],
  scenes: [],
  tokens: [],
  grants: [],
  templates: [],
  rolls: [],
  rollCues: [],
  diceStyles: [],
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});
it('dismisses/resumes across interrupted visits, isolates users/games/roles, and follows current state', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onGo = vi.fn();
  async function render(s = snapshot) {
    await act(async () => root.render(createElement(FirstSessionGuide, { snapshot: s, onGo })));
  }
  await render();
  expect(container.textContent).toContain('1/5 ready');
  expect(container.textContent).toContain('only the GM can assign');
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent?.startsWith('Create a character'))!
      .click(),
  );
  expect(onGo).toHaveBeenCalledWith('party');
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Dismiss guide')!
      .click(),
  );
  expect(container.textContent).toBe('Resume first-session guide');
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toBe('Resume first-session guide');
  await render({ ...snapshot, role: 'gm', userId: 'gm' });
  expect(container.textContent).toContain('Prepare your first session');
  await render({ ...snapshot, game: { ...snapshot.game, id: 'elsewhere' } });
  expect(container.textContent).toContain('Ready to play');
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(container.textContent).toContain('1/5 ready');
  await render({
    ...snapshot,
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
  });
  expect(container.textContent).toContain('2/5 ready');
});
