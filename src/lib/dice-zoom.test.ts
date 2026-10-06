import { afterEach, expect, it, vi } from 'vitest';
import { baseDiceZoom, normalizeDiceZoom } from './dice-zoom';

afterEach(() => vi.unstubAllGlobals());

it('allows current size through double size, never smaller', () => {
  expect(baseDiceZoom).toBe(64);
  expect(normalizeDiceZoom(0.5)).toBe(1);
  expect(normalizeDiceZoom(1.5)).toBe(1.5);
  expect(normalizeDiceZoom(2)).toBe(2);
  expect(normalizeDiceZoom(3)).toBe(2);
  expect(normalizeDiceZoom(NaN)).toBe(1);
});

it('persists a personal zoom, restores it and notifies viewers', async () => {
  vi.resetModules();
  const values = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  vi.stubGlobal('window', browser);
  const store = await import('./dice-zoom');
  const changed = vi.fn();
  const unsubscribe = store.subscribeDiceZoom(changed);
  expect(store.getDiceZoom()).toBe(1);
  store.setDiceZoom(1.75);
  expect(changed).toHaveBeenCalledOnce();
  expect(values.get(store.diceZoomKey)).toBe('1.75');
  expect(store.getDiceZoom()).toBe(1.75);
  values.set(store.diceZoomKey, '2');
  browser.dispatchEvent(Object.assign(new Event('storage'), { key: store.diceZoomKey }));
  expect(store.getDiceZoom()).toBe(2);
  unsubscribe();
  vi.resetModules();
  expect((await import('./dice-zoom')).getDiceZoom()).toBe(2);
});

it('keeps zoom usable when storage is blocked', async () => {
  vi.resetModules();
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: () => {
          throw new Error('Blocked');
        },
        setItem: () => {
          throw new Error('Blocked');
        },
      },
    }),
  );
  const store = await import('./dice-zoom');
  expect(store.getDiceZoom()).toBe(1);
  store.setDiceZoom(2);
  expect(store.getDiceZoom()).toBe(2);
});
