import { describe, expect, it } from 'vitest';
import { areaContains, areaLabel, areaPath, areaSchema, type Area } from './tactical-templates';

const base: Area = { kind: 'circle', x: 100, y: 100, size: 20, width: 5, rotation: 0 };
describe('calibrated tactical geometry', () => {
  it.each([0.1, 1, 2.5])('keeps circle radius in scene units at %s units/pixel', (scale) => {
    expect(areaContains(base, { x: 100 + 20 / scale, y: 100 }, scale)).toBe(true);
    expect(areaContains(base, { x: 100 + 20.1 / scale, y: 100 }, scale)).toBe(false);
    expect(areaPath(base, scale)).toContain(`A ${20 / scale} ${20 / scale}`);
  });
  it('rotates line origin, width and inclusive edges clockwise', () => {
    const line = { ...base, kind: 'line' as const, rotation: 90 };
    expect(areaContains(line, { x: 102.5, y: 120 }, 1)).toBe(true);
    expect(areaContains(line, { x: 103, y: 120 }, 1)).toBe(false);
    expect(areaContains(line, { x: 100, y: 99 }, 1)).toBe(false);
  });
  it('uses a 90 degree circular sector, not a triangular cone', () => {
    const cone = { ...base, kind: 'cone' as const };
    expect(areaContains(cone, { x: 110, y: 110 }, 1)).toBe(true);
    expect(areaContains(cone, { x: 120, y: 120 }, 1)).toBe(false);
    expect(areaContains(cone, { x: 90, y: 100 }, 1)).toBe(false);
    expect(areaPath(cone, 1)).toContain('A 20 20');
  });
  it('centers cube footprint, including rotated corners', () => {
    const cube = { ...base, kind: 'cube' as const, rotation: 45 };
    expect(areaContains(cube, { x: 100 + Math.sqrt(200), y: 100 }, 1)).toBe(true);
    expect(areaContains(cube, { x: 115, y: 100 }, 1)).toBe(false);
    expect(areaPath(cube, 1)).toBe('M -10 -10 H 10 V 10 H -10 Z');
  });
  it('labels dimensions, units, angle and non-color shape', () => {
    expect(areaLabel(base, 'm')).toBe('circle · 20 m radius · 0°');
    expect(areaLabel({ ...base, kind: 'line' }, 'ft')).toContain('5 ft width');
  });
  it.each([
    { size: 0 },
    { width: -1 },
    { x: NaN },
    { y: Infinity },
    { rotation: 361 },
    { kind: 'sphere' },
  ])('rejects invalid geometry %j', (change) => {
    expect(areaSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
});
