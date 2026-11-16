'use client';
import type { Actor } from '@/lib/types';
import { TokenPortrait } from './token-portrait';

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
      <TokenPortrait name={actor.name} assetId={actor.token_asset_id} ring={actor.token_ring} />
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
