import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { buildDieModel, outcomeSymmetry } from './dice-model';
import { simulateDice } from './dice-physics';

describe('physical dice', () => {
  it.each([1, 2])('fits the full-screen tray at %sx personal zoom', (zoom) => {
    const dice = [4, 6, 8, 10, 12, 20, 6, 20].map((sides) => ({
      sides,
      value: 1,
      kept: true,
      masked: false,
    }));
    const bounds = { width: (1440 / (64 * zoom)) * 0.96, depth: (1000 / (64 * zoom)) * 0.96 };
    const motion = simulateDice(dice, `zoom-${zoom}`, 1.44, bounds);
    expect(motion.width).toBe(bounds.width);
    expect(motion.depth).toBe(bounds.depth);
    expect(
      motion.frames.every((frame) =>
        frame.every(
          (p) =>
            Math.abs(p.position[0]) < bounds.width / 2 &&
            Math.abs(p.position[2]) < bounds.depth / 2,
        ),
      ),
    ).toBe(true);
  });
  it.each(Array.from({ length: 12 }, (_, i) => i))(
    'settles mixed dice across different launches and tray sizes (%i)',
    (seed) => {
      const dice = [4, 6, 8, 10, 12, 20].map((sides) => ({
        sides,
        value: sides,
        kept: true,
        masked: false,
      }));
      const motion = simulateDice(dice, `varied-${seed}`, seed % 2 ? 0.8 : 2.5);
      expect(motion.frames.length).toBeGreaterThan(60);
      dice.forEach((die, i) => {
        const model = buildDieModel(die.sides);
        const face = model.faces.find((f) => f.value === (die.sides === 10 ? 0 : die.value))!;
        expect(
          face.normal
            .clone()
            .applyQuaternion(new Quaternion().fromArray(motion.frames.at(-1)![i].rotation)).y *
            (die.sides === 4 ? -1 : 1),
        ).toBeGreaterThan(0.9995);
        model.geometry.dispose();
      });
    },
  );
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    it(`uses true d${sides} symmetries for every face and outcome`, () => {
      const model = buildDieModel(sides);
      for (const resting of model.faces) {
        const axis = new Vector3(0, sides === 4 ? -1 : 1, 0);
        const settled = new Quaternion().setFromUnitVectors(resting.normal, axis);
        for (let value = 1; value <= sides; value++) {
          const symmetry = outcomeSymmetry(model, settled, value);
          const face = model.faces.find(
            (f) => f.value === (sides === 10 && value === 10 ? 0 : value),
          )!;
          expect(
            face.normal.clone().applyQuaternion(symmetry).applyQuaternion(settled).dot(axis),
          ).toBeCloseTo(1, 4);
          expect(
            model.vertices.every((v) =>
              model.vertices.some(
                (other) => other.distanceTo(v.clone().applyQuaternion(symmetry)) < 0.0001,
              ),
            ),
          ).toBe(true);
        }
      }
      model.geometry.dispose();
    });
  }
  it('bounces, stays inside the tray, settles, and shows every authoritative outcome', () => {
    const dice = [4, 6, 8, 10, 12, 20, 6, 20].map((sides, i) => ({
      sides,
      value: (i % sides) + 1,
      kept: i !== 0,
      masked: false,
    }));
    const motion = simulateDice(dice, 'physics-regression');
    expect(motion.duration).toBeGreaterThan(1);
    expect(motion.duration).toBeLessThanOrEqual(10);
    dice.forEach((die, i) => {
      const positions = motion.frames.map((f) => f[i].position);
      expect(
        positions.some(
          (p, frame) =>
            frame > 1 && p[1] > positions[frame - 1][1] && positions[frame - 1][1] < 1.5,
        ),
      ).toBe(true);
      expect(
        positions.every(
          (p) => Math.abs(p[0]) < motion.width / 2 && Math.abs(p[2]) < motion.depth / 2 && p[1] > 0,
        ),
      ).toBe(true);
      const model = buildDieModel(die.sides);
      const last = motion.frames.at(-1)![i];
      const face = model.faces.find((f) => f.value === die.value)!;
      expect(
        face.normal.clone().applyQuaternion(new Quaternion().fromArray(last.rotation)).y *
          (die.sides === 4 ? -1 : 1),
      ).toBeGreaterThan(0.985);
      model.geometry.dispose();
    });
    expect(simulateDice(dice, 'physics-regression')).toEqual(motion);
  });
});
