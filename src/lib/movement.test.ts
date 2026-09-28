import { expect, it } from 'vitest';
import { movementQueue } from './movement';

it('coalesces pending movement and persists the final point with consecutive revisions', async () => {
  const sent: { x: number; revision: number }[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = movementQueue(7, async (point, revision) => {
    sent.push({ x: point.x, revision });
    if (revision === 7) await blocked;
    return true;
  });
  const first = queue.move({ x: 1, y: 0 });
  void queue.move({ x: 2, y: 0 });
  const final = queue.move({ x: 3, y: 0 });
  release();
  expect(await first).toBe(true);
  expect(await final).toBe(true);
  expect(sent).toEqual([
    { x: 1, revision: 7 },
    { x: 3, revision: 8 },
  ]);
});
it('stops after conflicts instead of overwriting a concurrent move', async () => {
  let calls = 0;
  const queue = movementQueue(0, async () => {
    calls++;
    return false;
  });
  expect(await queue.move({ x: 1, y: 0 })).toBe(false);
  expect(await queue.move({ x: 2, y: 0 })).toBe(false);
  expect(calls).toBe(1);
});
