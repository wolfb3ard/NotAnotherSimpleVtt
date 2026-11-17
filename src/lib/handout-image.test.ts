import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { handoutImage } from './handout-image';

describe('handout image delivery', () => {
  it('decodes and re-encodes raster pixels without embedded metadata', async () => {
    const input = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .withMetadata()
      .png()
      .toBuffer();
    const output = await sharp(await handoutImage(input)).metadata();
    expect(output.format).toBe('webp');
    expect(output.exif).toBeUndefined();
  });
  it.each([
    Buffer.from('<svg/>'),
    Buffer.from('<html>'),
    Buffer.from('ffd8ff00', 'hex'),
    Buffer.alloc(524289),
  ])('rejects unsupported or invalid bytes', async (input) => {
    await expect(handoutImage(input)).rejects.toThrow();
  });
});
