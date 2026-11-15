import {
  Body,
  Box,
  ContactMaterial,
  ConvexPolyhedron,
  Material,
  Plane,
  Vec3,
  World,
} from 'cannon-es';
import { Quaternion } from 'three';
import { buildDieModel, outcomeSymmetry, visualSides } from './dice-model';
import type { DieVisual } from './dice-presentation';

export type Pose = {
  position: [number, number, number];
  rotation: [number, number, number, number];
};
export type DiceMotion = { frames: Pose[][]; duration: number; width: number; depth: number };
export const PHYSICS_HZ = 60;

/** Simulate before playback. A fixed shape symmetry reconciles each server outcome
 * before the first visible frame; labels and rigid-body trajectories never change mid-roll. */
export function simulateDice(
  dice: DieVisual[],
  seed: string,
  aspect = 1.8,
  bounds?: { width: number; depth: number },
): DiceMotion {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const width = bounds ? Math.max(6, bounds.width) : Math.max(10, Math.min(24, 12 * aspect));
  const depth = bounds ? Math.max(6, bounds.depth) : 12;
  const models = dice.map((d) => buildDieModel(visualSides(d.sides)));
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const world = new World({ gravity: new Vec3(0, -28, 0), allowSleep: true });
      const material = new Material();
      world.addContactMaterial(
        new ContactMaterial(material, material, { friction: 0.38, restitution: 0.42 }),
      );
      const floor = new Body({ mass: 0, material, shape: new Plane() });
      floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      world.addBody(floor);
      for (const [x, z, sx, sz] of [
        [-width / 2 - 0.5, 0, 0.5, depth],
        [width / 2 + 0.5, 0, 0.5, depth],
        [0, -depth / 2 - 0.5, width, 0.5],
        [0, depth / 2 + 0.5, width, 0.5],
      ]) {
        const wall = new Body({ mass: 0, material, shape: new Box(new Vec3(sx, 12, sz)) });
        wall.position.set(x, 10, z);
        world.addBody(wall);
      }
      const bodies = models.map((model, i) => {
        const body = new Body({
          mass: 1,
          material,
          shape: new ConvexPolyhedron({
            vertices: model.vertices.map((v) => new Vec3(v.x, v.y, v.z)),
            faces: model.polygons,
          }),
          linearDamping: 0.22,
          angularDamping: 0.22,
          sleepSpeedLimit: 0.15,
          sleepTimeLimit: 0.45,
        });
        const columns = Math.max(1, Math.min(4, Math.floor((width - 1) / 2.4)));
        body.position.set(
          columns === 1 ? 0 : -width / 2 + 1.5 + ((i % columns) * (width - 3)) / (columns - 1),
          3 + Math.floor(i / columns) * 2.5,
          -depth / 2 + 2 + random() * 2,
        );
        body.quaternion.setFromEuler(random() * 6.28, random() * 6.28, random() * 6.28);
        body.velocity.set((random() - 0.5) * 12, 2 + random() * 3, 4 + random() * 7);
        body.angularVelocity.set(
          (random() - 0.5) * 24,
          (random() - 0.5) * 24,
          (random() - 0.5) * 24,
        );
        world.addBody(body);
        return body;
      });
      const frames: Pose[][] = [];
      const capture = () =>
        frames.push(
          bodies.map((body) => ({
            position: body.position.toArray() as Pose['position'],
            rotation: body.quaternion.toArray() as Pose['rotation'],
          })),
        );
      capture();
      for (let frame = 0; frame < PHYSICS_HZ * 10; frame++) {
        world.step(1 / 120);
        world.step(1 / 120);
        capture();
        if (frame > PHYSICS_HZ && bodies.every((b) => b.sleepState === Body.SLEEPING)) break;
      }
      const valid = bodies.every((b, i) => {
        const q = new Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        const dots = models[i].faces.map(
          (f) => f.normal.clone().applyQuaternion(q).y * (models[i].faces.length === 4 ? -1 : 1),
        );
        return b.sleepState === Body.SLEEPING && Math.max(...dots) > 0.9995;
      });
      if (!valid) continue; // Reroll cocked dice offscreen, never steer them into place.
      const symmetries = bodies.map((b, i) =>
        outcomeSymmetry(
          models[i],
          new Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w),
          dice[i].masked ? 1 : dice[i].value,
        ),
      );
      for (const frame of frames)
        frame.forEach((pose, i) => {
          pose.rotation = new Quaternion()
            .fromArray(pose.rotation)
            .multiply(symmetries[i])
            .toArray();
        });
      return { frames, duration: (frames.length - 1) / PHYSICS_HZ, width, depth };
    }
    throw new Error('Dice did not settle. Use the recorded result.');
  } finally {
    models.forEach((m) => m.geometry.dispose());
  }
}
