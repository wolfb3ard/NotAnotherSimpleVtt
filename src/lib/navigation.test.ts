import { describe, expect, it } from 'vitest';
import { clampView, fitView, gridLines, movementPoint, zoomView } from './navigation';
import { distance } from './geometry';

const scene = { width: 600, height: 400 };
const grid = { enabled: true, size: 50, origin_x: 10, origin_y: 20 };
describe('map navigation geometry', () => {
  it('snaps token centers to offset cell centers, not corners', () => {
    expect(movementPoint({ x: 79, y: 97 }, scene, grid, true)).toEqual({ x: 85, y: 95 });
    expect(movementPoint({ x: 79, y: 97 }, scene, grid, false)).toEqual({ x: 79, y: 97 });
    expect(movementPoint({ x: 79, y: 97 }, scene, { ...grid, enabled: false }, true)).toEqual({
      x: 79,
      y: 97,
    });
  });
  it('keeps snapped and free destinations inside the map including partial edge cells', () => {
    expect(movementPoint({ x: 900, y: -40 }, scene, grid, false)).toEqual({ x: 599.99, y: 0 });
    const p = movementPoint({ x: 599, y: 399 }, scene, grid, true);
    expect(p.x).toBeLessThan(600);
    expect(p.y).toBeLessThan(400);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
  it('draws bounded grid lines at calibrated origins', () => {
    expect(gridLines(160, 50, 10)).toEqual([10, 60, 110, 160]);
    expect(gridLines(160, 50, 110)).toEqual([10, 60, 110, 160]);
  });
  it('measures Euclidean displacement in calibrated units independent of zoom', () => {
    expect(distance({ x: 0, y: 0 }, { x: 30, y: 40 }, 0.1)).toBe(5);
  });
  it('clamps corrupt/offscreen restores and scales; fits even a tiny viewport', () => {
    const size = { width: 800, height: 600 };
    expect(clampView({ x: 1e9, y: -1e9, scale: 100 }, scene, size)).toEqual({
      x: 736,
      y: -1936,
      scale: 5,
    });
    expect(clampView({ x: NaN, y: Infinity, scale: NaN }, scene, size)).toEqual({
      x: 50,
      y: 50,
      scale: 1,
    });
    expect(fitView(scene, { width: 10, height: 10 }).scale).toBe(0.05);
  });
  it('zooms around the same screen point and bounds zoom', () => {
    expect(zoomView({ x: 50, y: 50, scale: 1 }, { x: 150, y: 150 }, 2)).toEqual({
      x: -50,
      y: -50,
      scale: 2,
    });
    expect(zoomView({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 99).scale).toBe(5);
  });
});
