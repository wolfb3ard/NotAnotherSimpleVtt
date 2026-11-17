'use client';
import { useEffect, useState } from 'react';
import { clampView, type View } from '@/lib/navigation';

export function useMapView(
  scope: string,
  scene: { width: number; height: number } | undefined,
  dimensions: { width: number; height: number },
) {
  const key = `vtt-viewport:v1:${scope}`;
  const [state, setState] = useState<{ key: string; view: View }>({
    key: '',
    view: { x: 50, y: 50, scale: 1 },
  });
  useEffect(() => {
    let active = true;
    let view: View = { x: 50, y: 50, scale: 1 };
    try {
      const raw = localStorage.getItem(key);
      const saved = raw && JSON.parse(raw);
      if (
        saved &&
        ['x', 'y', 'scale'].every((k) => typeof saved[k] === 'number' && Number.isFinite(saved[k]))
      )
        view = saved;
    } catch {
      /* Browser-local persistence is optional. */
    }
    queueMicrotask(() => {
      if (active) setState({ key, view });
    });
    return () => {
      active = false;
    };
  }, [key]);
  const current = state.key === key ? state.view : { x: 50, y: 50, scale: 1 };
  const view = scene ? clampView(current, scene, dimensions) : current;
  function update(next: View) {
    const safe = scene ? clampView(next, scene, dimensions) : next;
    setState({ key, view: safe });
    try {
      localStorage.setItem(key, JSON.stringify(safe));
    } catch {
      /* Optional. */
    }
  }
  return { view, update };
}
