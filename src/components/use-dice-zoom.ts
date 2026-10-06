'use client';
import { useSyncExternalStore } from 'react';
import { getDiceZoom, setDiceZoom, subscribeDiceZoom } from '@/lib/dice-zoom';

export function useDiceZoom() {
  const zoom = useSyncExternalStore(subscribeDiceZoom, getDiceZoom, () => 1);
  return [zoom, setDiceZoom] as const;
}
