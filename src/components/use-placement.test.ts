// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlacement } from './use-placement';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, controls: ReturnType<typeof usePlacement>;
const payload = {
  actor_id: '00000000-0000-4000-8000-000000000001',
  scene_id: '00000000-0000-4000-8000-000000000002',
  revision: 3,
  x: 120,
  y: 80,
};
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
it('retains exact uncertain requests across reload, prevents double submits and confirms only server acknowledgments', async () => {
  const run = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ confirmed: 'true' });
  function Harness() {
    controls = usePlacement('user:game:scene', run);
    return null;
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    await controls.commit(payload);
    await controls.commit(payload);
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(controls.uncertain).toBe(true);
  const request = run.mock.calls[0][1];
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  expect(controls.uncertain).toBe(true);
  await act(async () => {
    await controls.retry();
  });
  expect(run).toHaveBeenLastCalledWith('token_place', request);
  expect(controls.blocked).toBe(false);
  expect(controls.message).toBe('Placement confirmed.');
  expect(sessionStorage.length).toBe(0);
});
it('rejects invalid numeric coordinates before sending and makes uncertain dismissal explicit', async () => {
  const run = vi.fn(async () => undefined);
  function Harness() {
    controls = usePlacement('user:game:scene', run);
    return null;
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    await controls.commit({ ...payload, x: -1 });
  });
  expect(run).not.toHaveBeenCalled();
  await act(async () => {
    await controls.commit(payload);
  });
  expect(controls.uncertain).toBe(true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => controls.dismiss());
  expect(controls.uncertain).toBe(true);
  confirm.mockReturnValue(true);
  await act(async () => controls.dismiss());
  expect(controls.uncertain).toBe(false);
});
