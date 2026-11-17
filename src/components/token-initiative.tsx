'use client';

import { useEffect, useState } from 'react';
import type { Actor, Snapshot, Token } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { boardEncounter } from '@/lib/encounter-view';
import { initiativeExpression } from '@/lib/initiative';
import { useEncounterCommand } from './use-encounter-command';

export function TokenInitiative({
  token,
  actor,
  snapshot,
  disabled,
  run,
  refresh,
  onBusyChange,
}: {
  token: Token;
  actor?: Actor;
  snapshot: Snapshot;
  disabled: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  refresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const operation = useEncounterCommand(
    `${snapshot.userId}:${snapshot.game.id}:${token.scene_id}:token:${token.id}`,
    run,
    refresh,
  );
  const [total, setTotal] = useState('');
  useEffect(
    () => onBusyChange(operation.busy || operation.uncertain),
    [operation.busy, operation.uncertain, onBusyChange],
  );
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const encounter = boardEncounter(snapshot);
  const live = encounter && encounter.status !== 'ended';
  const participant = live && encounter.participants.find((p) => p.token_id === token.id);
  const rule = actor && initiativeExpression(actor.sheet);
  const manual = total.trim() !== '';
  const valid = manual
    ? Number.isFinite(Number(total)) && Math.abs(Number(total)) <= 1000000
    : !!rule;
  async function commit() {
    if (disabled || operation.blocked || !valid) return;
    const context = live ? { id: encounter.id, revision: encounter.revision } : {};
    await operation.commit({
      scene_id: token.scene_id,
      ...context,
      ...(participant
        ? manual
          ? { action: 'initiative', changes: [{ token_id: token.id, value: Number(total) }] }
          : { action: 'roll', token_ids: [token.id] }
        : {
            action: live ? 'add' : 'start',
            participants: [{ token_id: token.id, initiative: manual ? Number(total) : null }],
          }),
    });
  }
  return (
    <details>
      <summary>Initiative</summary>
      <p className="small">
        GM only. Blank rolls saved initiative privately; a manual total overrides it.
        {!live && ' Starts a new encounter with this token.'}
        {participant && ` Current initiative: ${participant.initiative}.`}
      </p>
      {!rule && <p>No saved initiative rule. Enter a manual total.</p>}
      <label>
        Manual initiative
        <input
          aria-label="Token manual initiative"
          type="number"
          step="any"
          value={total}
          disabled={disabled || operation.blocked}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>
      <button disabled={disabled || operation.blocked || !valid} onClick={() => void commit()}>
        {participant
          ? manual
            ? 'Set token initiative'
            : 'Reroll token initiative'
          : live
            ? 'Add token to encounter'
            : 'Start encounter with token'}
      </button>
      <p role="status">{operation.message}</p>
      {operation.uncertain && (
        <div className="wrap">
          <button disabled={operation.busy} onClick={() => void operation.retry()}>
            Retry token initiative
          </button>
          <button disabled={operation.busy} onClick={() => void operation.dismiss()}>
            Dismiss token initiative attempt
          </button>
        </div>
      )}
    </details>
  );
}
