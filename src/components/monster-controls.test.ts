// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import MonsterSheet from './monster-sheet';
import MonsterLibrary from './monster-library';
import { CreatureAdder } from './creature-adder';
import { createMonsterSheet } from '@/lib/srd-monsters';
import { dndId } from '@/lib/dnd';
import type { Snapshot } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scene = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let root: Root, container: HTMLDivElement;
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === text || b.getAttribute('aria-label') === text)!
      .click(),
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
it('retries an unconfirmed add with the same operation across remount/reload', async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const props = {
    gameId: game,
    sceneId: scene,
    source: { kind: 'srd' as const, monster_id: 'monster-aboleth' },
    run,
  };
  await mount(createElement(CreatureAdder, props));
  await click('Add creatures');
  const request = run.mock.calls[0][1];
  expect(container.textContent).toContain('Creation unconfirmed');
  expect(container.querySelector('input')!.disabled).toBe(true);
  await act(async () => root.unmount());
  await mount(createElement(CreatureAdder, props));
  expect(container.textContent).toContain('Previous creation is unconfirmed');
  run.mockResolvedValue({ id: 'created', count: '1' });
  await click('Retry creature creation');
  expect(run.mock.calls[1]).toEqual(['creature_add', request]);
  expect(container.textContent).toContain('added hidden');
  expect(sessionStorage.length).toBe(0);
});
it('prevents double clicks while adding and never restores an attempt into another scene', async () => {
  const run = vi.fn(() => new Promise<Record<string, string>>(() => {}));
  const props = {
    gameId: game,
    sceneId: scene,
    source: { kind: 'srd' as const, monster_id: 'monster-aboleth' },
    run,
  };
  await mount(createElement(CreatureAdder, props));
  await act(async () => {
    container.querySelector('button')!.click();
    container.querySelector('button')!.click();
  });
  expect(run).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  await mount(createElement(CreatureAdder, { ...props, sceneId: game }));
  expect(container.textContent).not.toContain('unconfirmed');
});
it('declares spells, rolls attacks/damage, and spends independent uses without a PC builder', async () => {
  const onRoll = vi.fn(),
    quickUpdate = vi.fn();
  await mount(
    createElement(MonsterSheet, {
      sheet: createMonsterSheet('monster-green-hag'),
      editable: true,
      rollable: true,
      blocked: false,
      quickEditable: true,
      quickUpdate,
      onRoll,
    }),
  );
  await click('Spell');
  const dc = [...container.querySelectorAll('.dnd-value')].find(
    (entry) => entry.querySelector('label')?.textContent === 'Ray of Sickness save DC',
  );
  expect(dc?.querySelector('output')?.textContent).toBe('12');
  expect(container.textContent).toContain('self only');
  await click('Roll Ray of Sickness · Spell attack');
  expect(onRoll).toHaveBeenLastCalledWith('1d20 + 4', 'Ray of Sickness · Spell attack');
  await click('Roll Ray of Sickness · Dice 1');
  expect(onRoll).toHaveBeenLastCalledWith('4d8', 'Ray of Sickness · Dice 1');
  await click('Declare cast Invisibility');
  expect(onRoll).toHaveBeenLastCalledWith('0', expect.stringContaining('Cast Invisibility'));
  await act(async () =>
    root.render(
      createElement(MonsterSheet, {
        sheet: createMonsterSheet('monster-incubus'),
        editable: true,
        rollable: true,
        blocked: false,
        quickEditable: true,
        quickUpdate,
        onRoll,
      }),
    ),
  );
  await click('Spend Dream use');
  expect(quickUpdate).toHaveBeenLastCalledWith([
    { id: dndId('monster:spell:spell-dream:uses'), value: 0 },
  ]);
});
it('blocks view-only rolls/resource edits and dirty or unconfirmed actions', async () => {
  await mount(
    createElement(MonsterSheet, {
      sheet: createMonsterSheet('monster-incubus'),
      editable: false,
      rollable: false,
      blocked: true,
      quickEditable: false,
      quickUpdate: vi.fn(),
      onRoll: vi.fn(),
    }),
  );
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('button:not([role=tab])')].every(
      (b) => b.disabled,
    ),
  ).toBe(true);
  expect([...container.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
  await click('Notes & Source');
  expect(container.textContent).toContain('Published Incubus');
});
it('shows the library only to GMs and explains missing scene placement', async () => {
  const snapshot = {
    role: 'player',
    actors: [],
    scenes: [],
    game: { id: game, active_scene_id: null },
  } as unknown as Snapshot;
  await mount(createElement(MonsterLibrary, { snapshot, run: vi.fn() }));
  expect(container.textContent).toBe('');
  await act(async () =>
    root.render(
      createElement(MonsterLibrary, { snapshot: { ...snapshot, role: 'gm' }, run: vi.fn() }),
    ),
  );
  expect(container.textContent).toContain('336 monsters found');
  expect(container.textContent).toContain('Create and activate a scene');
  expect(container.querySelector('button')).toBeNull();
  await act(async () => {
    const input = container.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'aboleth',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const monsterSelect = [...container.querySelectorAll('select')].at(-1)!;
  expect(monsterSelect.options.length).toBe(2);
  expect(
    [...monsterSelect.options].slice(1).every((option) => option.textContent?.includes('Aboleth')),
  ).toBe(true);
  await act(async () => {
    monsterSelect.value = 'monster-aboleth';
    monsterSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('details')?.textContent).toContain('Tentacle');
  await act(async () => {
    const input = container.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'wolf');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('details')).toBeNull();
});
