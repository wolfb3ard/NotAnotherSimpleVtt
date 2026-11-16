// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SrdBuilder } from './srd-builder';
import { createDndSheet, dndId } from '@/lib/dnd';
import { applySrdBuilder } from '@/lib/srd-engine';
import { fighterBuilder } from '@/lib/srd-test-fixtures';
import type { Sheet } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((node) => node.textContent === text)!;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
async function render(sheet: Sheet, editable = true) {
  const update = vi.fn((edit: (target: Sheet) => void) => edit(sheet));
  await act(async () => root.render(createElement(SrdBuilder, { sheet, editable, update })));
  return update;
}
describe('isolated SRD builder draft', () => {
  it('adds a specific catalog purchase lot to inventory without inventing a generic quantity', async () => {
    const sheet = createDndSheet();
    await render(sheet);
    await act(async () => {
      const category = container.querySelector<HTMLSelectElement>('select')!;
      category.value = 'equipment';
      category.dispatchEvent(new Event('change', { bubbles: true }));
      const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'Needles',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Add Needles to inventory'));
    expect(sheet.character!.items[0]).toMatchObject({
      name: 'Needles',
      quantity: 50,
      rarity: 'Common',
    });
    expect(sheet.character!.items[0].description).toContain('Storage (sold separately)');
  });
  it('allows read-only catalog access but not character mutation', async () => {
    const sheet = createDndSheet(),
      update = await render(sheet, false);
    expect(button('Create with SRD builder').disabled).toBe(true);
    expect(container.textContent).toContain('complete source pages');
    expect(container.querySelector('dialog')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it('cancels draft levels without changing the parent sheet or marking dirty', async () => {
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder());
    const before = structuredClone(sheet),
      update = await render(sheet);
    await click(button('Progress / level up character'));
    await click(button('Add level 2'));
    expect(container.textContent).toContain('total level 2');
    expect(sheet).toEqual(before);
    expect(update).not.toHaveBeenCalled();
    await click(button('Cancel draft'));
    expect(container.querySelector('dialog')).toBeNull();
    expect(sheet).toEqual(before);
  });
  it('applies a valid levelup exactly once through the existing dirty-sheet update API', async () => {
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder()),
      update = await render(sheet);
    await click(button('Progress / level up character'));
    await click(button('Add level 2'));
    expect(button('Apply builder to unsaved sheet').disabled).toBe(false);
    await click(button('Apply builder to unsaved sheet'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(sheet.character?.builder?.levels).toHaveLength(2);
    expect(
      sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('level'))?.value,
    ).toBe(2);
    expect(container.querySelector('dialog')).toBeNull();
  });
  it('blocks applying a stale draft when sheet props change', async () => {
    const sheet = applySrdBuilder(createDndSheet(), fighterBuilder());
    await render(sheet);
    await click(button('Progress / level up character'));
    const changed = structuredClone(sheet);
    changed.sections[0].fields[0].value = 2;
    await render(changed);
    expect(container.textContent).toContain('Sheet changed while this draft was open');
    expect(button('Apply builder to unsaved sheet').disabled).toBe(true);
    const dialog = container.querySelector('dialog')!;
    await act(async () =>
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })),
    );
    expect(container.querySelector('dialog')).toBeNull();
  });
});
