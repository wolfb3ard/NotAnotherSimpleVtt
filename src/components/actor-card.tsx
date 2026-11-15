'use client';
import type { Actor } from '@/lib/types';

export function ActorCard({
  actor,
  ownerName,
  onOpen,
}: {
  actor: Actor;
  ownerName?: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="actor-card"
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${actor.name} character sheet`}
      aria-haspopup="dialog"
      title="Double-click to open character sheet"
    >
      <span className={`avatar ${actor.kind}`}>{actor.name.slice(0, 2).toUpperCase()}</span>
      <span>
        <strong>{actor.name}</strong>
        <small>
          {actor.kind} · {ownerName ?? 'Unknown owner'}
        </small>
      </span>
      <span className="arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}
