import sharp from 'sharp';
import type { FogRect } from './types';

/** The concealed source pixels never leave this server-side compositing pipeline. */
export async function maskMap(source: Buffer, width: number, height: number, fog: FogRect[]) {
  const rects = fog
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${r.reveal ? 'white' : 'black'}"/>`,
    )
    .join('');
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${rects}</svg>`,
  );
  const alpha = await sharp(svg).removeAlpha().greyscale().raw().toBuffer();
  const pixels = await sharp(source)
    .flatten({ background: '#0d1420' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
  // Replace concealed RGB values, rather than leaving them under transparent alpha.
  // Partially revealed antialiased edge pixels stay concealed.
  for (let i = 0; i < width * height; i++) {
    if (alpha[i] !== 255) {
      pixels[i * 3] = 13;
      pixels[i * 3 + 1] = 20;
      pixels[i * 3 + 2] = 32;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .webp({ lossless: true })
    .toBuffer();
}
