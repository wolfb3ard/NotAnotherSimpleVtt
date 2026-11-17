'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { Geometry } from '@/lib/window-layout';
import { FloatingWindow } from './floating-window';

export function RollWindow({
  detached,
  onDock,
  saved,
  onSave,
  children,
}: {
  detached: boolean;
  onDock: () => void;
  saved?: Geometry;
  onSave: (value: Geometry) => void;
  children: ReactNode;
}) {
  const wasDetached = useRef(false);
  useEffect(() => {
    if (!detached && wasDetached.current)
      document.querySelector<HTMLButtonElement>('[aria-label="Pop out roll window"]')?.focus();
    wasDetached.current = detached;
  }, [detached]);
  if (!detached) return children;
  return (
    <FloatingWindow kind="roll" heading="Rolls" onClose={onDock} saved={saved} onSave={onSave}>
      {children}
    </FloatingWindow>
  );
}
