// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/lib/types';
import type { AttentionSignal } from '@/lib/attention';
import type { RoomAttention } from './use-room-attention';
import { SharedAttention, AttentionMarkers } from './shared-attention';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
const scene = { id: 'scene', revision: 1, width: 600, height: 400 } as Snapshot['scenes'][number];
const snapshot = {
  role: 'player',
  userId: 'player',
  members: [{ user_id: 'gm', display_name: 'GM' }],
} as Snapshot;
const camera = {
  id: 'camera',
  kind: 'camera',
  user_id: 'gm',
  scene_id: 'scene',
  scene_revision: 1,
  x: 100,
  y: 100,
} as AttentionSignal;
const center = vi.fn(),
  send = vi.fn(),
  selectMode = vi.fn();
const verify = vi.fn(async () => camera);
const attention = {
  signals: [camera],
  online: true,
  message: '',
  sending: false,
  send,
  verify,
} as unknown as RoomAttention;
async function render(props: Partial<React.ComponentProps<typeof SharedAttention>> = {}) {
  if (!container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root.render(
      createElement(SharedAttention, {
        attention,
        snapshot,
        scene,
        preview: false,
        center,
        selectMode,
        ...props,
      }),
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text)!.click(),
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  container = undefined!;
  center.mockClear();
  send.mockClear();
  selectMode.mockClear();
  verify.mockReset().mockResolvedValue(camera);
});
it('never moves a camera without explicit Follow; decline persists across polling', async () => {
  await render();
  expect(center).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Follow or Decline');
  await click('Decline camera request');
  await render({ attention: { ...attention, signals: [{ ...camera }] } });
  expect(container.querySelector('[aria-label="GM camera request"]')).toBeNull();
  expect(center).not.toHaveBeenCalled();
});
it('revalidates on Follow and centers only a confirmed current-scene target', async () => {
  await render();
  await click('Follow camera request');
  expect(verify).toHaveBeenCalledWith(camera.id);
  expect(center).toHaveBeenCalledExactlyOnceWith(camera);
});
it('does not follow expired, concealed or offline requests', async () => {
  verify.mockResolvedValue(undefined!);
  await render();
  await click('Follow camera request');
  expect(center).not.toHaveBeenCalled();
  expect(container.textContent).toContain('could not be confirmed');
});
it('late Follow does not move after entering GM preview or changing scene', async () => {
  let resolve!: (value: AttentionSignal) => void;
  verify.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await click('Follow camera request');
  await render({ preview: true });
  await act(async () => resolve(camera));
  expect(center).not.toHaveBeenCalled();
});
it('Decline cancels an in-flight Follow and late confirmation does not override it', async () => {
  let resolve!: (value: AttentionSignal) => void;
  verify.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await click('Follow camera request');
  await click('Decline camera request');
  await act(async () => resolve(camera));
  expect(center).not.toHaveBeenCalled();
});
it('discards an in-flight Follow after scene transition', async () => {
  let resolve!: (value: AttentionSignal) => void;
  verify.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await click('Follow camera request');
  await render({ scene: { ...scene, id: 'other' } });
  await act(async () => resolve(camera));
  expect(center).not.toHaveBeenCalled();
});
it('follows using the latest viewport callback, preserving zoom changed during verification', async () => {
  let resolve!: (value: AttentionSignal) => void;
  verify.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await click('Follow camera request');
  const latestCenter = vi.fn();
  await render({ center: latestCenter });
  await act(async () => resolve(camera));
  expect(center).not.toHaveBeenCalled();
  expect(latestCenter).toHaveBeenCalledWith(camera);
});
it('exposes numeric/keyboard alternatives and GM-only explicit camera controls; preview blocks sharing', async () => {
  await render();
  expect(container.textContent).not.toContain('Bring everyone here');
  await click('Ping coordinates');
  expect(send).toHaveBeenCalledWith('ping', { x: 0, y: 0 }, scene);
  await render({ snapshot: { ...snapshot, role: 'gm' } });
  await click('Bring everyone here');
  expect(selectMode).toHaveBeenCalledWith('camera');
  await render({ snapshot: { ...snapshot, role: 'gm' }, preview: true });
  expect([...container.querySelectorAll('button')].filter((b) => !b.disabled)).toHaveLength(0);
});
it('renders static, non-color-only, zoom-independent markers with accessible sender/location labels', async () => {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(AttentionMarkers, {
        signals: [camera],
        snapshot,
        view: { x: 20, y: -30, scale: 2 },
      }),
    ),
  );
  const marker = container.querySelector<HTMLElement>('[role="img"]')!;
  expect(marker.getAttribute('aria-label')).toBe('GM camera target at map 100, 100');
  expect(marker.style.left).toBe('220px');
  expect(marker.style.top).toBe('170px');
  expect(marker.textContent).toContain('Look here');
  expect(marker.style.animation).toBe('');
});
