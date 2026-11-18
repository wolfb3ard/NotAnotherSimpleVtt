'use client';

import { useEffect, useRef, useState } from 'react';
import type { Command } from '@/lib/commands';

type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
type Entry = { id: string; description: string };
type Attempt = {
  command: 'tabletop_move' | 'tabletop_move_group' | 'tabletop_fog' | 'tabletop_undo';
  payload: Record<string, unknown>;
};
type State = { scope: string; history: Entry[]; attempt?: Attempt; message: string };

export function isUndoShortcut(event: KeyboardEvent) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    event.key.toLowerCase() === 'z' &&
    !(
      event.target instanceof Element &&
      event.target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
      )
    )
  );
}

/** Confirmed server history only; persist uncertain attempts for exact retries. */
export function useTabletopEdits(scope: string, sceneId: string | undefined, run: Run) {
  const [state, setState] = useState<State>({ scope: '', history: [], message: '' });
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const currentScope = useRef(scope);
  const runner = useRef(run);
  useEffect(() => {
    currentScope.current = scope;
    runner.current = run;
  });
  const storageKey = `vtt-tabletop-attempt:${scope}`;
  useEffect(() => {
    let active = true;
    async function load() {
      const version = generation.current;
      let attempt: Attempt | undefined;
      try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) attempt = JSON.parse(stored);
      } catch {
        /* Optional storage. */
      }
      let result: Record<string, string> | undefined;
      try {
        result = sceneId
          ? await runner.current('tabletop_history', { scene_id: sceneId })
          : { history: '[]' };
      } catch {
        /* Reconnect/focus can retry history reads. */
      }
      if (active && version === generation.current)
        setState({
          scope,
          history: result ? JSON.parse(result.history) : [],
          attempt,
          message: attempt
            ? 'Change unconfirmed. Retry the same operation to check its result.'
            : result
              ? ''
              : 'Undo history unavailable. Reconnect or refocus the window to retry.',
        });
    }
    void load();
    function foreground() {
      if (!locked.current && document.visibilityState !== 'hidden') void load();
    }
    window.addEventListener('online', foreground);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      active = false;
      window.removeEventListener('online', foreground);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [scope, sceneId, storageKey]);

  const ready = state.scope === scope;
  const blocked = !ready || busy || !!state.attempt;
  async function send(attempt: Attempt, retrying = false) {
    if (locked.current) return false;
    locked.current = true;
    generation.current++;
    setBusy(true);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
      /* Optional storage. */
    }
    setState((s) => ({ ...s, scope, attempt, message: 'Saving tabletop change…' }));
    let result: Record<string, string> | undefined;
    try {
      result = await runner.current(attempt.command, attempt.payload);
    } catch {
      /* Unconfirmed. */
    }
    locked.current = false;
    setBusy(false);
    const history = result?.history;
    const rejection = !retrying && result?.rejected;
    if (history !== undefined || rejection) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional storage. */
      }
    }
    if (currentScope.current === scope)
      setState((s) =>
        history !== undefined
          ? { scope, history: JSON.parse(history), message: 'Tabletop change confirmed.' }
          : rejection
            ? { ...s, attempt: undefined, message: rejection }
            : {
                ...s,
                attempt,
                message:
                  'Change failed or unconfirmed. Retry checks the same operation; it will not apply twice. Later changes or lost permission can block undo.',
              },
      );
    return history !== undefined;
  }
  async function commit(command: Attempt['command'], payload: Record<string, unknown>) {
    if (blocked || locked.current || !sceneId) return false;
    return send({
      command,
      payload: { ...payload, scene_id: sceneId, operation_id: crypto.randomUUID() },
    });
  }
  async function undo() {
    const entry = state.history[0];
    if (blocked || !entry || !sceneId) return;
    await send({
      command: 'tabletop_undo',
      payload: { scene_id: sceneId, operation_id: entry.id },
    });
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!event.defaultPrevented && isUndoShortcut(event) && !blocked && state.history.length) {
        event.preventDefault();
        void undo();
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  async function dismiss() {
    if (
      locked.current ||
      !window.confirm(
        'Stop retrying this attempt? It may already have committed. Dismissing does not reverse a change.',
      )
    )
      return;
    locked.current = true;
    generation.current++;
    setBusy(true);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Optional storage. */
    }
    let result: Record<string, string> | undefined;
    try {
      result = await runner.current('tabletop_history', { scene_id: sceneId });
    } catch {
      /* History can be reconciled on reconnect. */
    }
    locked.current = false;
    setBusy(false);
    if (currentScope.current === scope)
      setState({
        scope,
        history: result ? JSON.parse(result.history) : [],
        message: result
          ? 'Attempt dismissed. Check the tabletop before editing again.'
          : 'Attempt dismissed; history unavailable. Reconnect or refocus to reconcile.',
      });
  }
  return {
    blocked,
    busy,
    entry: ready ? state.history[0] : undefined,
    message: ready ? state.message : 'Loading undo history…',
    uncertain: ready && !!state.attempt && !busy,
    commit,
    undo,
    retry: () => state.attempt && send(state.attempt, true),
    dismiss,
  };
}
