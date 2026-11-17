'use client';
import { useEffect, useRef, useState } from 'react';
import type { AttentionSignal } from '@/lib/attention';
import type { Scene, Snapshot } from '@/lib/types';
import type { RoomAttention } from './use-room-attention';

export function SharedAttention({
  attention,
  snapshot,
  scene,
  preview,
  center,
  selectMode,
}: {
  attention: RoomAttention;
  snapshot: Snapshot;
  scene: Scene;
  preview: boolean;
  center: (point: { x: number; y: number }) => void;
  selectMode: (mode: 'ping' | 'camera') => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [x, setX] = useState('0'),
    [y, setY] = useState('0');
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const latest = useRef({ preview, scene, center });
  useEffect(() => {
    latest.current = { preview, scene, center };
  }, [preview, scene, center]);
  const decision = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const signals = preview ? [] : attention.signals;
  const request = signals.find(
    (s) => s.kind === 'camera' && s.user_id !== snapshot.userId && !dismissed.includes(s.id),
  );
  const name = (s: AttentionSignal) =>
    snapshot.members.find((m) => m.user_id === s.user_id)?.display_name ?? 'Member';
  const invalid =
    !x ||
    !y ||
    !Number.isFinite(Number(x)) ||
    !Number.isFinite(Number(y)) ||
    Number(x) < 0 ||
    Number(y) < 0 ||
    Number(x) >= scene.width ||
    Number(y) >= scene.height;
  const disabled = preview || !attention.online || attention.sending;
  async function follow(s: AttentionSignal) {
    setChecking(true);
    const version = ++decision.current;
    const verified = await attention.verify(s.id);
    if (!active.current) return;
    if (version !== decision.current) {
      setChecking(false);
      return;
    }
    if (
      verified &&
      verified.scene_id === latest.current.scene.id &&
      verified.scene_revision === latest.current.scene.revision &&
      !latest.current.preview
    )
      latest.current.center(verified);
    else setNotice('Camera request expired, unavailable, or could not be confirmed.');
    setDismissed((ids) => [...ids.slice(-50), s.id]);
    setChecking(false);
  }
  return (
    <>
      <div className="shared-attention-tools">
        <button disabled={disabled} onClick={() => selectMode('ping')}>
          Ping map
        </button>
        {snapshot.role === 'gm' && (
          <button disabled={disabled} onClick={() => selectMode('camera')}>
            Bring everyone here
          </button>
        )}
        <details>
          <summary>Attention coordinates &amp; policy</summary>
          <p>
            Choose revealed map space. Pings last 8 seconds; GM camera requests last 20. Players
            explicitly Follow or Decline each request; no automatic scene switch or zoom. Static,
            labelled markers never flash or animate.
          </p>
          <label>
            Map X{' '}
            <input
              aria-label="Attention X"
              type="number"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          </label>
          <label>
            Map Y{' '}
            <input
              aria-label="Attention Y"
              type="number"
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
          </label>
          <button
            disabled={disabled || invalid}
            onClick={() => void attention.send('ping', { x: Number(x), y: Number(y) }, scene)}
          >
            Ping coordinates
          </button>
          {snapshot.role === 'gm' && (
            <button
              disabled={disabled || invalid}
              onClick={() => void attention.send('camera', { x: Number(x), y: Number(y) }, scene)}
            >
              Request camera at coordinates
            </button>
          )}
        </details>
        <div role="status">
          {attention.message}
          {notice}
        </div>
        <div aria-live="polite" aria-atomic="true">
          {signals
            .filter((s) => s.kind === 'ping')
            .map((s) => (
              <p key={s.id}>
                {name(s)} pinged map {Math.round(s.x)}, {Math.round(s.y)}.
              </p>
            ))}
        </div>
        {request && (
          <div role="group" aria-label="GM camera request">
            <span>{name(request)} asks everyone to look here.</span>
            <button disabled={checking || preview} onClick={() => void follow(request)}>
              Follow camera request
            </button>
            <button
              onClick={() => {
                decision.current++;
                setDismissed((ids) => [...ids.slice(-50), request.id]);
              }}
            >
              Decline camera request
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function AttentionMarkers({
  signals,
  snapshot,
  view,
}: {
  signals: AttentionSignal[];
  snapshot: Snapshot;
  view: { x: number; y: number; scale: number };
}) {
  return signals.map((s) => {
    const name = snapshot.members.find((m) => m.user_id === s.user_id)?.display_name ?? 'Member';
    return (
      <span
        key={s.id}
        className="attention-marker"
        role="img"
        aria-label={`${name} ${s.kind === 'ping' ? 'ping' : 'camera target'} at map ${Math.round(s.x)}, ${Math.round(s.y)}`}
        style={{ left: view.x + s.x * view.scale, top: view.y + s.y * view.scale }}
      >
        ⊕{' '}
        <span>
          {name} · {s.kind === 'ping' ? 'Ping' : 'Look here'}
        </span>
      </span>
    );
  });
}
