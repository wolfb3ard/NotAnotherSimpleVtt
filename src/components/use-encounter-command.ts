'use client';

import { useEffect, useRef, useState } from 'react';
import type { Command } from '@/lib/commands';
import { encounterCommandSchema, type EncounterRequest } from '@/lib/encounter-commands';

type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
/** One uncertain command per user/game/scene; never optimistically advance turns. */
export function useEncounterCommand(scope: string, run: Run, refresh: () => Promise<void>) {
  const storageKey = `vtt-encounter:${scope}`;
  const [state, setState] = useState<{
    scope: string;
    attempt?: EncounterRequest;
    message: string;
  }>({ scope: '', message: '' });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = useRef(true);
  const currentScope = useRef(scope);
  useEffect(() => {
    active.current = true;
    currentScope.current = scope;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let attempt: EncounterRequest | undefined;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = encounterCommandSchema.safeParse(JSON.parse(raw));
          if (parsed.success) attempt = parsed.data;
        }
      } catch {
        /* Storage is optional. */
      }
      setState({
        scope,
        attempt,
        message: attempt
          ? 'Encounter change unconfirmed. Retry the same operation to acknowledge it.'
          : '',
      });
    });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [scope, storageKey]);
  const ready = state.scope === scope;
  const blocked = !ready || busy || !!state.attempt;
  useEffect(() => {
    function unload(e: BeforeUnloadEvent) {
      if (busy || state.attempt) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [busy, state.attempt]);
  async function send(request: EncounterRequest) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setState({ scope, attempt: request, message: 'Saving encounter change…' });
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      /* Optional. */
    }
    let result: Record<string, string> | undefined;
    try {
      result = await run('encounter', request);
    } catch {
      /* Uncertain; retain exact operation. */
    }
    const confirmed = !!result?.id && typeof result.revision === 'string';
    if (confirmed) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional. */
      }
    }
    lock.current = false;
    if (active.current) {
      setBusy(false);
    }
    if (active.current && currentScope.current === scope) {
      setState(
        confirmed
          ? { scope, message: 'Encounter change confirmed.' }
          : {
              scope,
              attempt: request,
              message:
                'Encounter change failed or unconfirmed. Retry cannot apply it twice. If stale, dismiss and review the refreshed tracker.',
            },
      );
    }
    return confirmed;
  }
  return {
    blocked,
    busy,
    message: ready ? state.message : 'Loading encounter controls…',
    uncertain: ready && !!state.attempt && !busy,
    commit: async (payload: Record<string, unknown>) => {
      if (blocked || lock.current) return false;
      const parsed = encounterCommandSchema.safeParse({
        ...payload,
        operation_id: crypto.randomUUID(),
      });
      if (!parsed.success) {
        setState({ scope, message: parsed.error.issues[0].message });
        return false;
      }
      return send(parsed.data);
    },
    retry: () => (ready && state.attempt && !busy ? send(state.attempt) : Promise.resolve(false)),
    dismiss: async () => {
      if (
        lock.current ||
        !window.confirm(
          'Dismiss this unconfirmed change? It may already have committed. Dismissing does not reverse it; review the tracker before making another change.',
        )
      )
        return;
      lock.current = true;
      setBusy(true);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional. */
      }
      try {
        await refresh();
      } catch {
        /* Existing room feedback reports failed reconciliation. */
      }
      lock.current = false;
      if (active.current) setBusy(false);
      if (active.current && currentScope.current === scope)
        setState({
          scope,
          message: 'Attempt dismissed. Review the current tracker before continuing.',
        });
    },
  };
}
