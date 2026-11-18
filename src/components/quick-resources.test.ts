// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickResources } from './quick-resources';
import { SheetEditor } from './sheet-editor';
import { createDndSheet, dndId } from '@/lib/dnd';
import { previewResources } from '@/lib/resources';
import type { Actor, Snapshot } from '@/lib/types';
import { emptyCharacterDetails } from '@/lib/character-details';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const actor = (): Actor => ({
  id: 'actor',
  game_id: 'game',
  name: 'Hero',
  kind: 'character',
  owner_id: 'owner',
  revision: 0,
  sheet: createDndSheet(),
});
const snapshot = (a: Actor): Snapshot => ({
  userId: 'owner',
  role: 'player',
  actors: [a],
  grants: [],
  tokens: [],
  scenes: [],
  members: [],
  templates: [],
  rolls: [],
  rollCues: [],
  diceStyles: [],
  game: { id: 'game', gm_id: 'gm', name: 'Game', active_scene_id: null, dice: [20] },
});
async function setup(full = false, editable = true, blocked = false) {
  const a = actor();
  const run = vi.fn<(...args: unknown[]) => Promise<Record<string, string> | undefined>>();
  const committed = vi.fn();
  const busy = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ actors: [a] }) })),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = async () => {
    await act(async () =>
      root.render(
        full
          ? createElement(SheetEditor, { actor: a, snapshot: snapshot(a), run, onRoll: vi.fn() })
          : createElement(QuickResources, {
              actor: a,
              editable,
              blocked,
              run,
              onCommitted: committed,
              onBusyChange: busy,
            }),
      ),
    );
  };
  await render();
  return { a, run, committed, busy, render };
}
function input(label: string) {
  return container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
}
async function value(label: string, next: string) {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
}
async function spendSlot(a: Actor, render: () => Promise<void>) {
  a.revision++;
  a.sheet = structuredClone(a.sheet);
  const slot = a.sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('slot:0'))!;
  slot.max = 1;
  slot.value = 1;
  await render();
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((b) => b.textContent === 'Spell')!
      .click(),
  );
  await act(async () => button('Use level 1 slot').click());
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('shows Saving until confirmation, queues rapid changes, and reports Saved without Save sheet', async () => {
  const { a, run, committed, busy } = await setup();
  let resolve!: (data: Record<string, string>) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  run.mockImplementationOnce(async () => ({
    sheet: JSON.stringify(previewResources(a.sheet, [{ id: dndId('hp'), value: 4 }])),
    revision: '2',
  }));
  await value('Quick Hit Points', '8');
  await value('Quick Hit Points', '4');
  expect(input('Quick Hit Points').value).toBe('4');
  expect(run).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Resources: Saving');
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () =>
    resolve({
      sheet: JSON.stringify(previewResources(a.sheet, [{ id: dndId('hp'), value: 8 }])),
      revision: '1',
    }),
  );
  expect(run.mock.calls[1][1]).toMatchObject({ revision: 1 });
  expect(committed).toHaveBeenLastCalledWith(expect.anything(), 2);
  expect(container.textContent).toContain('Resources: Saved');
  expect(busy).toHaveBeenLastCalledWith(false);
});
it('rolls back failures, retains Retry, and does not interpret reconnect snapshots as confirmation', async () => {
  const { a, run, render } = await setup();
  run.mockResolvedValue(undefined);
  await value('Quick Hit Points', '5');
  expect(container.textContent).toContain('Resources: Failed');
  expect(input('Quick Hit Points').value).toBe('10');
  a.revision = 1;
  a.sheet = previewResources(a.sheet, [{ id: dndId('hp'), value: 5 }]);
  await render();
  expect(container.textContent).toContain('Resources: Failed');
  run.mockResolvedValue({ sheet: JSON.stringify(a.sheet), revision: '1' });
  await act(async () => button('Retry resource update').click());
  expect(run.mock.calls[1][1]).toEqual(run.mock.calls[0][1]);
  expect(container.textContent).toContain('Resources: Saved');
});
it.each([
  [false, false],
  [true, true],
])('blocks read-only and configuration-draft writes', async (editable, blocked) => {
  const { run } = await setup(false, editable, blocked);
  expect(input('Quick Hit Points').disabled).toBe(true);
  expect(button('Confirm Damage').disabled).toBe(true);
  expect(run).not.toHaveBeenCalled();
});
it('previews damage and healing, then submits an atomic health change', async () => {
  const { a, run } = await setup();
  run.mockImplementation(async (_command, payload) => {
    const changes = (payload as { changes: { id: string; value: number }[] }).changes;
    return { sheet: JSON.stringify(previewResources(a.sheet, changes)), revision: '1' };
  });
  await value('Health amount', '7');
  expect(container.textContent).toContain('HP 10 → 3');
  await act(async () => button('Confirm Damage').click());
  expect(run).toHaveBeenCalledWith(
    'actor_resources',
    expect.objectContaining({
      revision: 0,
      changes: [{ id: dndId('hp'), value: 3 }],
    }),
  );
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Health action"]')!;
  await act(async () => {
    select.value = 'heal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await value('Health amount', '100');
  expect(container.textContent).toContain('HP 3 → 10');
});
it('preserves configuration drafts during remote updates and requires an explicit sheet save', async () => {
  const { a, run, render } = await setup(true);
  await act(async () => button('Edit character').click());
  await value('Name', 'Draft hero');
  expect(input('Quick Hit Points')).toBeNull();
  expect(run).not.toHaveBeenCalled();
  a.revision = 1;
  a.sheet = previewResources(a.sheet, [{ id: dndId('hp'), value: 5 }]);
  await render();
  expect(input('Name').value).toBe('Draft hero');
  expect(container.textContent).toContain('Your unsaved edits will be replaced');
  expect(button('Save sheet').disabled).toBe(true);
});
it('reconciles a clean sheet after reconnect and keeps configuration disabled while resources are unconfirmed', async () => {
  const { a, run, render } = await setup(true);
  a.revision = 1;
  a.sheet = previewResources(a.sheet, [{ id: dndId('hp'), value: 6 }]);
  await render();
  expect(container.querySelector('output[aria-label="Hit Points"]')!.textContent).toBe('6');
  run.mockResolvedValue(undefined);
  await spendSlot(a, render);
  expect(container.querySelector('fieldset')!.disabled).toBe(true);
  expect(container.querySelector('.sheet-save-status')!.textContent).toContain('unconfirmed');
  await act(async () => button('Reload resources').click());
  expect(container.querySelector('fieldset')!.disabled).toBe(false);
  expect(container.querySelector('output[aria-label="Hit Points"]')!.textContent).toBe('6');
});

it('saves existing Actions feature-use and Spell slot buttons immediately', async () => {
  const { a, run, render } = await setup(true);
  a.revision = 1;
  a.sheet.character = emptyCharacterDetails();
  a.sheet.character.features.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Second Wind',
    description: '',
    actionType: 'Bonus action',
    source: 'Class',
    uses: 1,
    maxUses: 1,
  });
  const slot = a.sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('slot:0'))!;
  slot.max = 2;
  slot.value = 2;
  await render();
  run.mockImplementation(async (_command, payload) => {
    const request = payload as {
      changes: Parameters<typeof previewResources>[1];
      revision: number;
    };
    a.sheet = previewResources(a.sheet, request.changes);
    a.revision = request.revision + 1;
    return { sheet: JSON.stringify(a.sheet), revision: String(a.revision) };
  });
  await act(async () => button('Use Second Wind').click());
  expect(run).toHaveBeenLastCalledWith(
    'actor_resources',
    expect.objectContaining({
      changes: [{ id: a.sheet.character.features[0].id, value: 0, target: 'feature' }],
    }),
  );
  expect(button('Save sheet').disabled).toBe(true);
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent === 'Spell')!
      .click(),
  );
  await act(async () => button('Use level 1 slot').click());
  expect(run).toHaveBeenLastCalledWith(
    'actor_resources',
    expect.objectContaining({
      changes: [{ id: dndId('slot:0'), value: 1 }],
    }),
  );
  expect(button('Save sheet').disabled).toBe(true);
});

