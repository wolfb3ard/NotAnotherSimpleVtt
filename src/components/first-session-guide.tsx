'use client';
import { useEffect, useState } from 'react';
import { firstSessionSteps, type GuideStep } from '@/lib/onboarding';
import type { Snapshot } from '@/lib/types';

export function FirstSessionGuide({
  snapshot,
  onGo,
}: {
  snapshot: Snapshot;
  onGo: (action: GuideStep['action']) => void;
}) {
  const key = `vtt-guide:${snapshot.userId}:${snapshot.game.id}:${snapshot.role}`;
  const [dismissed, setDismissed] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let hidden = false;
    try {
      hidden = window.localStorage.getItem(key) === 'dismissed';
    } catch {
      /* Optional. */
    }
    queueMicrotask(() => {
      if (!cancelled) setDismissed(hidden ? key : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  function hide(hidden: boolean) {
    setDismissed(hidden ? key : undefined);
    try {
      if (hidden) window.localStorage.setItem(key, 'dismissed');
      else window.localStorage.removeItem(key);
    } catch {
      /* Optional. */
    }
  }
  const steps = firstSessionSteps(snapshot);
  if (dismissed === key)
    return <button onClick={() => hide(false)}>Resume first-session guide</button>;
  return (
    <section className="card stack" aria-label="First-session guide">
      <div className="row">
        <strong>{snapshot.role === 'gm' ? 'Prepare your first session' : 'Ready to play'}</strong>
        <button onClick={() => hide(true)}>Dismiss guide</button>
      </div>
      <p className="small muted">
        {steps.filter((s) => s.done).length}/{steps.length} ready · Updates from campaign state.
        Optional steps may be skipped; resume anytime.
      </p>
      <ol className="stack">
        {steps.map((s) => (
          <li key={s.id}>
            <span aria-label={s.done ? 'Complete' : 'Not yet complete'}>{s.done ? '✓' : '○'}</span>{' '}
            <button onClick={() => onGo(s.action)}>{s.label}</button>
          </li>
        ))}
      </ol>
      {snapshot.role === 'player' && (
        <p className="small muted">
          Names never grant ownership. Tell the GM which existing character you want; only the GM
          can assign it. If your token is absent, elsewhere, or concealed, ask the GM to bring it
          into the revealed active scene.
        </p>
      )}
    </section>
  );
}
