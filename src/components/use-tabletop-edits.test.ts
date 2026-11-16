// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useTabletopEdits } from './use-tabletop-edits';
import type { Command } from '@/lib/commands';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let edits: ReturnType<typeof useTabletopEdits>;
const entry = { id: 'operation', description: 'Move token' };
const response = (entries = [entry]) => ({ history: JSON.stringify(entries) });
async function setup() {
  const run =
    vi.fn<(command: Command, payload: unknown) => Promise<Record<string, string> | undefined>>();
  run.mockResolvedValue(response([]));
  function Harness({ scene }: { scene: string }) {
    edits = useTabletopEdits(`user:game:${scene}`, scene, run);
    return createElement('div', null, edits.message);
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = async (scene = 'scene') => {
    await act(async () => root.render(createElement(Harness, { scene })));
  };
  await render();
  return { run, render };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  sessionStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('adds only confirmed commits and blocks rapid overlapping operations', async () => {
  const { run } = await setup();
  let resolve!: (value: Record<string, string>) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let sent!: Promise<boolean>;
  await act(async () => {
    sent = edits.commit('tabletop_move', { id: 'token', revision: 0, x: 20, y: 20 });
    expect(await edits.commit('tabletop_move', {})).toBe(false);
  });
  expect(edits.busy).toBe(true);
  expect(edits.entry).toBeUndefined();
  expect(container.textContent).toMatch(/Saving/);
  await act(async () => {
    resolve(response());
    await sent;
  });
  expect(edits.entry).toEqual(entry);
  expect(edits.blocked).toBe(false);
  expect(container.textContent).toMatch(/confirmed/);
});
it('retains an unconfirmed operation across reload and retries the identical request', async () => {
  const { run, render } = await setup();
  run.mockResolvedValueOnce(undefined);
  await act(async () => {
    await edits.commit('tabletop_fog', { id: 'scene', revision: 2, fog: [] });
  });
  const payload = run.mock.calls[1][1];
  expect(edits.uncertain).toBe(true);
  expect(edits.blocked).toBe(true);
  expect(edits.entry).toBeUndefined();
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(edits.uncertain).toBe(true);
  run.mockResolvedValueOnce(response());
  await act(async () => {
    await edits.retry();
  });
  expect(run).toHaveBeenLastCalledWith('tabletop_fog', payload);
  expect(edits.uncertain).toBe(false);
  expect(sessionStorage.length).toBe(0);
});
it('keeps late old-scene responses out of the new scene and restores per-scene history', async () => {
  const { run, render } = await setup();
  let resolve!: (value: Record<string, string>) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = edits.commit('tabletop_move', { id: 'token' });
  });
  await render('second');
  await act(async () => {
    resolve(response());
    await pending;
  });
  expect(edits.entry).toBeUndefined();
  run.mockResolvedValueOnce(response());
  await render('scene');
  expect(edits.entry).toEqual(entry);
});
it.each(['input', 'textarea', 'select', 'div[contenteditable]', 'div[role=textbox]'])(
  'leaves text undo alone in %s',
  async (tag) => {
    const { run, render } = await setup();
    run.mockResolvedValueOnce(response());
    await render('second');
    const element = document.createElement(tag.split('[')[0]);
    if (tag.includes('contenteditable')) element.setAttribute('contenteditable', 'true');
    if (tag.includes('textbox')) element.setAttribute('role', 'textbox');
    container.append(element);
    const count = run.mock.calls.length;
    await act(async () =>
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      ),
    );
    expect(run).toHaveBeenCalledTimes(count);
  },
);
it('supports Ctrl/Cmd+Z outside text controls and does not consume redo', async () => {
  const { run, render } = await setup();
  run.mockResolvedValueOnce(response());
  await render('second');
  const redo = new KeyboardEvent('keydown', {
    key: 'z',
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
  });
  window.dispatchEvent(redo);
  expect(redo.defaultPrevented).toBe(false);
  run.mockResolvedValueOnce(response([]));
  const undo = new KeyboardEvent('keydown', { key: 'z', metaKey: true, cancelable: true });
  await act(async () => window.dispatchEvent(undo));
  expect(undo.defaultPrevented).toBe(true);
  expect(run).toHaveBeenLastCalledWith('tabletop_undo', {
    scene_id: 'second',
    operation_id: entry.id,
  });
  expect(edits.entry).toBeUndefined();
});
it('requires explicit dismissal, reloads server history, and warns that dismissal is not reversal', async () => {
  const { run } = await setup();
  run.mockResolvedValueOnce(undefined);
  await act(async () => {
    await edits.commit('tabletop_move', {});
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await act(async () => edits.dismiss());
  expect(edits.uncertain).toBe(true);
  confirm.mockReturnValue(true);
  run.mockResolvedValueOnce(response());
  await act(async () => edits.dismiss());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('does not reverse'));
  expect(edits.uncertain).toBe(false);
  expect(edits.entry).toEqual(entry);
});

it('reconciles server history on reconnect without overwriting a pending operation', async () => {
  const { run } = await setup();
  run.mockResolvedValueOnce(response());
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(edits.entry).toEqual(entry);
  let resolve!: (value: Record<string, string>) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = edits.commit('tabletop_move', {});
  });
  const count = run.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(run).toHaveBeenCalledTimes(count);
  await act(async () => {
    resolve(response([]));
    await pending;
  });
  expect(edits.entry).toBeUndefined();
});
