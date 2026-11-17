// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '@/lib/types';
import Tabletop from './tabletop';
import type { RoomAttention } from './use-room-attention';

const canvas = vi.hoisted(() => ({
  stage: {} as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  token: {} as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  point: { x: 125, y: 100 },
  position: { x: 100, y: 100 },
}));
vi.mock('react-konva', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  type Props = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const node = (p: Props) => {
    if (p.onDragStart) canvas.token = p;
    return createElement('div', { 'data-text': p.text }, p.children);
  };
  const Stage = forwardRef(function Stage(p: Props, ref) {
    useImperativeHandle(ref, () => ({ getPointerPosition: () => canvas.point }));
    canvas.stage = p;
    return createElement('div', { 'data-stage': true, tabIndex: 0 }, p.children);
  });
  return {
    Stage,
    ...Object.fromEntries(
      ['Layer', 'Image', 'Circle', 'Text', 'Group', 'Line', 'Rect'].map((n) => [n, node]),
    ),
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
});
const sceneId = '00000000-0000-4000-8000-000000000002';
const snapshot: Snapshot = {
  userId: 'player',
  role: 'player',
  game: { id: 'game', gm_id: 'gm', name: 'Game', active_scene_id: sceneId, dice: [20] },
  actors: [],
  members: [],
  grants: [],
  templates: [],
  rolls: [],
  rollCues: [],
  diceStyles: [],
  scenes: [
    {
      id: sceneId,
      game_id: 'game',
      name: 'Map',
      asset_id: 'map',
      width: 600,
      height: 400,
      units_per_pixel: 0.1,
      calibrated: true,
      unit: 'ft',
      revision: 3,
      grid: { enabled: true, size: 50, origin_x: 10, origin_y: 20 },
      fog: [{ x: 0, y: 0, width: 600, height: 400, reveal: true }],
    },
  ],
  tokens: [
    {
      id: 'token',
      game_id: 'game',
      scene_id: sceneId,
      actor_id: 'actor',
      controller_id: 'player',
      label: 'Hero',
      x: 100,
      y: 100,
      size: 48,
      hidden: false,
      revision: 7,
      asset_id: null,
    },
  ],
};
const commit = vi.fn(async () => true);
const run = vi.fn(async () => ({ confirmed: 'true' }));
async function render(s = snapshot, attention?: RoomAttention) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  if (!container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root.render(
      createElement(Tabletop, {
        snapshot: s,
        attention,
        run,
        openQuickActions: vi.fn(),
        edits: {
          blocked: false,
          busy: false,
          entry: undefined,
          message: '',
          uncertain: false,
          commit,
          undo: vi.fn(async () => {}),
          retry: vi.fn(),
          dismiss: vi.fn(),
        },
      }),
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === text)!.click(),
  );
}
async function key(type: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent(type, {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}
function dragEvent() {
  return {
    cancelBubble: false,
    target: {
      position: (p?: { x: number; y: number }) => {
        if (p) canvas.position = p;
        return canvas.position;
      },
    },
  };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container = undefined!;
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  commit.mockClear();
  run.mockClear();
  vi.unstubAllGlobals();
});
it('keeps template pointer placement and numeric edits private until explicit Share; dimensions ignore zoom/grid', async () => {
  const userId = '00000000-0000-4000-8000-000000000003';
  await render({ ...snapshot, userId });
  expect(container.textContent).not.toContain('Only you · Private preview · circle');
  await click('Click template origin');
  canvas.point = { x: 125, y: 100 };
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template x"]')!.value).toBe(
    '75.00',
  );
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template y"]')!.value).toBe(
    '50.00',
  );
  expect(container.querySelector('svg path')!.getAttribute('d')).toContain('A 200 200');
  expect(run).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Only you · Private preview');
  await click('Share template with everyone');
  expect(run).toHaveBeenCalledWith('tactical_template', {
    owner_id: userId,
    revision: 0,
    scene_id: sceneId,
    scene_revision: 3,
    operation_id: expect.any(String),
    area: { kind: 'circle', x: 75, y: 50, size: 20, width: 5, rotation: 0 },
  });
  expect(container.textContent).toContain('Template change confirmed.');
  expect(container.querySelector('svg path')).toBeNull();
});
it('supports keyboard-only private preview/dismissal and does not silently share or recover private drafts after map edits', async () => {
  await render();
  await click('Preview privately');
  expect(container.querySelector('svg path')).not.toBeNull();
  await render({ ...snapshot, scenes: [{ ...snapshot.scenes[0], revision: 4 }] });
  expect(container.querySelector('svg path')).toBeNull();
  await click('Preview privately');
  expect(container.querySelector('svg path')).not.toBeNull();
  await click('Dismiss private preview');
  expect(container.querySelector('svg path')).toBeNull();
  expect(run).not.toHaveBeenCalled();
});
it('filters shared templates by scene/fog/revision and exposes edit/dismiss only to owner or GM', async () => {
  const area = { kind: 'line' as const, x: 100, y: 100, size: 30, width: 5, rotation: 90 };
  const shared = { owner_id: 'other', scene_id: sceneId, scene_revision: 3, revision: 2, area };
  const s = {
    ...snapshot,
    members: [{ user_id: 'other', role: 'player' as const, display_name: 'Wizard' }],
    tacticalTemplates: [shared],
  };
  await render(s);
  expect(container.textContent).toContain('Wizard · Shared');
  expect(container.textContent).not.toContain('Move/edit Wizard template');
  await render({ ...s, role: 'gm' });
  await click('Move/edit Wizard template');
  expect(container.textContent).toContain('Editing Wizard’s area (private draft)');
  expect(run).not.toHaveBeenCalled();
  await click('Dismiss private preview');
  await render({ ...s, scenes: [{ ...snapshot.scenes[0], fog: [] }] });
  expect(container.querySelector('svg path')).toBeNull();
  await render({ ...s, tacticalTemplates: [{ ...shared, scene_revision: 2 }] });
  expect(container.querySelector('svg path')).toBeNull();
  await render({ ...s, tacticalTemplates: [{ ...shared, scene_id: 'inactive' }] });
  expect(container.querySelector('svg path')).toBeNull();
});
it('does not rebase an old private draft over a newer shared revision', async () => {
  const userId = '00000000-0000-4000-8000-000000000003';
  const slot = {
    owner_id: userId,
    scene_id: sceneId,
    scene_revision: 3,
    revision: 1,
    area: { kind: 'circle' as const, x: 100, y: 100, size: 15, width: 5, rotation: 0 },
  };
  await render({ ...snapshot, userId, tacticalTemplates: [slot] });
  await click('Preview privately');
  await render({ ...snapshot, userId, tacticalTemplates: [{ ...slot, revision: 2 }] });
  await click('Share template with everyone');
  expect(run).toHaveBeenCalledWith('tactical_template', expect.objectContaining({ revision: 1 }));
});
it('keeps geometry in scene units across zoom and grid changes; unit labels follow scene calibration', async () => {
  const s = { ...snapshot, scenes: [{ ...snapshot.scenes[0], units_per_pixel: 0.5, unit: 'm' }] };
  await render(s);
  await click('Preview privately');
  const path = container.querySelector('svg path')!.getAttribute('d');
  expect(path).toContain('A 40 40');
  expect(container.querySelector('svg')!.textContent).toContain('20 m radius');
  await act(async () => canvas.stage.onWheel({ evt: { preventDefault() {}, deltaY: -1 } }));
  expect(container.querySelector('svg path')!.getAttribute('d')).toBe(path);
  await render({
    ...s,
    scenes: [{ ...s.scenes[0], grid: { enabled: false, size: 100, origin_x: 30, origin_y: 40 } }],
  });
  expect(container.querySelector('svg path')!.getAttribute('d')).toBe(path);
});
it('blocks template creation on uncalibrated scenes and all template actions in GM preview', async () => {
  await render({ ...snapshot, scenes: [{ ...snapshot.scenes[0], calibrated: false }] });
  await click('Preview privately');
  expect(container.querySelector('svg path')).toBeNull();
  await render({ ...snapshot, role: 'gm' });
  await click('Preview privately');
  await click('Player view');
  expect(container.querySelector('svg')).toBeNull();
  await click('Share template with everyone');
  expect(run).not.toHaveBeenCalled();
});
it('shares a transformed explicit point without moving a token or the camera; Space-pan never sends a ping', async () => {
  const send = vi.fn();
  const attention = {
    signals: [],
    online: true,
    sending: false,
    message: '',
    send,
  } as unknown as RoomAttention;
  await render(snapshot, attention);
  await click('Ping map');
  expect(canvas.stage.draggable).toBe(false);
  expect(canvas.token.draggable).toBe(false);
  canvas.point = { x: 125, y: 100 };
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  expect(send).toHaveBeenCalledWith('ping', { x: 75, y: 50 }, snapshot.scenes[0]);
  expect(commit).not.toHaveBeenCalled();
  expect(canvas.stage.x).toBe(50);
  expect(canvas.stage.y).toBe(50);
  send.mockClear();
  await act(async () => canvas.stage.onMouseUp());
  await click('Ping map');
  await key('keydown');
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  expect(send).not.toHaveBeenCalled();
});
it('shows scaled Euclidean drag distance, snaps the submitted endpoint, preserves revision and never commits during drag', async () => {
  await render();
  const snap = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => snap.click());
  canvas.position = { x: 100, y: 100 };
  const start = dragEvent();
  await act(async () => canvas.token.onDragStart(start));
  expect(start.cancelBubble).toBe(true);
  canvas.position = { x: 129, y: 141 };
  const move = dragEvent();
  await act(async () => canvas.token.onDragMove(move));
  expect(canvas.position).toEqual({ x: 135, y: 145 });
  expect(container.querySelector('[data-text="5.70 ft · Euclidean"]')).not.toBeNull();
  expect(commit).not.toHaveBeenCalled();
  await act(async () => canvas.token.onDragEnd(dragEvent()));
  expect(commit).toHaveBeenCalledExactlyOnceWith('tabletop_move', {
    id: 'token',
    revision: 7,
    x: 135,
    y: 145,
  });
  expect(container.querySelector('[data-text="5.70 ft · Euclidean"]')).toBeNull();
});
it('Space pans over tokens in ruler mode, skips typing/buttons and releases on blur', async () => {
  await render();
  await click('↔ Ruler');
  expect(canvas.stage.draggable).toBe(false);
  expect((await key('keydown')).defaultPrevented).toBe(true);
  expect(canvas.stage.draggable).toBe(true);
  expect(canvas.token.draggable).toBe(false);
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  await act(async () => canvas.stage.onMouseUp());
  expect(commit).not.toHaveBeenCalled();
  await key('keyup');
  expect(canvas.stage.draggable).toBe(false);
  for (const element of [
    document.createElement('input'),
    document.createElement('textarea'),
    document.createElement('select'),
    document.createElement('button'),
  ]) {
    container.append(element);
    expect((await key('keydown', element)).defaultPrevented).toBe(false);
    expect(canvas.stage.draggable).toBe(false);
  }
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  container.append(editable);
  expect((await key('keydown', editable)).defaultPrevented).toBe(false);
  await key('keydown');
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(canvas.stage.draggable).toBe(false);
});
it('does not interrupt an active token drag or turn a drawing gesture into panning', async () => {
  await render();
  canvas.position = { x: 100, y: 100 };
  await act(async () => canvas.token.onDragStart(dragEvent()));
  expect((await key('keydown')).defaultPrevented).toBe(false);
  expect(canvas.token.draggable).toBe(true);
  await act(async () => canvas.token.onDragEnd(dragEvent()));
  await click('↔ Ruler');
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  expect((await key('keydown')).defaultPrevented).toBe(false);
  expect(canvas.stage.draggable).toBe(false);
});
it('zooms around pointer, remembers views across reconnect, and resets without moving a token', async () => {
  await render();
  canvas.point = { x: 150, y: 150 };
  await act(async () => canvas.stage.onWheel({ evt: { preventDefault() {}, deltaY: -1 } }));
  expect(canvas.stage.scaleX).toBeCloseTo(1.1);
  expect(canvas.stage.x).toBeCloseTo(40);
  await render({ ...snapshot });
  expect(canvas.stage.x).toBeCloseTo(40);
  await click('Fit map / Reset view');
  expect(canvas.stage.scaleX).toBe(1.2);
  expect(canvas.stage.x).toBe(40);
  expect(canvas.stage.y).toBe(60);
  expect(commit).not.toHaveBeenCalled();
  expect(localStorage.getItem(`vtt-viewport:v1:player:game:${sceneId}`)).toContain('"scale":1.2');
});
it('GM applies shared grid through a revision-checked idempotent command, players cannot configure it', async () => {
  await render();
  expect(container.textContent).not.toContain('Grid settings');
  await render({ ...snapshot, role: 'gm', userId: 'gm' });
  await click('Grid settings');
  await click('Apply grid');
  expect(run).toHaveBeenCalledWith('scene_grid', {
    scene_id: sceneId,
    revision: 3,
    operation_id: expect.any(String),
    grid: snapshot.scenes[0].grid,
  });
  expect(container.textContent).toContain('Grid change confirmed.');
  expect(container.querySelector('[aria-label="Grid calibration"]')).toBeNull();
});
it('keeps free movement and clamps drops at map bounds regardless of zoom', async () => {
  await render();
  await act(async () => canvas.stage.onWheel({ evt: { preventDefault() {}, deltaY: -1 } }));
  canvas.position = { x: 100, y: 100 };
  await act(async () => canvas.token.onDragStart(dragEvent()));
  canvas.position = { x: 900, y: -100 };
  await act(async () => canvas.token.onDragMove(dragEvent()));
  expect(canvas.position).toEqual({ x: 599.99, y: 0 });
  await act(async () => canvas.token.onDragEnd(dragEvent()));
  expect(commit).toHaveBeenCalledWith('tabletop_move', {
    id: 'token',
    revision: 7,
    x: 599.99,
    y: 0,
  });
  const pan = canvas.stage.dragBoundFunc({ x: 99999, y: -99999 });
  expect(pan.x).toBe(736);
  expect(pan.y).toBeCloseTo(-376);
});
it('finishes Space-pan before restoring a drawing tool and never reuses a ruler line as fog', async () => {
  await render({ ...snapshot, role: 'gm', userId: 'gm' });
  await click('↔ Ruler');
  canvas.point = { x: 100, y: 100 };
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  canvas.point = { x: 200, y: 200 };
  await act(async () => canvas.stage.onMouseMove());
  await act(async () => canvas.stage.onMouseUp());
  await click('◉ Reveal');
  await key('keydown');
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  await key('keyup');
  expect(canvas.stage.draggable).toBe(true);
  await act(async () => canvas.stage.onMouseUp());
  expect(canvas.stage.draggable).toBe(false);
  expect(commit).not.toHaveBeenCalled();
});
it('preserves a stale grid draft until explicitly closed; preview blocks configuration', async () => {
  const gm = { ...snapshot, role: 'gm' as const, userId: 'gm' };
  await render(gm);
  await click('Grid settings');
  await render({ ...gm, scenes: [{ ...gm.scenes[0], revision: 4 }] });
  expect(container.textContent).toContain('Map changed. Reopen grid settings');
  expect(
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Apply grid')!.disabled,
  ).toBe(true);
  await click('Close grid settings');
  await click('Player view');
  expect(
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Grid settings')!
      .disabled,
  ).toBe(true);
  expect(run).not.toHaveBeenCalled();
});
it('restores separate scene cameras and clears unfinished gestures when changing scenes', async () => {
  await render();
  await act(async () => canvas.stage.onWheel({ evt: { preventDefault() {}, deltaY: -1 } }));
  const oldScale = canvas.stage.scaleX;
  await click('↔ Ruler');
  await act(async () => canvas.stage.onMouseDown({ evt: { button: 0 } }));
  const other = {
    ...snapshot,
    game: { ...snapshot.game, active_scene_id: 'other' },
    scenes: [...snapshot.scenes, { ...snapshot.scenes[0], id: 'other' }],
  };
  await render(other);
  expect(canvas.stage.scaleX).toBe(1);
  expect(canvas.stage.draggable).toBe(true);
  await act(async () => canvas.stage.onMouseUp());
  await render(snapshot);
  expect(canvas.stage.scaleX).toBe(oldScale);
  expect(commit).not.toHaveBeenCalled();
});
