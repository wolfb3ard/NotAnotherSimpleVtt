// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Room } from './room';
import type { Snapshot } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  status: (_status: string) => {
    void _status;
  },
  mutate: vi.fn(),
  roll: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/app/actions', () => ({ mutate: mocks.mutate, roll: mocks.roll, uploadAsset: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: () => ({
    rpc: (...args: unknown[]) => ({ abortSignal: () => mocks.rpc(...args) }),
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: (callback: typeof mocks.status) => {
          mocks.status = callback;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
const snapshot: Snapshot = {
  userId: 'player',
  role: 'player',
  game: { id: 'game', name: 'Game', gm_id: 'gm', active_scene_id: null, dice: [20] },
  actors: [],
  tokens: [],
  grants: [],
  scenes: [],
  templates: [],
  rolls: [],
  rollCues: [],
  diceStyles: [],
  members: [
    { user_id: 'player', role: 'player', display_name: 'Player' },
    { user_id: 'gm', role: 'gm', display_name: 'GM' },
  ],
};
async function mount() {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  mocks.rpc.mockResolvedValue({
    data: {
      now: new Date().toISOString(),
      signals: [],
      members: [{ user_id: 'player', live: false, tabs: 2 }],
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => snapshot })),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Room, { initial: snapshot })));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
it('successful snapshot polls do not claim the live channel is connected; memberships are not presence', async () => {
  await mount();
  await act(async () => mocks.status('CHANNEL_ERROR'));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  const status = container.querySelector('.connection')!;
  expect(status.textContent).toContain('Live channel reconnecting');
  expect(status.textContent).toContain('Snapshot synced');
  expect(container.querySelector('.room-presence')!.textContent).toContain(
    'Player · Online · reconnecting live channel · 2 tab(s)',
  );
  expect(container.querySelector('.room-presence')!.textContent).toContain('GM · Offline');
  await act(async () => mocks.status('SUBSCRIBED'));
  expect(status.textContent).toContain('Live channel connected');
});
it('separates snapshot failures from live health and reports offline without pretending writes succeeded', async () => {
  await mount();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Error('network');
    }),
  );
  await act(async () => mocks.status('SUBSCRIBED'));
  expect(container.querySelector('.connection')!.textContent).toContain('Live channel connected');
  expect(container.querySelector('.connection')!.textContent).toContain('Snapshot sync failed');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event('offline')));
  expect(container.querySelector('.connection')!.textContent).toContain('Offline');
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('unconfirmed');
  expect(container.querySelector('.room-presence')!.textContent).toContain('Unknown');
});
