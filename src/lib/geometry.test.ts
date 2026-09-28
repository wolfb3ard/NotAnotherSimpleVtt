import { expect, it } from 'vitest';
import { distance, visibleAt } from './geometry';

it('defaults fog to concealed and applies ordered reveal/conceal operations', () => {
  const fog = [
    { x: 0, y: 0, width: 100, height: 100, reveal: true },
    { x: 20, y: 20, width: 10, height: 10, reveal: false },
  ];
  expect(visibleAt([], 1, 1)).toBe(false);
  expect(visibleAt(fog, 10, 10)).toBe(true);
  expect(visibleAt(fog, 25, 25)).toBe(false);
  expect(visibleAt(fog, 100, 50)).toBe(false);
});
it('measures in calibrated scene coordinates', () => {
  expect(distance({ x: 100, y: 100 }, { x: 103, y: 104 }, 2)).toBe(10);
});
