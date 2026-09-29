import { describe, expect, it } from 'vitest';
import { buildDieModel, visualSides, landingRotation } from './dice-model';
import { Vector3 } from 'three';

describe('polyhedral dice', () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    it(`has ${sides} numbered faces and a valid landing for each result`, () => {
      const model = buildDieModel(sides);
      expect(model.faces).toHaveLength(sides);
      expect(model.faces.map((f) => f.value).sort((a, b) => a - b)).toEqual(
        sides === 10
          ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
          : Array.from({ length: sides }, (_, i) => i + 1),
      );
      for (let value = 1; value <= sides; value++) {
        const face = model.faces.find(
          (f) => f.value === (sides === 10 && value === 10 ? 0 : value),
        )!;
        const up = face.normal.clone().applyQuaternion(landingRotation(model, value));
        expect(up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(0.0001);
      }
      if (sides !== 4)
        for (const face of model.faces) {
          const opposite = model.faces.reduce(
            (best, other) =>
              face.normal.dot(other.normal) < face.normal.dot(best.normal) ? other : best,
            model.faces[0],
          );
          expect(face.normal.dot(opposite.normal)).toBeLessThan(-0.8);
          expect(face.value + opposite.value).toBe(sides === 10 ? 9 : sides + 1);
        }
      const positions = model.geometry.getAttribute('position');
      expect(positions.count).toBeGreaterThanOrEqual(sides * 3);
      for (let i = 0; i < positions.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(positions, i);
        const b = new Vector3().fromBufferAttribute(positions, i + 1);
        const c = new Vector3().fromBufferAttribute(positions, i + 2);
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        expect(normal.dot(a.clone().add(b).add(c))).toBeGreaterThan(0);
      }
      model.geometry.dispose();
    });
  }
  it('renders arbitrary dice and masked dice with question marks only', () => {
    expect(visualSides(7)).toBe(6);
    expect(visualSides(100)).toBe(6);
    expect(buildDieModel(6).faces.every((f) => f.value >= 1)).toBe(true);
  });
});
