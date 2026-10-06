import { expect, it } from 'vitest';
import { diceLayout, rollPose } from './dice-motion';

it('keeps up to eight landed dice inside portrait and landscape screens, without overlap', () => {
  for (const [width, height] of [
    [4, 9],
    [18, 9],
    [9, 4],
    [390 / 64, 844 / 64],
    [1440 / 64, 1000 / 64],
  ]) {
    for (let count = 1; count <= 8; count++) {
      const layout = diceLayout(width, height, count);
      for (const [i, die] of layout.entries()) {
        expect(Math.abs(die.x) + die.scale).toBeLessThan(width / 2);
        expect(Math.abs(die.z) + die.scale).toBeLessThan(height / 2);
        for (const other of layout.slice(i + 1))
          expect(Math.hypot(die.x - other.x, die.z - other.z)).toBeGreaterThan(die.scale * 2);
      }
    }
  }
});

it('travels across the table, bounces, then settles exactly at the target', () => {
  const target = diceLayout(18, 9, 1)[0];
  const start = rollPose(0, target, 18, 9, 0);
  const middle = rollPose(0.4, target, 18, 9, 0);
  const end = rollPose(1, target, 18, 9, 0);
  expect(start.x).toBeLessThan(-9);
  expect(middle.x).toBeGreaterThan(start.x);
  expect(middle.y).toBeGreaterThan(0);
  expect(end).toEqual({ x: target.x, y: 0, z: target.z, spin: 0, settle: 1 });
  expect(rollPose(2, target, 18, 9, 0)).toEqual(end);
});
