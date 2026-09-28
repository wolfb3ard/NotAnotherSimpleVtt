import type { FogRect } from './types';

export function visibleAt(fog: FogRect[], x: number, y: number): boolean {
  let visible = false;
  for (const rect of fog) {
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
      visible = rect.reveal;
  }
  return visible;
}

export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  unitsPerPixel: number,
) {
  return Math.hypot(b.x - a.x, b.y - a.y) * unitsPerPixel;
}
