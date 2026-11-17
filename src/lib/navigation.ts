import { z } from 'zod';

export const gridSchema = z
  .object({
    enabled: z.boolean(),
    size: z.number().finite().min(8).max(1024),
    origin_x: z.number().finite().min(0).max(4096),
    origin_y: z.number().finite().min(0).max(4096),
  })
  .strict();
export type Grid = z.infer<typeof gridSchema>;
export const defaultGrid: Grid = { enabled: false, size: 50, origin_x: 0, origin_y: 0 };
export type Point = { x: number; y: number };
type Bounds = { width: number; height: number };
export type View = Point & { scale: number };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function movementPoint(p: Point, scene: Bounds, grid: Grid, snap: boolean): Point {
  const axis = (value: number, origin: number, bound: number) => {
    const next =
      snap && grid.enabled
        ? origin + (Math.round((value - origin) / grid.size - 0.5) + 0.5) * grid.size
        : value;
    return clamp(next, 0, bound - 0.01);
  };
  return { x: axis(p.x, grid.origin_x, scene.width), y: axis(p.y, grid.origin_y, scene.height) };
}
export function gridLines(bound: number, size: number, origin: number): number[] {
  // Schema limits keep rendering bounded (at most 513 lines per axis).
  if (size < 8 || !Number.isFinite(size)) return [];
  const first = ((origin % size) + size) % size;
  return Array.from({ length: Math.floor((bound - first) / size) + 1 }, (_, i) => first + i * size);
}
export function fitView(scene: Bounds, viewport: Bounds): View {
  const scale = clamp(
    Math.min((viewport.width - 80) / scene.width, (viewport.height - 80) / scene.height, 2),
    0.05,
    5,
  );
  return {
    scale,
    x: (viewport.width - scene.width * scale) / 2,
    y: (viewport.height - scene.height * scale) / 2,
  };
}
export function clampView(view: View, scene: Bounds, viewport: Bounds): View {
  const scale = clamp(Number.isFinite(view.scale) ? view.scale : 1, 0.05, 5);
  const margin = Math.min(64, viewport.width / 2, viewport.height / 2);
  return {
    scale,
    x: clamp(
      Number.isFinite(view.x) ? view.x : 50,
      margin - scene.width * scale,
      viewport.width - margin,
    ),
    y: clamp(
      Number.isFinite(view.y) ? view.y : 50,
      margin - scene.height * scale,
      viewport.height - margin,
    ),
  };
}
export function zoomView(view: View, point: Point, requested: number): View {
  const scale = clamp(requested, 0.05, 5);
  return {
    scale,
    x: point.x - ((point.x - view.x) / view.scale) * scale,
    y: point.y - ((point.y - view.y) / view.scale) * scale,
  };
}

export function navigationInput(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
    )
  );
}
