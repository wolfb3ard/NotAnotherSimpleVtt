// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TokenQuickActions } from './token-quick-actions';
import { createDndSheet, dndId } from '@/lib/dnd';
import { previewResources } from '@/lib/resources';
import type { Actor, Snapshot, Token } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
async function setup(role = 'owner') {
  const actor: Actor = {
    id: 'actor',
    game_id: 'game',
    name: 'Hero',
    kind: 'character',
    owner_id: 'owner',
    sheet: createDndSheet(),
    revision: 0,
  };
  const token: Token = {
    id: 'token',
    game_id: 'game',
    scene_id: 'scene',
    actor_id: actor.id,
    controller_id: role,
    label: 'Hero',
    x: 100,
    y: 100,
    revision: 0,
    size: 50,
    hidden: false,
    asset_id: null,
  };
  const snapshot: Snapshot = {
    userId: role,
    role: role === 'gm' ? 'gm' : 'player',
    game: { id: 'game', gm_id: 'gm', name: 'Game', active_scene_id: 'scene', dice: [20] },
    actors: [actor],
    tokens: [token],
    scenes: [],
    members: [],
    grants: [],
    templates: [],
    rolls: [],
    rollCues: [],
    diceStyles: [],
  };
  const run = vi.fn<(...args: unknown[]) => Promise<Record<string, string> | undefined>>();
  const roll = vi.fn(async () => {});
  const advanced = vi.fn();
  const close = vi.fn(),
    sheet = vi.fn(),
    busy = vi.fn(),
    committed = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = async (access = true, blocked = false) =>
    act(async () =>
      root.render(
        createElement(TokenQuickActions, {
          token,
          actor: access ? actor : undefined,
          snapshot,
          anchor: { x: 2000, y: 2000 },
          blocked,
          busy: false,
          run,
          onClose: close,
          onSheet: sheet,
          onBusyChange: busy,
          onCommitted: committed,
          onRoll: roll,
          onAdvancedRoll: advanced,
          visibility: 'private',
        }),
      ),
    );
  await render();
  return { actor, snapshot, token, run, close, sheet, busy, committed, render, roll, advanced };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
}
async function select(label: string, next: string) {
  await act(async () => {
    const input = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    input.value = next;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it.each(['owner', 'gm', 'controller'])(
  'lets %s roll a saved attack immediately with the current audience and d20 mode',
  async (role) => {
    const { actor, roll, advanced } = await setup(role);
    expect(container.textContent).toContain(
      role === 'gm' ? 'Private · only you' : 'Private · you and GM',
    );
    await select('Token d20 roll mode', 'advantage');
    await act(async () => button('Roll selected action').click());
    expect(roll).toHaveBeenCalledWith({
      actorId: actor.id,
      expression: `2d20kh1 + @{${dndId('weapon-total:0')}}`,
      rollType: 'Attack roll with Longsword',
    });
    await act(async () => button('Advanced roll in Dice').click());
    expect(advanced).toHaveBeenCalledWith(expect.objectContaining({ actorId: actor.id }));
    expect(roll).toHaveBeenCalledTimes(1);
  },
);
it('keeps view/edit grants separate from rolling permission and blocks dirty drafts', async () => {
  const { actor, snapshot, token, render, roll } = await setup('viewer');
  token.controller_id = 'owner';
  snapshot.grants.push({ actor_id: actor.id, user_id: 'viewer', can_edit: true });
  await render();
  expect(button('Roll selected action').disabled).toBe(true);
  await act(async () => button('Roll selected action').click());
  expect(roll).not.toHaveBeenCalled();
  snapshot.userId = actor.owner_id;
  await render(true, true);
  expect(button('Roll selected action').disabled).toBe(true);
});
it('offers GM token controls without sheet access and sends revision-checked updates', async () => {
  const { token, snapshot, render, run } = await setup('gm');
  snapshot.members.push(
    { user_id: 'gm', role: 'gm', display_name: 'GM' },
    { user_id: 'player', role: 'player', display_name: 'Player' },
  );
  await render(false);
  run.mockResolvedValue({ id: token.id });
  await act(async () => button('Hide token').click());
  expect(run).toHaveBeenCalledWith('token_update', {
    id: token.id,
    revision: token.revision,
    hidden: true,
  });
  await select('Assign token control', 'player');
  expect(run).toHaveBeenLastCalledWith('token_update', {
    id: token.id,
    revision: token.revision,
    controller_id: 'player',
  });
  expect(container.querySelector('[aria-label="Token attack or ability"]')).toBeNull();
  expect(container.querySelector('[aria-label="Quick Hit Points"]')).toBeNull();
});
it('does not expose GM token or encounter mutation controls to players', async () => {
  await setup('owner');
  expect(container.querySelector('[aria-label="Assign token control"]')).toBeNull();
  expect(container.querySelector('[aria-label="Token manual initiative"]')).toBeNull();
  expect(container.textContent).toContain('Initiative: ask the GM');
});
it('keeps duplicate retry enabled while its uncertain state blocks other quick actions', async () => {
  const { actor, render, run, busy } = await setup('gm');
  actor.kind = 'enemy';
  await render();
  run.mockResolvedValueOnce(undefined);
  await act(async () => button('Duplicate as independent creature').click());
  expect(button('Retry creature creation').disabled).toBe(false);
  expect(button('Roll selected action').disabled).toBe(true);
  expect(button('Hide token').disabled).toBe(true);
  expect(busy).toHaveBeenLastCalledWith(true);
  const request = run.mock.calls[0][1];
  run.mockResolvedValueOnce({ id: 'copy', count: '1' });
  await act(async () => button('Retry creature creation').click());
  expect(run.mock.calls[1][1]).toEqual(request);
  expect(button('Roll selected action').disabled).toBe(false);
  expect(busy).toHaveBeenLastCalledWith(false);
});
it('explains missing attacks without inventing sheet values', async () => {
  const { actor, render, roll } = await setup();
  actor.sheet = { version: 1, sections: [] };
  await render();
  expect(container.textContent).toContain('No saved attack or roll');
  expect(container.querySelector('[aria-label="Token attack or ability"]')).toBeNull();
  expect(roll).not.toHaveBeenCalled();
});
async function value(label: string, next: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}
it('opens a small non-modal card with HP first, collapsed secondary counters, sheet shortcut and Escape', async () => {
  const { close, sheet } = await setup();
  const frame = container.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(frame.getAttribute('aria-modal')).toBe('false');
  expect(document.activeElement).toBe(frame);
  expect(container.querySelector('[aria-label="Quick Hit Points"]')!.closest('details')).toBeNull();
  expect(
    [...container.querySelectorAll('details')].find((d) =>
      d.textContent?.includes('More resources'),
    )!.open,
  ).toBe(false);
  expect(container.textContent).not.toContain('Play resources');
  expect(parseFloat(frame.style.left)).toBeLessThan(window.innerWidth);
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Open character sheet')!
      .click(),
  );
  expect(sheet).toHaveBeenCalledOnce();
  await act(async () =>
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(close).toHaveBeenCalledOnce();
});
it.each(['owner', 'gm', 'editor'])(
  'allows %s to save resources immediately with existing authorization',
  async (role) => {
    const { actor, snapshot, run, render, committed } = await setup(role);
    if (role === 'editor') {
      snapshot.grants.push({ actor_id: actor.id, user_id: role, can_edit: true });
      await render();
    }
    run.mockResolvedValue({
      revision: '1',
      sheet: JSON.stringify(previewResources(actor.sheet, [{ id: dndId('hp'), value: 4 }])),
    });
    await value('Quick Hit Points', '4');
    expect(run).toHaveBeenCalledWith(
      'actor_resources',
      expect.objectContaining({
        id: actor.id,
        revision: 0,
        changes: [{ id: dndId('hp'), value: 4 }],
      }),
    );
    expect(committed).toHaveBeenCalledWith(expect.anything(), 1);
    expect(container.textContent).toContain('Resources: Saved');
  },
);
it('does not turn token control or view access into resource edit permission', async () => {
  const { snapshot, actor, render, run } = await setup('controller');
  snapshot.grants.push({ actor_id: actor.id, user_id: snapshot.userId, can_edit: false });
  await render();
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Quick Hit Points"]')!.disabled,
  ).toBe(true);
  expect(container.textContent).toContain('Token control does not grant sheet editing');
  expect(run).not.toHaveBeenCalled();
});
it('removes all sheet values when access is revoked, leaving only a safe empty explanation', async () => {
  const { render } = await setup();
  await render(false);
  expect(container.textContent).toContain('No sheet access');
  expect(container.querySelector('input')).toBeNull();
  expect(container.querySelector('[aria-label="Quick resources"]')).toBeNull();
});
it('blocks dirty sheet drafts and preserves failure/retry feedback inside the card', async () => {
  const { actor, run, render } = await setup();
  await render(true, true);
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Quick Hit Points"]')!.disabled,
  ).toBe(true);
  expect(container.textContent).toContain('Save or reload sheet edits');
  await render();
  run.mockResolvedValueOnce(undefined);
  await value('Quick Hit Points', '4');
  expect(container.textContent).toContain('Resources: Failed');
  const payload = run.mock.calls[0][1];
  run.mockResolvedValueOnce({ revision: '1', sheet: JSON.stringify(actor.sheet) });
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Retry resource update')!
      .click(),
  );
  expect(run.mock.calls[1][1]).toEqual(payload);
});
