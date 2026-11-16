// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import MonsterSheet from './monster-sheet';
import { createMonsterSheet, srdMonsters } from '@/lib/srd-monsters';
import { dndId } from '@/lib/dnd';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const props = {
  editable: true,
  rollable: true,
  blocked: false,
  quickEditable: true,
  quickUpdate: vi.fn(),
  onRoll: vi.fn(),
};
async function mount(monster = 'monster-green-hag') {
  const sheet = createMonsterSheet(monster);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(MonsterSheet, { ...props, sheet })));
  return sheet;
}
async function tab(name: string) {
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role=tab]')]
      .find((button) => button.textContent === name)!
      .click(),
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it('opens a compact combat dashboard with only Actions selected and grouped attack rolls', async () => {
  await mount();
  expect(container.querySelector('[aria-label="Combat essentials"]')).not.toBeNull();
  expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Actions');
  expect(container.querySelectorAll('[role=tabpanel]:not([hidden])')).toHaveLength(1);
  const attack = [...container.querySelectorAll('[data-monster-action]')].find(
    (entry) => entry.querySelector('h4')?.textContent === 'Claw',
  )!;
  expect(attack.querySelector('details:not([open])')).not.toBeNull();
  expect(attack.querySelectorAll('button').length).toBeGreaterThan(1);
  expect(container.querySelectorAll('[aria-label="Sheet roll mode"]')).toHaveLength(1);
});

it('applies one roll mode to attacks without modifying damage or spending uses', async () => {
  await mount();
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Sheet roll mode"]')!;
  await act(async () => {
    select.value = 'advantage';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    [...container.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === 'Roll Claw · Attack')!
      .click();
  });
  expect(props.onRoll).toHaveBeenLastCalledWith('2d20kh1 + 6', 'Claw · Attack');
  expect(props.quickUpdate).not.toHaveBeenCalled();
  await tab('Spell');
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === 'Roll Ray of Sickness · Dice 1')!
      .click(),
  );
  expect(props.onRoll).toHaveBeenLastCalledWith('4d8', 'Ray of Sickness · Dice 1');
});

it('shows casting restrictions once, full spells collapsed, and source on a separate tab', async () => {
  await mount();
  await tab('Spell');
  const panel = container.querySelector('[role=tabpanel]:not([hidden])')!;
  const casting = [...panel.querySelectorAll('[data-monster-casting]')].map(
    (entry) => entry.textContent,
  );
  expect(casting.length).toBeGreaterThan(0);
  expect(new Set(casting).size).toBe(casting.length);
  expect(panel.querySelectorAll('details[open]')).toHaveLength(0);
  await tab('Notes & Source');
  expect(container.querySelector('[role=tabpanel]:not([hidden])')?.textContent).toContain(
    'Published Green Hag',
  );
});

it('supports arrow/Home/End tab navigation with linked panels and unique IDs across sheets', async () => {
  const sheet = await mount();
  const first = container.querySelector<HTMLButtonElement>('[role=tab]')!;
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
  );
  const selected = container.querySelector('[role=tab][aria-selected=true]')!;
  expect(selected.textContent).toBe('Notes & Source');
  expect(document.activeElement).toBe(selected);
  expect(document.getElementById(selected.getAttribute('aria-controls')!)?.hidden).toBe(false);
  await act(async () =>
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
  );
  expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Actions');
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
  );
  expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(
    'Notes & Source',
  );
  await act(async () =>
    root.render(
      createElement(
        'div',
        null,
        createElement(MonsterSheet, { ...props, sheet }),
        createElement(MonsterSheet, { ...props, sheet }),
      ),
    ),
  );
  const ids = [...container.querySelectorAll('[id]')].map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('uses saved customized action values and retains custom fields/abilities', async () => {
  const sheet = await mount();
  const savedAttack = sheet.sections
    .flatMap((section) => section.abilities)
    .find((ability) => ability.name === 'Claw · Attack')!;
  savedAttack.name = 'Edited attack';
  savedAttack.expression = '1d20 + 17';
  sheet.sections.push({
    id: 'homebrew',
    title: 'Homebrew',
    fields: [{ id: 'note', label: 'Tactics', kind: 'text', value: 'Protect the door' }],
    abilities: [
      { id: 'custom', name: 'Custom maneuver', description: 'Keep me', expression: '1d6' },
    ],
  });
  await act(async () => root.render(createElement(MonsterSheet, { ...props, sheet })));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Roll Edited attack"]')!.click(),
  );
  expect(props.onRoll).toHaveBeenLastCalledWith('1d20 + 17', 'Edited attack');
  expect(container.textContent).toContain('Custom maneuver');
  expect(container.textContent).toContain('Protect the door');
});

