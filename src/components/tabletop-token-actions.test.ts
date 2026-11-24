// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/lib/types';
import Tabletop from './tabletop';

vi.mock('react-konva', () => {
  const node = (props: {
    children?: React.ReactNode;
    onContextMenu?: (e: unknown) => void;
    onClick?: (e: unknown) => void;
    onDblClick?: (e: unknown) => void;
    onDragStart?: (e: unknown) => void;
    text?: string;
    stroke?: string;
  }) =>
    createElement(
      'div',
      {
        'data-token': props.onDragStart ? 'true' : undefined,
        'data-text': props.text,
        'data-stroke': props.stroke,
        onContextMenu: (e: React.MouseEvent) => {
          const event = { evt: e.nativeEvent, cancelBubble: false };
          props.onContextMenu?.(event);
          if (event.cancelBubble) e.stopPropagation();
        },
        onClick: (e: React.MouseEvent) => {
          const event = { evt: e.nativeEvent, cancelBubble: false };
          props.onClick?.(event);
          if (event.cancelBubble) e.stopPropagation();
        },
        onDoubleClick: (e: React.MouseEvent) => props.onDblClick?.({ evt: e.nativeEvent }),
      },
      props.children,
    );
  return Object.fromEntries(
    ['Stage', 'Layer', 'Image', 'Circle', 'Text', 'Group', 'Line', 'Rect'].map((name) => [
      name,
      name === 'Stage'
        ? (props: Parameters<typeof node>[0]) =>
            createElement('div', { 'data-stage': true }, node(props))
        : node,
    ]),
  );
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it('opens right-click actions without opening a sheet and provides a keyboard token chooser filtered by player preview', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const token = {
    id: 'token',
    game_id: 'game',
    scene_id: 'scene',
    actor_id: 'actor',
    controller_id: 'gm',
    label: 'Hero',
    x: 20,
    y: 20,
    size: 50,
    hidden: false,
    revision: 0,
    asset_id: null,
  };
  const snapshot: Snapshot = {
    userId: 'gm',
    role: 'gm',
    game: { id: 'game', gm_id: 'gm', name: 'Game', active_scene_id: 'scene', dice: [20] },
    tokens: [
      token,
      { ...token, id: 'secret', label: 'Secret enemy', hidden: true },
      { ...token, id: 'other-scene', scene_id: 'elsewhere', label: 'Off-scene' },
    ],
    scenes: [
      {
        id: 'scene',
        game_id: 'game',
        name: 'Map',
        asset_id: 'asset',
        width: 200,
        height: 200,
        unit: 'ft',
        units_per_pixel: 1,
        revision: 0,
        fog: [{ x: 0, y: 0, width: 200, height: 200, reveal: true }],
      },
    ],
    actors: [],
    members: [],
    grants: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
    encounter: {
      id: 'encounter',
      scene_id: 'scene',
      status: 'active',
      round: 1,
      revision: 1,
      active_token_id: 'secret',
      participants: [
        { token_id: 'token', label: 'Hero', initiative: 10 },
        { token_id: 'secret', label: 'Secret enemy', initiative: 15 },
      ],
    },
  };
  const open = vi.fn();
  const close = vi.fn();
  const sheet = vi.fn();
  const previewChange = vi.fn(() => true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(Tabletop, {
        snapshot,
        edits: {
          blocked: false,
          busy: false,
          entry: undefined,
          message: '',
          uncertain: false,
          commit: vi.fn(async () => true),
          undo: vi.fn(async () => {}),
          retry: vi.fn(),
          dismiss: vi.fn(async () => {}),
        },
        run: vi.fn(),
        openQuickActions: open,
        closeQuickActions: close,
        openTokenSheet: sheet,
        onPreviewChange: previewChange,
      }),
    ),
  );
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 240,
    clientY: 180,
  });
  await act(async () => container.querySelector('[data-token="true"]')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(open).toHaveBeenCalledWith('token', { x: 240, y: 180 });
  await act(async () =>
    container
      .querySelector('[data-token="true"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 })),
  );
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () =>
    container
      .querySelector('[data-token="true"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })),
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(sheet).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  const background = container.querySelector('[data-stage] > div')!;
  await act(async () =>
    background.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })),
  );
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () =>
    background.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 })),
  );
  expect(close).toHaveBeenCalledTimes(2);
  await act(async () =>
    container
      .querySelector('[data-token="true"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 })),
  );
  expect(sheet).toHaveBeenCalledWith('actor');
  expect(container.querySelector('[data-stroke="#79c9e8"]')).not.toBeNull();
  const chooser = container.querySelector<HTMLSelectElement>('[aria-label="Token quick actions"]')!;
  expect([...chooser.options].map((o) => o.textContent)).not.toContain('Off-scene');
  await act(async () => {
    chooser.value = 'token';
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(open).toHaveBeenLastCalledWith('token', { x: 24, y: 140 });
  expect(
    container.querySelector('[data-text="Secret enemy · hidden · current turn"]'),
  ).not.toBeNull();
  expect(container.querySelectorAll('[data-stroke="#fff4bf"]')).toHaveLength(1);
  previewChange.mockReturnValueOnce(false);
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Player view')!.click(),
  );
  expect(chooser.disabled).toBe(false);
  expect(
    container.querySelector('[data-text="Secret enemy · hidden · current turn"]'),
  ).not.toBeNull();
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Player view')!.click(),
  );
  expect(previewChange).toHaveBeenCalledWith(true);
  expect(chooser.disabled).toBe(true);
  expect([...chooser.options].map((o) => o.textContent)).not.toContain('Secret enemy');
  expect(container.querySelector('[data-text="Secret enemy · hidden · current turn"]')).toBeNull();
  expect(container.querySelectorAll('[data-stroke="#fff4bf"]')).toHaveLength(0);
  open.mockClear();
  await act(async () =>
    container
      .querySelector('[data-token="true"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })),
  );
  expect(open).not.toHaveBeenCalled();
  expect(container.querySelector('[data-stroke="#79c9e8"]')).toBeNull();
});
