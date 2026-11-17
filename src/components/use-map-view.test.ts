// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMapView } from './use-map-view';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, controls: ReturnType<typeof useMapView>;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
});
const scene = { width: 600, height: 400 };
const dimensions = { width: 800, height: 600 };
function Harness({ scope = 'u:g:s', size = dimensions }) {
  const next = useMapView(scope, scene, size);
  useEffect(() => {
    controls = next;
  });
  return null;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Harness)));
}
it('remembers a user/game/scene view across remount and keeps other scopes separate', async () => {
  await mount();
  await act(async () => controls.update({ x: -100, y: 20, scale: 2 }));
  await act(async () => root.unmount());
  await mount();
  expect(controls.view).toEqual({ x: -100, y: 20, scale: 2 });
  for (const scope of ['other:g:s', 'u:other:s', 'u:g:other']) {
    await act(async () => root.render(createElement(Harness, { scope })));
    expect(controls.view).toEqual({ x: 50, y: 50, scale: 1 });
  }
  await act(async () => root.render(createElement(Harness)));
  expect(controls.view).toEqual({ x: -100, y: 20, scale: 2 });
});
it('clamps restored offscreen views and viewport resizing without writing during reconnect renders', async () => {
  localStorage.setItem('vtt-viewport:v1:u:g:s', JSON.stringify({ x: 9000, y: -9000, scale: 99 }));
  await mount();
  expect(controls.view).toEqual({ x: 736, y: -1936, scale: 5 });
  const write = vi.spyOn(localStorage, 'setItem');
  await act(async () => root.render(createElement(Harness, { size: { width: 300, height: 200 } })));
  expect(controls.view.x).toBe(236);
  expect(write).not.toHaveBeenCalled();
});
it('ignores corrupt storage and remains usable when storage is unavailable', async () => {
  localStorage.setItem('vtt-viewport:v1:u:g:s', '{invalid');
  await mount();
  expect(controls.view.scale).toBe(1);
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw Error('blocked');
  });
  await act(async () => controls.update({ x: 10, y: 20, scale: 2 }));
  expect(controls.view).toEqual({ x: 10, y: 20, scale: 2 });
});
