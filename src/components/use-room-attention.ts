'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
import {
  pulseSignals,
  visibleSignals,
  type AttentionSignal,
  type RoomPulse,
} from '@/lib/attention';
import type { Scene, Snapshot } from '@/lib/types';

async function attentionRequest(
  db: ReturnType<typeof supabaseBrowser>,
  name: 'room_pulse' | 'send_attention',
  args: Record<string, unknown>,
  timeout = 6000,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      db.rpc(name, args).abortSignal(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Attention request timed out'));
        }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function useRoomAttention(snapshot: Snapshot, live: boolean, enabled = true) {
  const [data, setData] = useState<{
    scope: string;
    pulse: RoomPulse;
    signals: AttentionSignal[];
    received: number;
  }>();
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [healthy, setHealthy] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const lastSend = useRef(-Infinity);
  const latest = useRef({ snapshot, live, enabled });
  useEffect(() => {
    latest.current = { snapshot, live, enabled };
  }, [snapshot, live, enabled]);
  const kick = useRef<() => void>(() => {});
  const verify = useRef<(id: string) => Promise<AttentionSignal | undefined>>(
    async () => undefined,
  );
  const scope = `${snapshot.userId}:${snapshot.game.id}`;
  useEffect(() => {
    const db = supabaseBrowser();
    const tab = crypto.randomUUID(); // Memory-only: duplicate tabs must never share a lease.
    let active = true,
      running = false;
    const pulse = async () => {
      if (running || !navigator.onLine || !latest.current.enabled) return;
      running = true;
      const started = Date.now();
      try {
        const { data: result, error } = await attentionRequest(db, 'room_pulse', {
          p_game: snapshot.game.id,
          p_tab: tab,
          p_live: latest.current.live,
        });
        if (!active) return;
        if (error || !result || Date.now() - started > 6000) {
          setHealthy(false);
          return;
        }
        const received = Date.now();
        const pulse = result as RoomPulse;
        setData({ scope, pulse, signals: pulseSignals(pulse, started), received: started });
        setHealthy(true);
        setNow(received);
      } catch {
        if (active) setHealthy(false);
      } finally {
        running = false;
      }
    };
    kick.current = () => {
      void pulse();
    };
    verify.current = async (id) => {
      if (!navigator.onLine || !latest.current.enabled) return;
      const started = Date.now();
      const { data: result, error } = await attentionRequest(
        db,
        'room_pulse',
        {
          p_game: snapshot.game.id,
          p_tab: tab,
          p_live: latest.current.live,
        },
        3000,
      );
      if (!active || error || !result || Date.now() - started > 3000) return;
      const received = Date.now();
      return visibleSignals(
        pulseSignals(result as RoomPulse, started),
        latest.current.snapshot,
        received,
      ).find((s) => s.id === id);
    };
    const connection = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) setHealthy(false);
      else void pulse();
    };
    connection();
    const interval = setInterval(() => {
      void pulse();
    }, 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    document.addEventListener('visibilitychange', connection);
    return () => {
      active = false;
      clearInterval(interval);
      clearInterval(clock);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      document.removeEventListener('visibilitychange', connection);
      kick.current = () => {};
      verify.current = async () => undefined;
      // No unreliable unload write: the tab's server-stamped lease expires.
    };
  }, [scope, snapshot.game.id]);
  useEffect(() => {
    kick.current();
  }, [live, enabled]);
  const fresh =
    enabled && online && healthy && !!data && data.scope === scope && now - data.received < 12000;
  const signals = fresh ? visibleSignals(data.signals, snapshot, now) : [];
  async function send(kind: 'ping' | 'camera', point: { x: number; y: number }, scene: Scene) {
    if (!enabled || busy.current) return;
    if (!navigator.onLine) {
      setMessage('Offline. Attention was not sent.');
      return;
    }
    if (Date.now() - lastSend.current < 2000) {
      setMessage('Wait two seconds between attention requests.');
      return;
    }
    const requestScope = `${scope}:${scene.id}`;
    const currentScope = () =>
      `${latest.current.snapshot.userId}:${latest.current.snapshot.game.id}:${latest.current.snapshot.game.active_scene_id}`;
    busy.current = true;
    lastSend.current = Date.now();
    setSending(true);
    setMessage('');
    try {
      const { error } = await attentionRequest(supabaseBrowser(), 'send_attention', {
        p_game: snapshot.game.id,
        p_scene: scene.id,
        p_revision: scene.revision,
        p_kind: kind,
        p_x: point.x,
        p_y: point.y,
      });
      if (currentScope() !== requestScope) return;
      setMessage(
        error
          ? error.message
          : `${kind === 'ping' ? 'Ping' : 'Camera request'} shared. Delivery is not acknowledged.`,
      );
      kick.current();
    } catch {
      if (currentScope() === requestScope)
        setMessage(
          'Attention not confirmed; it may have been shared. Requests expire automatically.',
        );
    } finally {
      busy.current = false;
      setSending(false);
    }
  }
  return {
    signals,
    members: fresh ? data.pulse.members : [],
    fresh,
    online,
    now,
    message,
    sending,
    send,
    verify: async (id: string) => {
      try {
        return await verify.current(id);
      } catch {
        return undefined;
      }
    },
  };
}
export type RoomAttention = ReturnType<typeof useRoomAttention>;