it('updates HP through quick resources and blocks writes/rolls when unconfirmed', async () => {
  const sheet = await mount();
  const hp = container.querySelector<HTMLInputElement>('input[aria-label=HP]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '20');
    hp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(props.quickUpdate).toHaveBeenLastCalledWith([{ id: dndId('monster:hp'), value: 20 }]);
  await act(async () =>
    root.render(createElement(MonsterSheet, { ...props, sheet, blocked: true })),
  );
  expect(container.querySelector<HTMLInputElement>('input[aria-label=HP]')!.disabled).toBe(true);
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[data-monster-action] button')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
});

it('keeps every generated roll/action and editable field exactly once across the entire catalog', () => {
  for (const source of srdMonsters) {
    const sheet = createMonsterSheet(source.id);
    const html = renderToStaticMarkup(createElement(MonsterSheet, { ...props, sheet }));
    const doc = document.createElement('div');
    doc.innerHTML = html;
    const abilities = [...doc.querySelectorAll('[data-monster-ability]')].map((entry) =>
      entry.getAttribute('data-monster-ability'),
    );
    for (const entry of sheet.sections.flatMap((section) => section.abilities))
      expect(
        abilities.filter((id) => id === entry.id),
        `${source.name}: ${entry.name}`,
      ).toHaveLength(1);
    const fields = [...doc.querySelectorAll('[data-monster-field]')].map((entry) =>
      entry.getAttribute('data-monster-field'),
    );
    for (const entry of sheet.sections
      .filter((section) => !['Source', 'Published stat block'].includes(section.title))
      .flatMap((section) => section.fields))
      expect(
        fields.filter((id) => id === entry.id),
        `${source.name}: ${entry.label}`,
      ).toHaveLength(1);
  }
}, 30000);

it('groups across continued sections and leaves orphaned/customized rolls usable', async () => {
  const sheet = await mount();
  const section = sheet.sections.find((entry) => entry.title === 'Actions')!;
  const claw = section.abilities.find((entry) => entry.name === 'Claw')!;
  sheet.sections.push({
    id: 'continued',
    title: 'Actions (continued)',
    fields: [],
    abilities: section.abilities.splice(section.abilities.indexOf(claw) + 1),
  });
  await act(async () => root.render(createElement(MonsterSheet, { ...props, sheet })));
  expect(
    container.querySelector(`[data-monster-action="${claw.id}"] [aria-label="Roll Claw · Attack"]`),
  ).not.toBeNull();
  section.abilities = section.abilities.filter((entry) => entry.id !== claw.id);
  await act(async () => root.render(createElement(MonsterSheet, { ...props, sheet })));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Roll Claw · Attack"]')!.click(),
  );
  expect(props.onRoll).toHaveBeenLastCalledWith('1d20 + 6', 'Claw · Attack');
});

it('keeps homebrew spells on Spell and renamed generated spell rolls use their saved expression', async () => {
  const sheet = await mount();
  const spellSection = sheet.sections.find((section) => section.title === 'Spells')!;
  const attack = spellSection.abilities.find(
    (entry) => entry.name === 'Ray of Sickness · Spell attack',
  )!;
  attack.name = 'Edited spell attack';
  attack.expression = '1d20 + 9';
  spellSection.abilities.push({
    id: 'homebrew-spell',
    name: 'Homebrew spell',
    expression: '2d6',
    description: 'Saved custom spell',
  });
  await act(async () => root.render(createElement(MonsterSheet, { ...props, sheet })));
  await tab('Spell');
  const panel = container.querySelector('[role=tabpanel]:not([hidden])')!;
  expect(panel.textContent).toContain('Homebrew spell');
  await act(async () =>
    panel.querySelector<HTMLButtonElement>('[aria-label="Roll Edited spell attack"]')!.click(),
  );
  expect(props.onRoll).toHaveBeenLastCalledWith('1d20 + 9', 'Edited spell attack');
});
