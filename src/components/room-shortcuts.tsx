'use client';

import { useId } from 'react';
import type { Actor } from '@/lib/types';

export function RoomShortcuts({
  actors,
  userId,
  gm,
  visibility,
  onOpen,
  onParty,
  onVisibilityChange,
}: {
  actors: Actor[];
  userId: string;
  gm: boolean;
  visibility: 'public' | 'private';
  onOpen: (actorId: string) => void;
  onParty: () => void;
  onVisibilityChange: (visibility: 'public' | 'private') => void;
}) {
  const audienceId = useId();
  const emptyId = useId();
  const characters = actors.filter(
    (actor) => actor.owner_id === userId && actor.kind === 'character',
  );
  return (
    <nav className="room-shortcuts" aria-label="Play shortcuts">
      <div className="character-shortcut">
        {characters.length === 1 ? (
          <button aria-label="My character" onClick={() => onOpen(characters[0].id)}>
            My character · {characters[0].name}
          </button>
        ) : characters.length > 1 ? (
          <label>
            My character
            <select
              aria-label="My character"
              value=""
              onChange={(event) => {
                if (event.target.value) onOpen(event.target.value);
              }}
            >
              <option value="">Choose character…</option>
              {characters.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <button aria-describedby={emptyId} onClick={onParty}>
              My characters
            </button>
            <span id={emptyId} className="small muted">
              Create a character in Party or ask the GM to assign one.
            </span>
          </>
        )}
      </div>
      <label className="quick-roll-visibility">
        Roll visibility
        <select
          aria-label="Quick roll visibility"
          aria-describedby={audienceId}
          value={visibility}
          onChange={(event) => onVisibilityChange(event.target.value as 'public' | 'private')}
        >
          <option value="public">Everyone</option>
          <option value="private">{gm ? 'Only me' : 'Me and GM'}</option>
        </select>
        <span id={audienceId} className="small muted" role="status">
          {visibility === 'public'
            ? 'Everyone at the table can see your rolls.'
            : gm
              ? 'Only you can see your rolls.'
              : 'Only you and the GM can see your rolls.'}
        </span>
      </label>
    </nav>
  );
}
