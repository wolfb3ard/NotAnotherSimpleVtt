// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { fitWindow, loadLayout } from './window-layout';

it('fits every edge of a restored window even below its usual minimum size', () => {
  const saved = { left: 2100, top: -100, width: 800, height: 600, maximized: false };
  expect(fitWindow('sheet', 300, 180, saved)).toEqual({
    left: 8,
    top: 8,
    width: 284,
    height: 164,
    maximized: false,
  });
  expect(fitWindow('roll', 1024, 768, saved)).toMatchObject({
    left: 216,
    top: 8,
    width: 800,
    height: 600,
  });
});

it('falls back to a docked layout for invalid data or blocked storage', () => {
  for (const value of ['{', '{"detached":"yes"}', '{"detached":true,"sheet":{"width":-1}}']) {
    vi.stubGlobal('localStorage', { getItem: () => value });
    expect(loadLayout('layout')).toEqual({ detached: false });
  }
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('denied');
    },
  });
  try {
    expect(loadLayout('layout')).toEqual({ detached: false });
  } finally {
    vi.unstubAllGlobals();
  }
});
