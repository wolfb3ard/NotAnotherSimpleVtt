'use client';

import { useEffect, useRef, useState } from 'react';
import { combatCommandSchema, type Combat } from '@/lib/combat';
import type { Actor } from '@/lib/types';
import type { Command } from '@/lib/commands';
import type { z } from 'zod';

type Request = z.infer<typeof combatCommandSchema>;
export function useCombatCommand(
  actor: Actor,
  userId: string,
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>,
) {
  const key = `vtt-combat:${userId}:${actor.game_id}:${actor.id}`;
  const [state, setState] = useState<{ key: string; attempt?: Request; message: string }>({
    key: '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = useRef('');
  useEffect(() => {
    active.current = key;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let attempt: Request | undefined;
      try {
        const raw = sessionStorage.getItem(key);
        const parsed = raw && combatCommandSchema.safeParse(JSON.parse(raw));
        if (parsed && parsed.success && parsed.data.id === actor.id) attempt = parsed.data;
      } catch {
        /* Optional storage. */
      }
      setState({
        key,
        attempt,
        message: attempt ? 'Combat change unconfirmed. Retry the same operation.' : '',
      });
    });
    return () => {
      cancelled = true;
      active.current = '';
    };
  }, [key, actor.id]);
  const ready = state.key === key;
  async function send(request: Request) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setState({ key, attempt: request, message: 'Saving combat change…' });
    try {
      sessionStorage.setItem(key, JSON.stringify(request));
    } catch {
      /* Optional. */
    }
    let result: Record<string, string> | undefined;
    try {
      result = await run('actor_combat', request);
    } catch {
      /* Retain exact retry. */
    }
    const confirmed = result?.id === actor.id && typeof result.revision === 'string';
    if (confirmed) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional. */
      }
    }
    lock.current = false;
    if (active.current === key) {
      setBusy(false);
      setState(
        confirmed
          ? { key, message: 'Combat change saved.' }
          : {
              key,
              attempt: request,
              message:
                'Combat change failed or unconfirmed. Retry cannot apply it twice. If stale, reload and review before dismissing.',
            },
      );
    }
  }
  return {
    blocked: !ready || busy || !!state.attempt,
    pending: busy || (ready && !!state.attempt),
    busy,
    message: ready ? state.message : 'Loading combat controls…',
    uncertain: ready && !!state.attempt && !busy,
    commit: (combat: Combat) => {
      if (!ready || busy || state.attempt || lock.current) return;
      const parsed = combatCommandSchema.safeParse({
        id: actor.id,
        revision: actor.combat_revision ?? 0,
        operation_id: crypto.randomUUID(),
        state: combat,
      });
      if (parsed.success) void send(parsed.data);
      else setState({ key, message: parsed.error.issues[0].message });
    },
    retry: () => {
      if (ready && state.attempt) void send(state.attempt);
    },
    dismiss: () => {
      if (
        lock.current ||
        !window.confirm(
          'Dismiss this unconfirmed combat change? It may already have committed. This does not reverse it. Review the latest state before editing.',
        )
      )
        return;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional. */
      }
      setState({ key, message: 'Attempt dismissed. Review current combat state before editing.' });
    },
  };
}
