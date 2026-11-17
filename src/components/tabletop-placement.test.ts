// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/lib/types';
import Tabletop from './tabletop';

vi.mock('react-konva', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  type Props = {
    children?: React.ReactNode;
    text?: string;
    x?: number;
    y?: number;
    onMouseDown?: (e: unknown) => void;
  };
  const node = (p: Props) => createElement('div', { 'data-text': p.text }, p.children);
  const Stage = forwardRef(function Stage(p: Props, ref) {
    useImperativeHandle(ref, () => ({ getPointerPosition: () => ({ x: 170, y: 130 }) }));
    return createElement(
      'div',
      {
        'data-stage': true,
        'data-x': p.x,
        'data-y': p.y,
        onMouseDown: () => p.onMouseDown?.({ evt: { button: 0 } }),
      },
      p.children,
    );
  });
  return {
    Stage,
    ...Object.fromEntries(
      ['Layer', 'Image', 'Circle', 'Text', 'Group', 'Line', 'Rect'].map((name) => [name, node]),
    ),
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
const actorId = '00000000-0000-4000-8000-000000000001';
const sceneId = '00000000-0000-4000-8000-000000000002';
const snapshot: Snapshot = {
  userId: 'player',
  role: 'player',
  game: { id: 'game', gm_id: 'gm', name: 'Game', active_scene_id: sceneId, dice: [20] },
  actors: [
    {
      id: actorId,
      game_id: 'game',
      name: 'Hero',
      kind: 'character',
      owner_id: 'player',
      revision: 0,
      sheet: { version: 1, sections: [] },
    },
  ],
  scenes: [
    {
      id: sceneId,
      game_id: 'game',
      name: 'Map',
      asset_id: 'map',
      width: 600,
      height: 400,
      units_per_pixel: 1,
      unit: 'units',
      revision: 3,
      fog: [{ x: 0, y: 0, width: 300, height: 300, reveal: true }],
    },
  ],
  tokens: [],
  members: [],
  grants: [],
  templates: [],
  rolls: [],
  rollCues: [],
  diceStyles: [],
};
async function render(s = snapshot) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const run = vi.fn(async () => ({ confirmed: 'true' }));
  await act(async () =>
    root.render(
      createElement(Tabletop, {
        snapshot: s,
        run,
        openQuickActions: vi.fn(),
        edits: {
          blocked: false,
          busy: false,
          entry: undefined,
          message: '',
          uncertain: false,
          commit: vi.fn(async () => true),
          undo: vi.fn(async () => {}),
          retry: vi.fn(),
          dismiss: vi.fn(),
        },
      }),
    ),
  );
  return run;
}
async function choose(label: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text)!.click(),
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
it('places a selected owned character at transformed map click coordinates, without opening sheets', async () => {
  const run = await render();
  await choose('Place character', actorId);
  await click('Click to place');
  await act(async () =>
    container
      .querySelector('[data-stage]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  expect(run).toHaveBeenCalledWith(
    'token_place',
    expect.objectContaining({
      actor_id: actorId,
      scene_id: sceneId,
      revision: 3,
      x: 120,
      y: 80,
      operation_id: expect.any(String),
    }),
  );
  expect(container.textContent).toContain('Placement confirmed.');
});
it('offers default spawn and numeric placement and reports invalid positions without sending', async () => {
  const run = await render();
  await choose('Place character', actorId);
  await click('Place at party spawn');
  expect(run.mock.calls[0]).toEqual([
    'token_place',
    expect.not.objectContaining({ x: expect.anything() }),
  ]);
  await click('Click to place');
  const input = container.querySelector<HTMLInputElement>('[aria-label="Placement X"]')!;
  const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    nativeSet.call(input, '700');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Confirm position');
  expect(run).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Choose a point inside the map.');
});
it('centers only an explicitly chosen visible token and blocks placement/finding/spawn in GM preview', async () => {
  const token = {
    id: 'token',
    game_id: 'game',
    scene_id: sceneId,
    actor_id: actorId,
    controller_id: 'gm',
    label: 'Hero',
    asset_id: null,
    x: 100,
    y: 100,
    size: 48,
    hidden: false,
    revision: 0,
  };
  const run = await render({
    ...snapshot,
    userId: 'gm',
    role: 'gm',
    tokens: [
      token,
      { ...token, id: 'hidden', hidden: true },
      { ...token, id: 'elsewhere', scene_id: 'other' },
      { ...token, id: 'fog', x: 500 },
    ],
    onboarding: { invited: true, spawn: { x: 490, y: 390 } },
  });
  await click('Find my character');
  expect(container.querySelector('[data-stage]')?.getAttribute('data-x')).toBe('300');
  expect(container.querySelector('[data-stage]')?.getAttribute('data-y')).toBe('200');
  expect(container.querySelector('[data-text="Party spawn"]')).not.toBeNull();
  await click('Set party spawn');
  await click('Confirm position');
  expect(run).toHaveBeenCalledWith('party_spawn', { scene_id: sceneId, revision: 3, x: 0, y: 0 });
  await click('Player view');
  expect(container.querySelector('[data-text="Party spawn"]')).toBeNull();
  for (const label of [
    'Find my character',
    'Click to place',
    'Place at party spawn',
    'Set party spawn',
  ]) {
    expect(
      [...container.querySelectorAll('button')].find((b) => b.textContent === label)?.disabled,
    ).toBe(true);
  }
});