it('reconciles a newer remote snapshot received while a local update is awaiting confirmation', async () => {
  const { a, run, render } = await setup();
  let resolve!: (data: Record<string, string>) => void;
  run.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await value('Quick Hit Points', '8');
  const committedSheet = previewResources(a.sheet, [{ id: dndId('hp'), value: 8 }]);
  a.revision = 2;
  a.sheet = previewResources(a.sheet, [{ id: dndId('hp'), value: 3 }]);
  await render();
  await act(async () => resolve({ sheet: JSON.stringify(committedSheet), revision: '1' }));
  expect(input('Quick Hit Points').value).toBe('3');
  expect(container.textContent).toContain('Resources: Saved');
});

it('does not clear an unconfirmed write when the explicit resource reload is offline', async () => {
  const { run } = await setup();
  run.mockResolvedValue(undefined);
  await value('Quick Hit Points', '3');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await act(async () => button('Reload resources').click());
  expect(container.textContent).toContain('Resources: Failed');
  expect(container.textContent).toContain('Could not reload resources');
});

it('reloads the latest name along with its revision so later draft saves cannot undo a remote rename', async () => {
  const { a, run, render } = await setup(true);
  run.mockResolvedValue(undefined);
  await spendSlot(a, render);
  const latest = { ...a, revision: 2, name: 'Renamed remotely' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ actors: [latest] }) })),
  );
  await act(async () => button('Reload resources').click());
  await act(async () => button('Edit character').click());
  expect(input('Name').value).toBe('Renamed remotely');
});
