// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TokenAppearanceEditor } from './token-appearance-editor';
import { portraitCrop } from '@/lib/token-appearance';
import type { Actor, Snapshot } from '@/lib/types';

const { uploadAsset } = vi.hoisted(() => ({ uploadAsset: vi.fn() }));
vi.mock('@/app/actions', () => ({ uploadAsset }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
async function setup(role = 'owner', kind: Actor['kind'] = 'character') {
  const actor: Actor = {
    id: 'actor',
    game_id: 'game',
    owner_id: 'owner',
    name: 'Hero',
    kind,
    sheet: { version: 1, sections: [] },
    revision: 7,
    appearance_revision: 2,
    token_asset_id: 'portrait',
    token_ring: 'ruby',
  };
  const snapshot = {
    role: role === 'gm' ? 'gm' : 'player',
    userId: role,
    game: { active_scene_id: 'scene' },
    tokens: [],
    grants: [{ actor_id: 'actor', user_id: 'editor', can_edit: true }],
  } as unknown as Snapshot;
  const run = vi.fn(async () => ({}));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = async () => {
    await act(async () =>
      root.render(createElement(TokenAppearanceEditor, { actor, snapshot, run })),
    );
  };
  await render();
  return { actor, snapshot, run, render };
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  uploadAsset.mockReset();
});

it('previews preset rings and saves against the appearance revision, not sheet revision', async () => {
  const { run } = await setup();
  const ring = container.querySelector('select')!;
  expect(ring.options).toHaveLength(6);
  await act(async () => {
    ring.value = 'emerald';
    ring.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Save appearance').click());
  expect(run).toHaveBeenCalledWith('actor_appearance', {
    id: 'actor',
    asset_id: 'portrait',
    ring: 'emerald',
    revision: 2,
  });
  await act(async () => button('Add token to scene').click());
  expect(run).toHaveBeenCalledWith('token_create', { actor_id: 'actor', scene_id: 'scene' });
});

it('uploads portraits before persisting their actor association', async () => {
  const { run } = await setup();
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  uploadAsset.mockResolvedValue({ id: 'new-portrait' });
  const file = new File(['portrait'], 'hero.png', { type: 'image/png' });
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('img')?.src).toBe('blob:preview');
  await act(async () => button('Save appearance').click());
  expect(uploadAsset.mock.calls[0][0].get('file')).toBe(file);
  expect(run).toHaveBeenCalledWith('actor_appearance', {
    id: 'actor',
    asset_id: 'new-portrait',
    ring: 'ruby',
    revision: 2,
  });
  await act(async () => root.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:preview');
});

it.each(['viewer', 'editor'])(
  'does not expose appearance or placement mutations to %s',
  async (role) => {
    await setup(role);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/images/portrait');
  },
);

it.each(['npc', 'enemy'] as const)('allows GMs to configure and place %s sheets', async (kind) => {
  const { run } = await setup('gm', kind);
  await act(async () => button('Add token to scene').click());
  expect(run).toHaveBeenCalledWith('token_create', { actor_id: 'actor', scene_id: 'scene' });
});

it('disables placement without an active scene or when an owner already has a visible token', async () => {
  const { snapshot, render } = await setup();
  snapshot.game.active_scene_id = null;
  await render();
  expect(button('Add token to scene').disabled).toBe(true);
  snapshot.game.active_scene_id = 'scene';
  snapshot.tokens = [{ actor_id: 'actor', scene_id: 'scene' }] as Snapshot['tokens'];
  await render();
  expect(button('Already in scene').disabled).toBe(true);
});

it('shows upload errors without saving an invalid portrait', async () => {
  const { run } = await setup();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  uploadAsset.mockResolvedValue({ error: 'Choose an image up to 4 MB.' });
  const input = container.querySelector('input[type=file]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'large.png')] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Save appearance').click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain('4 MB');
  expect(run).not.toHaveBeenCalled();
});

it('center crops both landscape and portrait images without distortion', () => {
  expect(portraitCrop(200, 100)).toEqual({ x: 50, y: 0, width: 100, height: 100 });
  expect(portraitCrop(100, 200)).toEqual({ x: 0, y: 50, width: 100, height: 100 });
});
