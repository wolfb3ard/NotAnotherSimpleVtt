'use client';

import { useEffect, useRef } from 'react';
import { SheetEditor } from './sheet-editor';
import { FloatingWindow } from './floating-window';
import type { Geometry } from '@/lib/window-layout';
import type { Actor, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';

export function SheetWindow({
  audience,
  actor,
  snapshot,
  run,
  onRoll,
  onClose,
  error,
  onDirtyChange,
  initialBuilderOpen,
  externalBusy,
  saved,
  onSave,
}: {
  actor: Actor;
  audience?: React.ReactNode;
  snapshot: Snapshot;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onRoll: (actorId: string, expression: string, rollType?: string) => void;
  onClose: () => void;
  error?: string;
  onDirtyChange?: (dirty: boolean) => void;
  initialBuilderOpen?: boolean;
  externalBusy?: boolean;
  saved?: Geometry;
  onSave?: (value: Geometry) => void;
}) {
  const dirtyRef = useRef(false);
  function requestClose() {
    if (!dirtyRef.current || window.confirm('Discard unsaved character sheet changes?')) onClose();
  }
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  return (
    <FloatingWindow
      kind="sheet"
      heading={actor.name}
      onClose={requestClose}
      saved={saved}
      onSave={onSave}
    >
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {audience}
      {actor.sheetUpgradeIssue ? (
        <div className="notice stack" role="alert">
          <p>This saved sheet needs review before editing. The original has not been changed.</p>
          <p>{actor.sheetUpgradeIssue}</p>
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(actor.sheet, null, 2)], { type: 'application/json' }),
              );
              const download = document.createElement('a');
              download.href = url;
              download.download = `sheet-${actor.id}.json`;
              download.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download original sheet
          </button>
        </div>
      ) : (
        <SheetEditor
          actor={actor}
          snapshot={snapshot}
          run={run}
          onDirtyChange={(dirty) => {
            dirtyRef.current = dirty;
            onDirtyChange?.(dirty);
          }}
          onRoll={onRoll}
          initialBuilderOpen={initialBuilderOpen}
          externalBusy={externalBusy}
        />
      )}
    </FloatingWindow>
  );
}
