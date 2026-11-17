'use client';
import { useEffect, useRef, useState } from 'react';
import { commandSchemas, type Command } from '@/lib/commands';
import type { z } from 'zod';

type Request = z.infer<typeof commandSchemas.token_place>;
type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
export function usePlacement(scope: string, run: Run) {
  const key = `vtt-placement:${scope}`;
  const [state, setState] = useState<{ scope: string; attempt?: Request; message: string }>({
    scope: '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const unconfirmed = useRef<Request | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let attempt: Request | undefined;
    try {
      const raw = sessionStorage.getItem(key);
      const parsed = raw && commandSchemas.token_place.safeParse(JSON.parse(raw));
      if (parsed && parsed.success) attempt = parsed.data;
    } catch {
      /* Storage is optional. */
    }
    unconfirmed.current = attempt;
    queueMicrotask(() => {
      if (generation.current === current)
        setState({
          scope,
          attempt,
          message: attempt ? 'Placement unconfirmed. Retry the same request.' : '',
        });
    });
    return () => {
      generation.current = current + 1;
    };
  }, [key, scope]);
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
  const ready = state.scope === scope;
  const blocked = !ready || busy || !!state.attempt;
  async function send(request: Request) {
    if (lock.current) return false;
    lock.current = true;
    unconfirmed.current = request;
    const current = generation.current;
    setBusy(true);
    setState({ scope, attempt: request, message: 'Placing token…' });
    try {
      sessionStorage.setItem(key, JSON.stringify(request));
    } catch {
      /* Optional. */
    }
    let confirmed = false;
    try {
      confirmed = (await run('token_place', request))?.confirmed === 'true';
    } catch {
      /* Retain exact retry. */
    }
    if (confirmed) {
      if (generation.current === current) unconfirmed.current = undefined;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional. */
      }
    }
    lock.current = false;
    if (generation.current === current) {
      setBusy(false);
      setState(
        confirmed
          ? { scope, message: 'Placement confirmed.' }
          : {
              scope,
              attempt: request,
              message:
                'Placement failed or unconfirmed. Retry cannot create a second token. If stale, dismiss and choose again.',
            },
      );
    }
    return confirmed;
  }
  return {
    blocked,
    busy,
    message: ready ? state.message : '',
    uncertain: ready && !!state.attempt && !busy,
    commit: (payload: Omit<Request, 'operation_id'>) => {
      if (blocked || lock.current || unconfirmed.current) return Promise.resolve(false);
      const parsed = commandSchemas.token_place.safeParse({
        ...payload,
        operation_id: crypto.randomUUID(),
      });
      if (!parsed.success) {
        setState({ scope, message: parsed.error.issues[0].message });
        return Promise.resolve(false);
      }
      return send(parsed.data);
    },
    retry: () => (ready && state.attempt && !busy ? send(state.attempt) : Promise.resolve(false)),
    dismiss: () => {
      if (
        lock.current ||
        !window.confirm(
          'Dismiss this attempt? It may already have committed. This does not remove any token; review the map before placing again.',
        )
      )
        return;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional. */
      }
      unconfirmed.current = undefined;
      setState({ scope, message: 'Attempt dismissed. Review the map before placing again.' });
    },
  };
}
