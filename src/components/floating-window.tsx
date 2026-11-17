'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';
import { fitWindow, type Geometry, type WindowKind } from '@/lib/window-layout';

export function FloatingWindow({
  kind,
  heading,
  children,
  saved,
  onSave,
  onClose,
}: {
  kind: WindowKind;
  heading: string;
  children: ReactNode;
  saved?: Geometry;
  onSave?: (value: Geometry) => void;
  onClose: () => void;
}) {
  const title = useId();
  const frame = useRef<HTMLDivElement>(null);
  const sheet = kind === 'sheet';
  const name = sheet ? 'character sheet window' : 'roll window';
  const [viewport, setViewport] = useState([1024, 768]);
  const [local, setLocal] = useState<Geometry>();
  const [preview, setPreview] = useState<Geometry>();
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    start: Geometry;
    resize: boolean;
    id: number;
  } | null>(null);
  useLayoutEffect(() => {
    const update = () => setViewport([window.innerWidth, window.innerHeight]);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frame.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const fit = (g?: Geometry) => fitWindow(kind, viewport[0], viewport[1], g);
  const box = fit(preview ?? (onSave ? saved : local));
  const commit = onSave ?? setLocal;
  function adjust(start: Geometry, dx: number, dy: number, resize: boolean) {
    return fit(
      resize
        ? { ...start, width: start.width + dx, height: start.height + dy }
        : { ...start, left: start.left + dx, top: start.top + dy },
    );
  }
  function handle(resize: boolean) {
    function delta(e: PointerEvent) {
      const d = drag;
      if (d?.id === e.pointerId) return adjust(d.start, e.clientX - d.x, e.clientY - d.y, d.resize);
    }
    return {
      tabIndex: box.maximized ? -1 : 0,
      role: 'group',
      'aria-label': `${resize ? 'Resize' : 'Move'} ${name}`,
      title: `${resize ? 'Resize' : 'Move'} with drag or arrow keys`,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (box.maximized || e.button !== 0 || drag) return;
        setDrag({ x: e.clientX, y: e.clientY, start: box, resize, id: e.pointerId });
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: PointerEvent) => {
        const g = delta(e);
        if (g) setPreview(g);
      },
      onPointerUp: (e: PointerEvent) => {
        const g = delta(e);
        if (g) {
          commit(g);
          setDrag(null);
          setPreview(undefined);
        }
      },
      onLostPointerCapture: () => {
        setDrag(null);
        setPreview(undefined);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        const d = {
          ArrowLeft: [-20, 0],
          ArrowRight: [20, 0],
          ArrowUp: [0, -20],
          ArrowDown: [0, 20],
        }[e.key];
        if (d && !box.maximized) {
          e.preventDefault();
          e.stopPropagation();
          commit(adjust(box, d[0], d[1], resize));
        }
      },
    };
  }
  const { left, top, width, height, maximized } = box;
  return (
    <div
      ref={frame}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title}
      tabIndex={-1}
      className={`sheet-window ${sheet ? '' : 'roll-window'} ${maximized ? 'is-maximized' : ''}`}
      style={maximized ? undefined : { left, top, width, height }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="sheet-window-header">
        <div className="sheet-window-handle" {...handle(false)}>
          {sheet && <span className="eyebrow">CHARACTER SHEET</span>}
          <h2 id={title}>{heading}</h2>
        </div>
        <button
          aria-label={`${maximized ? 'Restore' : 'Maximize'} ${kind} window`}
          onClick={() => commit({ ...box, maximized: !maximized })}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button aria-label={sheet ? 'Close character sheet' : 'Dock roll window'} onClick={onClose}>
          {sheet ? '×' : '↙'}
        </button>
      </header>
      <div className="sheet-window-body">{children}</div>
      {!maximized && (
        <div className="window-resize" {...handle(true)}>
          ↘ Resize
        </div>
      )}
    </div>
  );
}
