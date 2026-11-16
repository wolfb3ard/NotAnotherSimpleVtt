// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetWindow } from './sheet-window';
import { ActorCard } from './actor-card';
import { createDndSheet, dndId } from '@/lib/dnd';
import type { Actor, Snapshot } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
function fixture(gm = false) {
  const actor: Actor = {
    id: 'actor',
    game_id: 'game',
    owner_id: 'owner',
    name: 'Aria',
    kind: 'character',
    sheet: createDndSheet(),
    revision: 0,
  };
  const snapshot: Snapshot = {
    userId: gm ? 'gm' : 'owner',
    role: gm ? 'gm' : 'player',
    game: {
      id: 'game',
      name: 'Game',
      gm_id: 'gm',
      active_scene_id: null,
      dice: [4, 6, 8, 10, 12, 20],
    },
    actors: [actor],
    grants: [],
    tokens: [],
    scenes: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
    members: [
      { user_id: 'gm', role: 'gm', display_name: 'GM' },
      { user_id: 'owner', role: 'player', display_name: 'Owner' },
      { user_id: 'viewer', role: 'player', display_name: 'Viewer' },
    ],
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const run = vi.fn(async () => ({}));
  const onRoll = vi.fn();
  const onClose = vi.fn();
  const render = async () => {
    await act(async () =>
      root.render(createElement(SheetWindow, { actor, snapshot, run, onRoll, onClose })),
    );
  };
  return { actor, snapshot, run, onRoll, onClose, render };
}
function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function select(label: string, value: string) {
  const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function typeName(value: string) {
  const element = container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('character sheet window', () => {
  it('keeps a compact card; opens only on double-click or keyboard activation', async () => {
    const { actor } = fixture();
    const open = vi.fn();
    await act(async () =>
      root.render(createElement(ActorCard, { actor, ownerName: 'Owner', onOpen: open })),
    );
    const card = button('Open Aria character sheet');
    await click(card);
    expect(open).not.toHaveBeenCalled();
    await act(async () => {
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(open).toHaveBeenCalledTimes(1);
    for (const key of ['Enter', ' '])
      await act(async () => {
        card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    expect(open).toHaveBeenCalledTimes(3);
    expect(container.querySelector('input')).toBeNull();
  });
  it('opens a named non-modal sheet, supports maximize/restore, keyboard movement, and Escape', async () => {
    const { render, onClose } = fixture();
    await render();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(dialog);
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Aria',
    );
    await act(async () => {
      container
        .querySelector('[aria-label="Move character sheet window"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(dialog.style.left).toBe('44px');
    await click(button('Maximize sheet window'));
    expect(dialog.classList.contains('is-maximized')).toBe(true);
    await click(button('Restore sheet window'));
    expect(dialog.classList.contains('is-maximized')).toBe(false);
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('confirms dirty close, blocks unsaved rolls, and retains edits when discard is cancelled', async () => {
    const { render, onClose } = fixture();
    await render();
    await typeName('Changed hero');
    expect(button('Roll Strength check').disabled).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(button('Close character sheet'));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved character sheet changes?');
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe(
      'Changed hero',
    );
    confirm.mockReturnValue(true);
    await click(button('Close character sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('rolls with advantage without closing the sheet', async () => {
    const { render, onRoll, onClose } = fixture();
    await render();
    await select('Sheet roll mode', 'advantage');
    await click(button('Roll Strength check'));
    expect(onRoll).toHaveBeenCalledWith(
      'actor',
      `2d20kh1 + @{${dndId('check:0')}}`,
      'Strength check',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
  it('allows the GM to set view-only access and transfer ownership with a revision', async () => {
    const { render, run } = fixture(true);
    await render();
    await select('Viewer sheet access', 'view');
    expect(run).toHaveBeenCalledWith('grant', {
      actor_id: 'actor',
      user_id: 'viewer',
      access: 'view',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await select('Sheet owner', 'viewer');
    expect(run).toHaveBeenCalledWith('actor_owner', {
      actor_id: 'actor',
      owner_id: 'viewer',
      revision: 0,
    });
  });
  it('makes a viewer read-only and omits GM access controls', async () => {
    const { render, snapshot, onRoll } = fixture();
    snapshot.userId = 'viewer';
    snapshot.grants = [{ actor_id: 'actor', user_id: 'viewer', can_edit: false }];
    await render();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Strength"]')!.disabled).toBe(
      true,
    );
    expect(button('Roll Strength check').disabled).toBe(true);
    await click(button('Roll Strength check'));
    expect(onRoll).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Sheet owner"]')).toBeNull();
  });
  it('confirms deletion and submits the saved revision only for the owner', async () => {
    const { render, run } = fixture();
    await render();
    const remove = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete character',
    )!;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(remove);
    expect(run).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click(remove);
    expect(run).toHaveBeenCalledExactlyOnceWith('actor_delete', { id: 'actor', revision: 0 });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'));
  });
  it('does not show deletion to a sheet editor or token controller', async () => {
    const { render, snapshot } = fixture();
    snapshot.userId = 'viewer';
    snapshot.grants = [{ actor_id: 'actor', user_id: 'viewer', can_edit: true }];
    await render();
    expect(container.textContent).toContain('Can edit');
    expect(container.textContent).not.toContain('Delete character');
  });
});
