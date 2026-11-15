'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SheetEditor } from './sheet-editor';
import type { Actor, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';

export function SheetWindow({
  actor,
  snapshot,
  run,
  onRoll,
  onClose,
  error,
  onDirtyChange,
}: {
  actor: Actor;
  snapshot: Snapshot;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onRoll: (actorId: string, expression: string) => void;
  onClose: () => void;
  error?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const title = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const dirtyRef = useRef(false);
  const [maximized, setMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 65 });
  function requestClose() {
    if (!dirtyRef.current || window.confirm('Discard unsaved character sheet changes?')) onClose();
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frameRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
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
  function move(x: number, y: number) {
    const rect = frameRef.current?.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width ?? 300) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - 80)),
    });
  }
  return (
    <div
      ref={frameRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title}
      tabIndex={-1}
      className={`sheet-window ${maximized ? 'is-maximized' : ''}`}
      style={maximized ? undefined : { left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          requestClose();
        }
      }}
    >
      <header className="sheet-window-header">
        <div
          className="sheet-window-handle"
          tabIndex={0}
          aria-label="Move character sheet window"
          onPointerDown={(e) => {
            if (maximized || e.button !== 0) return;
            const rect = frameRef.current!.getBoundingClientRect();
            dragRef.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const start = dragRef.current;
            if (start) move(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
          onKeyDown={(e) => {
            const delta = {
              ArrowLeft: [-20, 0],
              ArrowRight: [20, 0],
              ArrowUp: [0, -20],
              ArrowDown: [0, 20],
            }[e.key];
            if (delta && !maximized) {
              e.preventDefault();
              move(position.x + delta[0], position.y + delta[1]);
            }
          }}
        >
          <span className="eyebrow">CHARACTER SHEET</span>
          <h2 id={title}>{actor.name}</h2>
        </div>
        <button
          aria-label={maximized ? 'Restore sheet window' : 'Maximize sheet window'}
          onClick={() => setMaximized(!maximized)}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button aria-label="Close character sheet" onClick={requestClose}>
          ×
        </button>
      </header>
      <div className="sheet-window-body">
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <SheetEditor
          actor={actor}
          snapshot={snapshot}
          run={run}
          onDirtyChange={(dirty) => {
            dirtyRef.current = dirty;
            onDirtyChange?.(dirty);
          }}
          onRoll={onRoll}
        />
      </div>
    </div>
  );
}
