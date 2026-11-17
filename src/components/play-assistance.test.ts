// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { applySrdBuilder } from '@/lib/srd-engine';
import { multiclassBuilder } from '@/lib/srd-test-fixtures';
import { createDndSheet } from '@/lib/dnd';
import type { Actor, Token } from '@/lib/types';
import { PlayAssistance } from './play-assistance';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

async function setup() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const actor: Actor = {
    id: crypto.randomUUID(),
    game_id: crypto.randomUUID(),
    owner_id: crypto.randomUUID(),
    revision: 1,
    name: 'Hero',
    kind: 'character',
    sheet: applySrdBuilder(createDndSheet(), multiclassBuilder()),
  };
  const token = { id: crypto.randomUUID(), label: 'Hero' } as Token;
  const run = vi.fn<(...args: unknown[]) => Promise<Record<string, string> | undefined>>();
  const render = async (key = 'panel') =>
    act(async () =>
      root.render(
        createElement(PlayAssistance, {
          key,
          actor,
          token,
          userId: actor.owner_id,
          disabled: false,
          active: true,
          run,
          onBusyChange: vi.fn(),
        }),
      ),
    );
  await render();
  return { actor, run, render };
}

function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
}

async function input(index: number, value: string, selector = 'select') {
  const control = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector)[index];
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')!.set!.call(
      control,
      value,
    );
    control.dispatchEvent(new Event(selector === 'select' ? 'change' : 'input', { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessionStorage.clear();
});

it('sends nothing before confirmation, rejects stale previews and blocks double submission', async () => {
  const { actor, run, render } = await setup();
  const spell = actor.sheet.character!.spells.find((s) => s.prepared && s.level === 1)!;
  await input(0, 'cast');
  await input(1, spell.id);
  const options = container.querySelectorAll('select')[2].options;
  const slot = [...options].find((option) => option.text.includes('spell slot'))!;
  await input(2, slot.value);
  await act(async () => button('Preview cast').click());
  expect(run).not.toHaveBeenCalled();
  actor.revision++;
  await render();
  expect(button('Confirm cast').disabled).toBe(true);
  await act(async () => button('Preview cast').click());
  run.mockResolvedValue({ revision: '3' });
  await act(async () => {
    button('Confirm cast').click();
    button('Confirm cast').click();
  });
  expect(run).toHaveBeenCalledExactlyOnceWith(
    'actor_resources',
    expect.objectContaining({
      id: actor.id,
      revision: 2,
      changes: [expect.objectContaining({ value: expect.any(Number) })],
    }),
  );
});

it('preserves the exact damage request on reopen and undoes its receipt after retry', async () => {
  const { run, render } = await setup();
  await input(0, 'damage');
  await input(0, '1', 'input');
  await act(async () => button('Preview damage').click());
  await act(async () => button('Confirm damage').click());
  const first = run.mock.calls[0];
  expect(first[0]).toBe('assist_damage');
  await render('reopened');
  run.mockResolvedValue({ revision: '2' });
  await act(async () => button('Retry same request').click());
  expect(run.mock.calls[1]).toEqual(first);
  await act(async () => button('Undo last assisted damage').click());
  expect(run.mock.calls[2]).toEqual([
    'assist_damage',
    expect.objectContaining({
      action: 'undo',
      operation_id: (first[1] as { operation_id: string }).operation_id,
    }),
  ]);
});
