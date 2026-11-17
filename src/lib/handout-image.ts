import sharp from 'sharp';

export const maxHandoutBytes = 512 * 1024;

/** Check bytes rather than the filename or client-supplied MIME type. */
export async function handoutImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxHandoutBytes) throw new Error('Invalid image size');
  const raster =
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ||
    (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!raster) throw new Error('Unsupported image');
  const result = await sharp(bytes, { limitInputPixels: 16_777_216 })
    .autoOrient()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp()
    .toBuffer();
  if (result.length > maxHandoutBytes) throw new Error('Image too large');
  return result;
}
