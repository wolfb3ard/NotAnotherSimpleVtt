// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SrdCatalog } from './srd-catalog';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
});

it('keeps rule headings and grouped variants non-addable, while selecting a concrete item preserves its metadata', async () => {
  const onAddItem = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(SrdCatalog, { onAddItem })));
  const search = async (text: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await search('Ending Attunement');
  expect(
    [...container.querySelectorAll('button')].some(
      (button) => button.textContent === 'Add Ending Attunement to inventory',
    ),
  ).toBe(false);
  await search('Armor, +1, +2, or +3');
  expect(
    [...container.querySelectorAll('button')].some(
      (button) => button.textContent === 'Add Armor, +1, +2, or +3 to inventory',
    ),
  ).toBe(false);
  await search('Plate Armor +3');
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Add Plate Armor +3 to inventory',
  )!;
  await act(async () => button.click());
  expect(onAddItem).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Plate Armor +3',
      rarity: 'Legendary',
      addable: true,
    }),
  );
  expect(container.querySelector('input[type="number"]')).toBeNull();
  expect(container.textContent).not.toMatch(/PDF page|PDF pp?\./);
  expect(container.textContent).not.toContain('Create Your Character');
});
