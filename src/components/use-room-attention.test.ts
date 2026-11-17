// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/lib/types';
import { useRoomAttention } from './use-room-attention';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: () => ({
    rpc: (...args: unknown[]) => ({ abortSignal: () => rpc(...args) }),
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, controls: ReturnType<typeof useRoomAttention>;
const scene = {
  id: 'scene',
  game_id: 'game',
  asset_id: 'map',
  name: 'Map',
  width: 600,
  height: 400,
  revision: 1,
  units_per_pixel: 1,
  unit: 'ft',
  fog: [{ x: 0, y: 0, width: 200, height: 200, reveal: true }],
};
const snapshot = {
  userId: 'player',
  role: 'player',
  game: { id: 'game', gm_id: 'gm', active_scene_id: 'scene' },
  scenes: [scene],
  members: [{ user_id: 'player' }, { user_id: 'gm' }],
} as Snapshot;
const signal = {
  id: 'ping',
  user_id: 'gm',
  kind: 'ping',
  scene_id: 'scene',
  scene_revision: 1,
  x: 100,
  y: 100,
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-01T00:00:08Z',
};
const pulse = {
  now: '2026-01-01T00:00:00Z',
  members: [{ user_id: 'player', live: true, tabs: 1 }],
  signals: [signal],
};
function Harness({ live = false, s = snapshot, enabled = true }) {
  const next = useRoomAttention(s, live, enabled);
  useEffect(() => {
    controls = next;
  });
  return null;
}
async function render(props = {}) {
  root ??= createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Harness, props)));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-01'));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  rpc.mockReset().mockResolvedValue({ data: pulse, error: null });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined!;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('reports actual channel state independently of successful polling and uses server-relative expiry', async () => {
  await render();
  expect(rpc).toHaveBeenCalledWith('room_pulse', expect.objectContaining({ p_live: false }));
  expect(controls.fresh).toBe(true);
  expect(controls.signals).toHaveLength(1);
  await render({ live: true });
  expect(rpc).toHaveBeenLastCalledWith('room_pulse', expect.objectContaining({ p_live: true }));
  rpc.mockResolvedValue({ data: { ...pulse, signals: [] } });
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(controls.signals).toEqual([]);
});
it('does not replay expired pings even if heartbeat hangs; stale presence becomes unknown', async () => {
  await render();
  rpc.mockImplementation(() => new Promise(() => {}));
  await act(async () => vi.advanceTimersByTimeAsync(8500));
  expect(controls.signals).toEqual([]);
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(controls.fresh).toBe(false);
  expect(controls.members).toEqual([]);
});
it('filters concealed/other-scene/revised targets immediately, before another network response', async () => {
  await render();
  await render({ s: { ...snapshot, scenes: [{ ...scene, fog: [] }] } });
  expect(controls.signals).toEqual([]);
  await render({ s: { ...snapshot, game: { ...snapshot.game, active_scene_id: 'other' } } });
  expect(controls.signals).toEqual([]);
  await render({ s: { ...snapshot, scenes: [{ ...scene, revision: 2 }] } });
  expect(controls.signals).toEqual([]);
});
it('offline clears presence and pings, blocks sending, then rejoins with the same tab lease', async () => {
  await render();
  const tab = rpc.mock.calls[0][1].p_tab;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event('offline')));
  expect(controls.online).toBe(false);
  expect(controls.fresh).toBe(false);
  rpc.mockClear();
  await act(async () => controls.send('ping', { x: 100, y: 100 }, scene));
  expect(rpc).not.toHaveBeenCalled();
  expect(controls.message).toContain('not sent');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(rpc).toHaveBeenCalledWith('room_pulse', expect.objectContaining({ p_tab: tab }));
  expect(controls.fresh).toBe(true);
});
it('uses a new tab lease on remount and ignores late responses after teardown', async () => {
  await render();
  const tab = rpc.mock.calls[0][1].p_tab;
  await act(async () => root.unmount());
  root = undefined!;
  await render();
  expect(rpc.mock.calls.at(-1)![1].p_tab).not.toBe(tab);
  let resolve!: (value: unknown) => void;
  rpc.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await act(async () => root.unmount());
  root = undefined!;
  await act(async () => resolve({ data: pulse }));
});
it('throttles sends, reports lost acknowledgements and discards late scene-specific messages', async () => {
  await render();
  rpc.mockRejectedValue(Error('network'));
  await act(async () => controls.send('ping', { x: 100, y: 100 }, scene));
  expect(controls.message).toContain('not confirmed');
  rpc.mockClear();
  await act(async () => controls.send('ping', { x: 100, y: 100 }, scene));
  expect(rpc).not.toHaveBeenCalled();
  expect(controls.message).toContain('Wait two seconds');
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  let resolve!: (value: unknown) => void;
  rpc.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = controls.send('camera', { x: 100, y: 100 }, scene);
  });
  await render({ s: { ...snapshot, game: { ...snapshot.game, active_scene_id: 'other' } } });
  await act(async () => {
    resolve({ error: null });
    await pending;
  });
  expect(controls.message).not.toContain('shared');
});
it('revalidates camera requests authoritatively and fails closed on errors or slow replies', async () => {
  await render();
  expect(await controls.verify('ping')).toMatchObject({ id: 'ping' });
  rpc.mockResolvedValue({ data: { ...pulse, signals: [] } });
  expect(await controls.verify('ping')).toBeUndefined();
  rpc.mockRejectedValue(Error('offline'));
  expect(await controls.verify('ping')).toBeUndefined();
});
it('marks polling failures unknown without claiming members are disconnected', async () => {
  await render();
  rpc.mockResolvedValue({ error: { message: 'Unavailable' } });
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(controls.fresh).toBe(false);
  expect(controls.members).toEqual([]);
  await render({ enabled: false });
  expect(controls.signals).toEqual([]);
});
it('times out hung requests and can rejoin instead of remaining stuck forever', async () => {
  await render();
  rpc.mockImplementation(() => new Promise(() => {}));
  await act(async () => vi.advanceTimersByTimeAsync(9000));
  expect(controls.fresh).toBe(false);
  rpc.mockResolvedValue({ data: pulse });
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(controls.fresh).toBe(true);
});
