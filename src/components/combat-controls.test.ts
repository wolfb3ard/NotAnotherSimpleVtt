// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CombatControls } from './combat-controls';
import { emptyCombat } from '@/lib/combat';
import { createDndSheet } from '@/lib/dnd';
import type { Actor, Snapshot } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const game = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let root: Root, container: HTMLDivElement;
async function setup() {
  const actor: Actor = {
    id,
    game_id: game,
    owner_id: 'owner',
    name: 'Hero',
    kind: 'character',
    revision: 0,
    sheet: createDndSheet(),
    combat: emptyCombat(),
    combat_revision: 0,
  };
  const snapshot = {
    userId: 'owner',
    actors: [actor],
    tokens: [],
    game: { id: game, active_scene_id: null },
    role: 'player',
  } as unknown as Snapshot;
  const run = vi.fn<(...args: unknown[]) => Promise<Record<string, string> | undefined>>();
  const busy = vi.fn(),
    roll = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = async (editable = true, blocked = false) =>
    act(async () =>
      root.render(
        createElement(CombatControls, {
          actor,
          snapshot,
          editable,
          blocked,
          run,
          onBusyChange: busy,
          onRoll: roll,
        }),
      ),
    );
  await render();
  return { actor, snapshot, run, busy, roll, render };
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(label: string, text: string) {
  const input = [...container.querySelectorAll('label')]
    .find((l) => l.firstChild?.textContent === label)!
    .querySelector('input,textarea')!;
  await act(async () => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
it('adds and edits source/notes without implying automatic rules', async () => {
  const { actor, run, render } = await setup();
  run.mockResolvedValue({ id, revision: '1' });
  await value('Condition name', 'Poisoned');
  await value('Condition source', 'Trap');
  await value('Condition notes', 'Save DC 14 at end of turn');
  await click('Add condition');
  expect(run).toHaveBeenCalledWith(
    'actor_combat',
    expect.objectContaining({
      id,
      revision: 0,
      state: expect.objectContaining({
        conditions: [
          expect.objectContaining({
            name: 'Poisoned',
            source: 'Trap',
            notes: 'Save DC 14 at end of turn',
            expiry: null,
          }),
        ],
      }),
    }),
  );
  actor.combat = (run.mock.calls[0][1] as { state: typeof actor.combat }).state;
  actor.combat_revision = 1;
  await render();
  await click('Edit Poisoned');
  await value('Condition notes', 'Custom override');
  await click('Save condition changes');
  expect(
    (run.mock.calls[1][1] as { state: { conditions: { notes: string }[] } }).state.conditions[0]
      .notes,
  ).toBe('Custom override');
});
it('keeps failed attempts exact across reload and blocks new edits until retry confirmation', async () => {
  const { run, busy } = await setup();
  run.mockResolvedValueOnce(undefined);
  await click('Record failure');
  const request = run.mock.calls[0][1];
  expect(button('Record success').disabled).toBe(true);
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => root.unmount());
  root = createRoot(container);
  const actor: Actor = {
    id,
    game_id: game,
    owner_id: 'owner',
    name: 'Hero',
    kind: 'character',
    sheet: createDndSheet(),
    revision: 0,
  };
  await act(async () =>
    root.render(
      createElement(CombatControls, {
        actor,
        snapshot: {
          userId: 'owner',
          game: { id: game, active_scene_id: null },
          tokens: [],
          actors: [actor],
        } as unknown as Snapshot,
        editable: true,
        blocked: false,
        run,
        onBusyChange: busy,
      }),
    ),
  );
  run.mockResolvedValueOnce({ id, revision: '1' });
  await click('Retry combat change');
  expect(run.mock.calls[1][1]).toEqual(request);
  expect(container.textContent).toContain('Combat change saved');
  expect(busy).toHaveBeenLastCalledWith(false);
});
it('supports death-save rolls, explicit stabilization/recovery and read-only/draft guards', async () => {
  const { actor, run, roll, render } = await setup();
  const group = container.querySelector('[aria-label="Roll and record death save"]');
  expect([...group!.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    'Roll death save (d20)',
    'Record success',
    'Record failure',
  ]);
  const adjustments = [...container.querySelectorAll('summary')].find(
    (summary) => summary.textContent === 'Adjust or reset',
  )!.parentElement as HTMLDetailsElement;
  expect(adjustments.open).toBe(false);
  expect(adjustments).toBe(button('Stabilize — reset death saves').closest('details'));
  expect(adjustments.textContent).toContain('does not heal');
  await click('Roll death save (d20)');
  expect(roll).toHaveBeenCalledWith({
    actorId: id,
    expression: '1d20',
    rollType: expect.stringContaining('Death saving throw'),
  });
  run.mockResolvedValue({ id, revision: '1' });
  await click('Stabilize — reset death saves');
  expect((run.mock.calls[0][1] as { state: unknown }).state).toEqual({
    ...emptyCombat(),
    death: { successes: 0, failures: 0, stable: true },
  });
  actor.combat = { ...emptyCombat(), death: { successes: 0, failures: 3, stable: false } };
  actor.combat_revision = 1;
  await render();
  expect(container.textContent).toContain('Dead');
  await click('Recovered / revived — reset death saves');
  expect((run.mock.calls[1][1] as { state: unknown }).state).toEqual(emptyCombat());
  await render(false);
  expect(button('Record success').disabled).toBe(true);
  await render(true, true);
  expect(button('Start concentration').disabled).toBe(true);
});
it('shows durable expiry and concentration prompts and manual overrides', async () => {
  const { actor, run, render } = await setup();
  actor.combat!.conditions = [
    {
      id: crypto.randomUUID(),
      name: 'Stunned',
      source: 'Spell',
      notes: 'Private',
      due: true,
      expiry: null,
    },
  ];
  actor.combat!.concentration = {
    source: 'Bless',
    notes: '',
    checks: [{ id: crypto.randomUUID(), damage: 24, dc: 12 }],
  };
  await render();
  expect(container.textContent).toContain('Expiry review: remove Stunned');
  expect(container.textContent).toContain('DC 12 after 24');
  run.mockResolvedValue({ id, revision: '1' });
  await click('Check passed / ignore reminder');
  expect(
    (run.mock.calls[0][1] as { state: { concentration: { checks: unknown[] } } }).state
      .concentration.checks,
  ).toEqual([]);
  expect(actor.combat!.concentration.checks).toHaveLength(1);
});
