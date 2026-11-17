// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PracticeTable } from './practice-table';
import type { Role } from '@/lib/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
const press = async (text: string) => act(async () => button(text).click());
async function start(role: Role) {
  await act(async () => root.render(createElement(PracticeTable, { role })));
  expect(container.querySelector('dialog')).toBeNull();
  await press('Start practice');
  expect(container.querySelector('dialog')?.open).toBe(true);
}

it('lets a GM place and reveal a token before starting a simulated encounter', async () => {
  await start('gm');
  expect(button('Start encounter').disabled).toBe(true);
  await press('Place goblin');
  await press('Clearing · Fog');
  await press('Reveal fog');
  await press('Trail · Fog');
  expect(button('Start encounter').disabled).toBe(true);
  await press('Reveal fog');
  await press('Clearing · Goblin · Fog');
  await press('Start encounter');
  expect(container.textContent).toContain('Round 1 · Goblin’s turn.');
  await press('Replay tutorial');
  expect(container.textContent).not.toContain('Round 1');
  expect(button('Clearing · Fog')).toBeDefined();
  await press('Place goblin');
  await act(async () => {
    expect(
      container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })),
    ).toBe(false);
  });
  expect(button('Clearing · Fog').disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('lets a player locate Rowan, open the sheet, roll, and start over', async () => {
  await start('player');
  await press('Find my character');
  expect(document.activeElement).toBe(button('◆ Rowan'));
  await press('◆ Rowan');
  await press('Roll Perception');
  expect(container.textContent).toMatch(/d20 \(\d+\) \+ 3 = \d+/);
  await press('Leave practice');
  expect(container.querySelector('dialog')).toBeNull();
  await press('Start practice');
  expect(button('◆ Rowan')).toBeUndefined();
  expect(button('Roll Perception')).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});
