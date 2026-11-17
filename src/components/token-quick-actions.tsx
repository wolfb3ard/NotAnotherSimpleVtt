'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Actor, Sheet, Snapshot, Token } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { QuickResources } from './quick-resources';
import { CreatureAdder } from './creature-adder';
import { CombatControls } from './combat-controls';

export function TokenQuickActions({
  token,
  actor,
  snapshot,
  anchor,
  blocked,
  busy,
  run,
  onBusyChange,
  onCommitted,
  onClose,
  onSheet,
  onRoll,
}: {
  token: Token;
  actor?: Actor;
  snapshot: Snapshot;
  anchor: { x: number; y: number };
  blocked: boolean;
  busy: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onBusyChange: (busy: boolean) => void;
  onCommitted: (sheet: Sheet, revision: number, name?: string) => void;
  onClose: () => void;
  onSheet: () => void;
  onRoll?: (roll: { actorId: string; expression: string; rollType: string }) => Promise<void>;
}) {
  const title = useId();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState(anchor);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [combatBusy, setCombatBusy] = useState(false);
  useEffect(
    () => onBusyChange(resourceBusy || combatBusy),
    [resourceBusy, combatBusy, onBusyChange],
  );
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const editable =
    !!actor &&
    (snapshot.role === 'gm' ||
      actor.owner_id === snapshot.userId ||
      snapshot.grants.some(
        (g) => g.actor_id === actor.id && g.user_id === snapshot.userId && g.can_edit,
      ));
  function move(x: number, y: number) {
    const rect = frame.current?.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width ?? 320) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (rect?.height ?? 420) - 8)),
    });
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frame.current?.focus();
    // Clamp the requested pointer anchor after measuring the actual card.
    const rect = frame.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)),
      });
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [anchor.x, anchor.y]);
  useEffect(() => {
    function resize() {
      const rect = frame.current?.getBoundingClientRect();
      if (rect)
        setPosition((current) => ({
          x: Math.max(8, Math.min(current.x, window.innerWidth - rect.width - 8)),
          y: Math.max(8, Math.min(current.y, window.innerHeight - rect.height - 8)),
        }));
    }
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    if (frame.current) observer?.observe(frame.current);
    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) {
      if (busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [busy]);
  return (
    <div
      ref={frame}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title}
      className="token-actions-window"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="token-actions-header">
        <div
          tabIndex={0}
          className="token-actions-handle"
          aria-label="Move quick actions window"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const rect = frame.current!.getBoundingClientRect();
            drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current)
              move(
                drag.current.left + e.clientX - drag.current.x,
                drag.current.top + e.clientY - drag.current.y,
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            const delta = {
              ArrowLeft: [-20, 0],
              ArrowRight: [20, 0],
              ArrowUp: [0, -20],
              ArrowDown: [0, 20],
            }[e.key];
            if (delta) {
              e.preventDefault();
              move(position.x + delta[0], position.y + delta[1]);
            }
          }}
        >
          <span className="eyebrow">QUICK ACTIONS</span>
          <h2 id={title}>{token.label} quick actions</h2>
        </div>
        <button aria-label="Close quick actions" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="token-actions-body stack">
        {actor ? (
          <>
            <button onClick={onSheet}>Open character sheet</button>
            {snapshot.role === 'gm' && actor.kind !== 'character' && (
              <details>
                <summary>Duplicate as independent creature</summary>
                <p className="small">
                  {actor.encounter_instance
                    ? 'Independent encounter creature.'
                    : 'Definition / legacy linked actor.'}{' '}
                  Copies current sheet state, not sheet grants. Existing tokens remain unchanged.
                </p>
                <CreatureAdder
                  key={`${token.scene_id}:${actor.id}`}
                  gameId={snapshot.game.id}
                  sceneId={token.scene_id}
                  source={{ kind: 'actor', actor_id: actor.id, revision: actor.revision }}
                  disabled={blocked || busy}
                  run={run}
                  label="Duplicate as independent creature"
                />
              </details>
            )}
            {!editable && (
              <p className="small">Read only. Token control does not grant sheet editing.</p>
            )}
            <QuickResources
              key={actor.id}
              actor={actor}
              editable={editable}
              blocked={blocked || combatBusy}
              run={run}
              onBusyChange={setResourceBusy}
              onCommitted={onCommitted}
            />
            <CombatControls
              key={`combat:${actor.id}`}
              actor={actor}
              snapshot={snapshot}
              editable={editable}
              blocked={blocked || resourceBusy}
              run={run}
              onBusyChange={setCombatBusy}
              onRoll={onRoll}
            />
            {!actor.sheet.sections.some((s) => s.fields.some((f) => f.kind === 'resource')) &&
              !actor.sheet.character?.features.some((f) => f.maxUses > 0) && (
                <p className="small">
                  No resources configured. Add counters in the character sheet.
                </p>
              )}
          </>
        ) : (
          <p>No sheet access. Ask the GM for access to use this token’s resources.</p>
        )}
      </div>
    </div>
  );
}
