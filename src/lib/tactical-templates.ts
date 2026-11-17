import { z } from 'zod';

export const areaSchema = z
  .object({
    kind: z.enum(['circle', 'cone', 'line', 'cube']),
    x: z.number().finite().min(0).max(4096),
    y: z.number().finite().min(0).max(4096),
    size: z.number().finite().positive().max(10000),
    width: z.number().finite().positive().max(10000),
    rotation: z.number().finite().min(0).max(360),
  })
  .strict();
export type Area = z.infer<typeof areaSchema>;
export type SharedArea = {
  owner_id: string;
  scene_id: string;
  scene_revision: number;
  revision: number;
  area: Area | null;
};
export const tacticalCommandSchema = z.object({
  scene_id: z.string().uuid(),
  scene_revision: z.number().int().nonnegative(),
  owner_id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  operation_id: z.string().uuid(),
  area: areaSchema.nullable(),
});

// Map pixels; circle radius, cone length (90°), line length/width, cube side.
// Rotation clockwise from map-right; cone/line start at origin, cube centered.
export function areaPath(a: Area, unitsPerPixel: number): string {
  const s = a.size / unitsPerPixel,
    w = a.width / unitsPerPixel;
  if (a.kind === 'circle') return `M ${-s} 0 A ${s} ${s} 0 1 0 ${s} 0 A ${s} ${s} 0 1 0 ${-s} 0 Z`;
  if (a.kind === 'cone') {
    const r = s / Math.sqrt(2);
    return `M 0 0 L ${r} ${-r} A ${s} ${s} 0 0 1 ${r} ${r} Z`;
  }
  const x = a.kind === 'cube' ? -s / 2 : 0;
  const half = a.kind === 'cube' ? s / 2 : w / 2;
  return `M ${x} ${-half} H ${x + s} V ${half} H ${x} Z`;
}

export function areaLabel(a: Area, unit: string): string {
  const dimension = a.kind === 'circle' ? 'radius' : a.kind === 'cube' ? 'side' : 'length';
  return `${a.kind} · ${a.size} ${unit} ${dimension}${a.kind === 'line' ? ` × ${a.width} ${unit} width` : ''}${a.kind === 'cone' ? ' · 90°' : ''} · ${a.rotation}°`;
}

// Optional geometric reference, not automatic creature targeting. Boundary included.
export function areaContains(a: Area, point: { x: number; y: number }, unitsPerPixel: number) {
  const angle = (a.rotation * Math.PI) / 180;
  const dx = (point.x - a.x) * unitsPerPixel,
    dy = (point.y - a.y) * unitsPerPixel;
  const x = dx * Math.cos(angle) + dy * Math.sin(angle);
  const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const epsilon = 1e-8;
  if (a.kind === 'circle') return Math.hypot(x, y) <= a.size + epsilon;
  if (a.kind === 'cone')
    return x >= -epsilon && Math.abs(y) <= x + epsilon && Math.hypot(x, y) <= a.size + epsilon;
  if (a.kind === 'cube')
    return Math.abs(x) <= a.size / 2 + epsilon && Math.abs(y) <= a.size / 2 + epsilon;
  return x >= -epsilon && x <= a.size + epsilon && Math.abs(y) <= a.width / 2 + epsilon;
}
