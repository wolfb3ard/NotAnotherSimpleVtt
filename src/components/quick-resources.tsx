'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { Actor, Sheet, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { dndId, isDndSheet } from '@/lib/dnd';
import { healthChanges, playResources, previewResources, temporaryHpId } from '@/lib/resources';
import { ResourceWriter, type ResourceState } from '@/lib/resource-writer';

export function QuickResources({
  actor,
  editable,
  blocked,
  run,
  onBusyChange,
  onCommitted,
  writerRef,
}: {
  actor: Actor;
  editable: boolean;
  blocked: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onBusyChange: (busy: boolean) => void;
  onCommitted: (sheet: Sheet, revision: number, name?: string) => void;
  writerRef?: RefObject<ResourceWriter | null>;
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
  const [amount, setAmount] = useState('0');
  const [mode, setMode] = useState<'damage' | 'heal'>('damage');
  const [useTemporary, setUseTemporary] = useState(true);
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
  const resources = playResources(state.sheet);
  if (!resources.length) return null;
  const disabled = !editable || blocked || state.status === 'Failed';
  let changes: ReturnType<typeof healthChanges> = [];
  let preview: Sheet | undefined;
  try {
    if (amount.trim() !== '') {
      changes = healthChanges(state.sheet, Number(amount), mode, useTemporary);
      preview = previewResources(state.sheet, changes);
    }
  } catch {
    /* Invalid input disables confirmation; direct resource controls remain available. */
  }
  const hp = (sheet: Sheet, id: string) =>
    playResources(sheet).find((f) => f.id === id)?.value ?? 0;
  return (
    <section className="sheet-section stack" aria-label="Play resources">
      <h3>Play resources</h3>
      <p className="small">
        Current values save immediately. Maximums, builder changes, and configuration require Save
        sheet.
      </p>
      {blocked && (
        <p role="status">Save or reload configuration edits before adjusting play resources.</p>
      )}
      <div className="dnd-resource-grid">
        {resources.map((resource) => (
          <label key={`${resource.target ?? 'field'}:${resource.id}`}>
            {resource.label}
            <input
              aria-label={`Quick ${resource.label}`}
              type="number"
              min={0}
              max={resource.max}
              step={resource.target === 'feature' ? 1 : 'any'}
              disabled={disabled}
              value={resource.value}
              onChange={(event) => {
                try {
                  writer.enqueue([
                    {
                      id: resource.id,
                      value: Number(event.target.value),
                      ...(resource.target ? { target: resource.target } : {}),
                    },
                  ]);
                  setValidation('');
                } catch (error) {
                  setValidation((error as Error).message);
                }
              }}
            />
            {resource.id !== temporaryHpId && <span> / {resource.max}</span>}
          </label>
        ))}
      </div>
      {isDndSheet(state.sheet) && (
        <details>
          <summary>Damage / Heal</summary>
          <div className="stack">
            <label>
              Action
              <select
                aria-label="Health action"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="damage">Damage</option>
                <option value="heal">Heal</option>
              </select>
            </label>
            <label>
              Amount
              <input
                aria-label="Health amount"
                type="number"
                min={0}
                max={1e12}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {mode === 'damage' && (
              <label>
                <input
                  type="checkbox"
                  checked={useTemporary}
                  onChange={(e) => setUseTemporary(e.target.checked)}
                />
                Use temporary HP first
              </label>
            )}
            {preview ? (
              <p role="status">
                HP {hp(state.sheet, dndId('hp'))} → {hp(preview, dndId('hp'))}; temporary HP{' '}
                {hp(state.sheet, temporaryHpId)} → {hp(preview, temporaryHpId)}.
              </p>
            ) : (
              <p>Enter a nonnegative whole amount to preview.</p>
            )}
            <p className="small">
              Healing stops at maximum HP; temporary HP never stacks automatically. No resistance,
              vulnerability, concentration, or death-save rules are applied. Override with direct
              current-value controls above.
            </p>
            <button
              disabled={disabled || state.status === 'Saving' || !preview || Number(amount) <= 0}
              onClick={() => {
                writer.enqueue(changes);
                setAmount('0');
              }}
            >
              Confirm {mode === 'damage' ? 'Damage' : 'Heal'}
            </button>
          </div>
        </details>
      )}
      <span role="status">Resources: {state.status === 'Saving' ? 'Saving…' : state.status}</span>
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
    </section>
  );
}
