'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { Actor, Sheet, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { dndId, isDndSheet } from '@/lib/dnd';
import { playResources, temporaryHpId } from '@/lib/resources';
import { ResourceWriter, type ResourceState } from '@/lib/resource-writer';
import { monsterId, monsterHpId, monsterTemporaryHpId } from '@/lib/monster-sheet';

function HealthField({
  value,
  label,
  max,
  temporary,
  disabled,
  onCommit,
}: {
  value: number;
  label: string;
  max: number;
  temporary: boolean;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <input
      aria-label={`Quick ${label}`}
      title={temporary ? 'Set temporary HP' : 'Set HP, or enter a negative number to subtract HP'}
      type="text"
      inputMode={temporary ? 'numeric' : 'text'}
      disabled={disabled}
      value={draft ?? value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setDraft(undefined);
        if (disabled || !draft || !/^[+-]?\d+$/.test(draft.trim())) return;
        const amount = Number(draft);
        if (!Number.isSafeInteger(amount)) return;
        const next = Math.max(0, Math.min(max, !temporary && amount < 0 ? value + amount : amount));
        if (next !== value) onCommit(next);
      }}
    />
  );
}

export function QuickResources({
  actor,
  editable,
  blocked,
  run,
  onBusyChange,
  onCommitted,
  writerRef,
  controls = true,
}: {
  actor: Actor;
  editable: boolean;
  blocked: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onBusyChange: (busy: boolean) => void;
  onCommitted: (sheet: Sheet, revision: number, name?: string) => void;
  writerRef?: RefObject<ResourceWriter | null>;
  controls?: boolean;
}) {
  const [state, setState] = useState<ResourceState>({
    sheet: actor.sheet,
    status: 'Saved',
    error: '',
  });
  const [writer] = useState(
    () =>
      new ResourceWriter(
        actor.id,
        actor.sheet,
        actor.revision,
        (payload) => run('actor_resources', payload),
        setState,
        onCommitted,
      ),
  );
  const [validation, setValidation] = useState('');
  const [reloading, setReloading] = useState(false);
  useEffect(
    () => writer.sync(actor.sheet, actor.revision),
    [actor.sheet, actor.revision, state.status, writer],
  );
  useEffect(() => {
    if (writerRef) writerRef.current = writer;
    return () => {
      if (writerRef) writerRef.current = null;
    };
  }, [writer, writerRef]);
  useEffect(() => onBusyChange(state.status !== 'Saved'), [state.status, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const resources = playResources(state.sheet);
  if (!resources.length) return null;
  const disabled = !editable || blocked || state.status === 'Failed';
  const feedback = (
    <>
      <span className="small" role="status">
        Resources: {state.status === 'Saving' ? 'Saving…' : state.status}
      </span>
      {(validation || state.error) && <p role="alert">{validation || state.error}</p>}
      {state.status === 'Failed' && (
        <div className="wrap">
          <button
            disabled={!editable || reloading}
            onClick={() => {
              setValidation('');
              writer.retry();
            }}
          >
            Retry resource update
          </button>
          <button
            disabled={reloading}
            onClick={async () => {
              setReloading(true);
              try {
                const response = await fetch(`/api/games/${actor.game_id}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('Reload failed');
                const latest = ((await response.json()) as Snapshot).actors.find(
                  (a) => a.id === actor.id,
                );
                if (!latest) throw new Error('Sheet access changed');
                if (writer.discard(latest.sheet, latest.revision))
                  onCommitted(latest.sheet, latest.revision, latest.name);
                setValidation('');
              } catch {
                setValidation(
                  'Could not reload resources. The update remains unconfirmed; reconnect and retry.',
                );
              } finally {
                setReloading(false);
              }
            }}
          >
            {reloading ? 'Reloading resources…' : 'Reload resources'}
          </button>
        </div>
      )}
    </>
  );
  if (!controls)
    return state.status === 'Saved' ? null : (
      <div className="resource-feedback" aria-label="Resource update status">
        {feedback}
      </div>
    );
  const monster = !!monsterId(state.sheet);
  const health = isDndSheet(state.sheet) || monster;
  const hpId = monster ? monsterHpId : dndId('hp');
  const tempId = monster ? monsterTemporaryHpId : temporaryHpId;
  const primary = health
    ? resources.filter((r) => r.id === hpId || r.id === tempId)
    : resources.slice(0, 3);
  const secondary = resources.filter((r) => !primary.includes(r));
  const commit = (resource: (typeof resources)[number], value: number) => {
    try {
      writer.enqueue([
        {
          id: resource.id,
          value,
          ...(resource.target ? { target: resource.target } : {}),
        },
      ]);
      setValidation('');
    } catch (error) {
      setValidation((error as Error).message);
    }
  };
  const counters = (items: typeof resources) => (
    <div className="quick-resource-grid">
      {items.map((resource) => (
        <label key={`${resource.target ?? 'field'}:${resource.id}`}>
          <span className="quick-resource-label">{resource.label}</span>
          {health && (resource.id === hpId || resource.id === tempId) ? (
            <HealthField
              label={resource.label}
              value={Number(resource.value)}
              max={resource.max ?? 0}
              temporary={resource.id === tempId}
              disabled={disabled}
              onCommit={(value) => commit(resource, value)}
            />
          ) : (
            <input
              aria-label={`Quick ${resource.label}`}
              type="number"
              min={0}
              max={resource.max}
              step={resource.target === 'feature' ? 1 : 'any'}
              disabled={disabled}
              value={resource.value}
              onChange={(event) => commit(resource, Number(event.target.value))}
            />
          )}
          {(!health || resource.id !== tempId) && <span> / {resource.max}</span>}
        </label>
      ))}
    </div>
  );
  return (
    <section className="stack quick-resources" aria-label="Quick resources">
      {blocked && (
        <p className="small" role="status">
          Save or reload sheet edits before using quick actions.
        </p>
      )}
      {counters(primary)}
      {health && (
        <span className="small">Set HP, or enter −N to subtract. Temp HP is separate.</span>
      )}
      {secondary.length > 0 && (
        <details>
          <summary>More resources ({secondary.length})</summary>
          {counters(secondary)}
        </details>
      )}
      {feedback}
    </section>
  );
}
