'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** An in-tabletop window, not a separate browser window or a second dice session. */
export function RollWindow({
  detached,
  onDock,
  children,
}: {
  detached: boolean;
  onDock: () => void;
  children: ReactNode;
}) {
  const title = useId();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const wasDetached = useRef(false);
  const [position, setPosition] = useState({ x: 40, y: 80 });
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (detached) frame.current?.focus();
    else if (wasDetached.current)
      document.querySelector<HTMLButtonElement>('[aria-label="Pop out roll window"]')?.focus();
    wasDetached.current = detached;
  }, [detached]);
  function move(x: number, y: number) {
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - (frame.current?.offsetWidth ?? 360) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - 80)),
    });
  }
  if (!detached) return children;
  return (
    <div
      ref={frame}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title}
      tabIndex={-1}
      className={`sheet-window roll-window ${maximized ? 'is-maximized' : ''}`}
      style={maximized ? undefined : { left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDock();
        }
      }}
    >
      <header className="sheet-window-header">
        <div
          className="sheet-window-handle"
          tabIndex={0}
          aria-label="Move roll window"
          onPointerDown={(e) => {
            if (maximized || e.button !== 0) return;
            const rect = frame.current!.getBoundingClientRect();
            drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (start) move(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
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
            if (delta && !maximized) {
              e.preventDefault();
              move(position.x + delta[0], position.y + delta[1]);
            }
          }}
        >
          <h2 id={title}>Rolls</h2>
        </div>
        <button
          aria-label={maximized ? 'Restore roll window' : 'Maximize roll window'}
          onClick={() => setMaximized(!maximized)}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button onClick={onDock} aria-label="Dock roll window">
          ↙
        </button>
      </header>
      <div className="sheet-window-body">{children}</div>
    </div>
  );
}
