type Point = { x: number; y: number };

/** Coalesce drag updates while preserving revision order and the final position. */
export function movementQueue(
  initialRevision: number,
  send: (point: Point, revision: number) => Promise<boolean>,
) {
  let revision = initialRevision;
  let next: Point | null = null;
  let running: Promise<boolean> | null = null;
  let failed = false;
  async function drain(): Promise<boolean> {
    while (next && !failed) {
      const point = next;
      next = null;
      try {
        failed = !(await send(point, revision));
      } catch {
        failed = true;
      }
      if (!failed) revision++;
    }
    return !failed;
  }
  return {
    move(point: Point): Promise<boolean> {
      if (failed) return Promise.resolve(false);
      next = point;
      if (!running)
        running = drain().finally(() => {
          running = null;
        });
      return running;
    },
  };
}
