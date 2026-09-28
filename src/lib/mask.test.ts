import { expect, it } from 'vitest';
import sharp from 'sharp';
import { maskMap } from './mask';

it('removes concealed source pixels, including underlying transparent RGB', async () => {
  const source = await sharp({
    create: { width: 10, height: 10, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  const output = await maskMap(source, 10, 10, [
    { x: 0, y: 0, width: 5, height: 10, reveal: true },
  ]);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(3);
  expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
  expect([...data.subarray(7 * 3, 8 * 3)]).toEqual([13, 20, 32]);
});
