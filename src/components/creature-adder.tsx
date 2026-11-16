'use client';

import { useEffect, useRef, useState } from 'react';
import { commandSchemas, type Command } from '@/lib/commands';

type Request = ReturnType<typeof commandSchemas.creature_add.parse>;
export function CreatureAdder({
  gameId,
  sceneId,
  source,
  run,
  label = 'Add creatures',
  disabled = false,
}: {
  gameId: string;
  sceneId: string;
  source: Request['source'];
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  label?: string;
  disabled?: boolean;
}) {
  const sourceId = source.kind === 'srd' ? source.monster_id : source.actor_id;
  const sourceKind = source.kind;
  const key = `vtt:creatures:${gameId}:${sceneId}:${sourceKind}:${sourceId}`;
  const [count, setCount] = useState(1);
  const [attempt, setAttempt] = useState<Request>();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
          const parsed = commandSchemas.creature_add.safeParse(JSON.parse(stored));
          if (
            parsed.success &&
            parsed.data.scene_id === sceneId &&
            parsed.data.source.kind === sourceKind &&
            (parsed.data.source.kind === 'srd'
              ? parsed.data.source.monster_id
              : parsed.data.source.actor_id) === sourceId
          ) {
            setAttempt(parsed.data);
            setCount(parsed.data.count);
            setFeedback(
              'Previous creation is unconfirmed. Retry to acknowledge it without adding another group.',
            );
          }
        }
      } catch {
        /* Storage may be disabled. In-memory retry remains available. */
      }
    });
    return () => {
      cancelled = true;
    };
    // Parent keys this component by scene/source so attempts never cross targets.
  }, [key, sceneId, sourceKind, sourceId]);
  async function submit() {
    if (locked.current) return;
    locked.current = true;
    const request = attempt ?? {
      scene_id: sceneId,
      operation_id: crypto.randomUUID(),
      count,
      source,
    };
    setAttempt(request);
    setPending(true);
    setFeedback('');
    try {
      try {
        sessionStorage.setItem(key, JSON.stringify(request));
      } catch {
        /* Optional persistence. */
      }
      const result = await run('creature_add', request);
      if (!result?.id) {
        setFeedback(
          'Creation unconfirmed. Retry the same request; it cannot create a second group.',
        );
        return;
      }
      setAttempt(undefined);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional persistence. */
      }
      setFeedback(`${result.count} independent creature(s) added hidden. Reveal them when ready.`);
    } catch {
      setFeedback('Creation unconfirmed. Retry the same request; it cannot create a second group.');
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <label>
        Number of creatures
        <input
          aria-label="Number of creatures"
          type="number"
          min={1}
          max={20}
          step={1}
          value={count}
          disabled={disabled || !!attempt || pending}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>
      <button
        className="primary"
        disabled={disabled || pending || !Number.isInteger(count) || count < 1 || count > 20}
        onClick={() => void submit()}
      >
        {pending ? 'Adding creatures…' : attempt ? 'Retry creature creation' : label}
      </button>
      {feedback && <p role="status">{feedback}</p>}
      {attempt && !pending && (
        <button
          onClick={() => {
            if (
              !window.confirm(
                'Dismiss this unconfirmed request? Creatures may already exist. Check the board before adding another group.',
              )
            )
              return;
            setAttempt(undefined);
            setFeedback('');
            try {
              sessionStorage.removeItem(key);
            } catch {
              /* Optional persistence. */
            }
          }}
        >
          Dismiss unconfirmed creation
        </button>
      )}
    </div>
  );
}
