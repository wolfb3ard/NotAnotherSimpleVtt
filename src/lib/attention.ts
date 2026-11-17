import { visibleAt } from './geometry';
import type { Snapshot } from './types';

export type AttentionSignal = {
  id: string;
  user_id: string;
  kind: 'ping' | 'camera';
  scene_id: string;
  scene_revision: number;
  x: number;
  y: number;
  created_at: string;
  expires_at: string;
  deadline: number;
};
export type RoomPulse = {
  now: string;
  members: { user_id: string; live: boolean; tabs: number }[];
  signals: Omit<AttentionSignal, 'deadline'>[];
};
export function pulseSignals(pulse: RoomPulse, received: number): AttentionSignal[] {
  return pulse.signals.map((s) => ({
    ...s,
    // Server-relative TTL avoids trusting the browser's wall clock.
    deadline:
      received +
      Math.max(
        0,
        Math.min(
          s.kind === 'ping' ? 8000 : 20000,
          Date.parse(s.expires_at) - Date.parse(pulse.now),
        ),
      ),
  }));
}
export function visibleSignals(signals: AttentionSignal[], snapshot: Snapshot, now: number) {
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  return signals.filter(
    (s) =>
      scene &&
      s.scene_id === scene.id &&
      s.scene_revision === scene.revision &&
      s.deadline > now &&
      snapshot.members.some((m) => m.user_id === s.user_id) &&
      (s.kind === 'ping' || s.user_id === snapshot.game.gm_id) &&
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      s.x >= 0 &&
      s.y >= 0 &&
      s.x < scene.width &&
      s.y < scene.height &&
      visibleAt(scene.fog, s.x, s.y),
  );
}
