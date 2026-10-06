export const diceZoomKey = 'vtt-dice-zoom';
export const diceZoomEvent = 'vtt-dice-zoom-change';
export const baseDiceZoom = 64;

export function normalizeDiceZoom(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(2, value)) : 1;
}

let cachedZoom: number | undefined;

export function getDiceZoom() {
  if (cachedZoom !== undefined) return cachedZoom;
  try {
    cachedZoom = normalizeDiceZoom(Number(window.localStorage.getItem(diceZoomKey)));
  } catch {
    cachedZoom = 1;
  }
  return cachedZoom;
}

export function setDiceZoom(value: number) {
  cachedZoom = normalizeDiceZoom(value);
  try {
    window.localStorage.setItem(diceZoomKey, String(cachedZoom));
  } catch {
    // Keep the control usable even when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(diceZoomEvent));
}

export function subscribeDiceZoom(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== diceZoomKey && event.key !== null) return;
    cachedZoom = undefined;
    onChange();
  };
  window.addEventListener(diceZoomEvent, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(diceZoomEvent, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
