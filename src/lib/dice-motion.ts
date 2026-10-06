export type DiceTarget = { x: number; z: number; scale: number };

export const rollDuration = 1.8;

export function diceLayout(width: number, height: number, count: number): DiceTarget[] {
  const columns = Math.min(count, width < height ? 2 : 4);
  const rows = Math.ceil(count / columns);
  const spacing = Math.min(2.6, (width * 0.72) / columns, (height * 0.65) / rows);
  const scale = Math.min(1, spacing / 2.6);
  return Array.from({ length: count }, (_, i) => ({
    x:
      ((i % columns) - (Math.min(columns, count - Math.floor(i / columns) * columns) - 1) / 2) *
      spacing,
    z: (Math.floor(i / columns) - (rows - 1) / 2) * spacing,
    scale,
  }));
}

// Scripted tabletop motion: outcomes come from the server, never from animation physics.
export function rollPose(
  progress: number,
  target: DiceTarget,
  width: number,
  height: number,
  index: number,
) {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 1) return { x: target.x, y: 0, z: target.z, spin: 0, settle: 1 };
  const remaining = Math.pow(1 - t, 3);
  const direction = index % 2 === 0 ? -1 : 1;
  return {
    x: target.x + (direction * (width / 2 + 2) - target.x) * remaining,
    y: Math.abs(Math.sin(t * Math.PI * 4)) * (1 - t) * 1.8,
    z:
      target.z +
      (height * 0.35 - target.z) * remaining +
      Math.sin(t * Math.PI) * direction * target.scale,
    spin: (1 - t) * Math.PI * (6 + index),
    settle: Math.max(0, (t - 0.65) / 0.35),
  };
}
