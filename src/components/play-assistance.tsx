'use client';

import { useEffect, useRef, useState } from 'react';
import type { Actor, Token } from '@/lib/types';
import { commandSchemas, type Command } from '@/lib/commands';
import { castChoices, hitDieId, hitDieSizes, restChanges } from '@/lib/play-assistance';
import { healthChanges, playResources, type ResourceChange } from '@/lib/resources';

type Mode = 'cast' | 'short' | 'long' | 'damage';
type Preview = {
  title: string;
  changes: ResourceChange[];
  revision: number;
  combatRevision: number;
  amount?: number;
};
type Attempt = {
  command: 'actor_resources' | 'assist_damage';
  payload: Record<string, unknown>;
  success: string;
};

export function PlayAssistance({
  actor,
  token,
  userId,
  disabled,
  active,
  run,
  onBusyChange,
}: {
  actor: Actor;
  token: Token;
  userId: string;
  disabled: boolean;
  active: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onBusyChange: (busy: boolean) => void;
}) {
  const spells = actor.sheet.character?.spells ?? [];
  const resources = playResources(actor.sheet);
  const [mode, setMode] = useState<Mode | ''>('');
  const [spellId, setSpellId] = useState('');
  const [choice, setChoice] = useState('');
  const [amount, setAmount] = useState('');
  const [dice, setDice] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [undoId, setUndoId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const lock = useRef(false);
  const storageKey = `vtt-assistance:${userId}:${actor.game_id}:${token.id}`;
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try {
        const saved: {
          attempt?: { command?: unknown; payload?: unknown };
          undoId?: unknown;
        } | null = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        const command = saved?.attempt?.command;
        if (command === 'actor_resources' || command === 'assist_damage') {
          const parsed = commandSchemas[command].safeParse(saved?.attempt?.payload);
          if (
            parsed.success &&
            parsed.data.id === actor.id &&
            (!('token_id' in parsed.data) || parsed.data.token_id === token.id)
          ) {
            setAttempt({ command, payload: parsed.data, success: 'Assistance confirmed.' });
            setMessage('Previous request unconfirmed. Retry the same request.');
          }
        }
        if (typeof saved?.undoId === 'string' && /^[a-f0-9-]{36}$/i.test(saved.undoId))
          setUndoId(saved.undoId);
      } catch {
        // Storage is optional; the live panel still supports exact retry.
      }
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [actor.id, token.id, storageKey]);
  const spell = spells.find((s) => s.id === spellId);
  const choices = spell && mode === 'cast' ? castChoices(actor.sheet, spell) : [];
  const selected = choices.find((c) => c.key === choice);
  const combatRevision = actor.combat_revision ?? 0;
  const stale =
    preview &&
    (preview.revision !== actor.revision ||
      (mode === 'damage' && preview.combatRevision !== combatRevision));

  function resetPreview() {
    setPreview(undefined);
    setMessage('');
  }

  function remember(pending: Attempt | undefined, undo: string) {
    try {
      if (pending || undo)
        sessionStorage.setItem(storageKey, JSON.stringify({ attempt: pending, undoId: undo }));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Storage is optional.
    }
  }

  function makePreview() {
    resetPreview();
    try {
      let changes: ResourceChange[];
      let title: string;
      if (mode === 'cast') {
        if (!spell || !selected?.available) return;
        changes = selected.changes;
        title = `Cast ${spell.name} — ${selected.label}`;
      } else if (mode === 'damage') {
        if (!active) throw new Error('Damage requires a target in the active scene.');
        if (!/^\d+$/.test(amount.trim()) || Number(amount) <= 0)
          throw new Error('Enter a positive whole damage amount.');
        changes = healthChanges(actor.sheet, Number(amount), 'damage').filter(
          (change) => resources.find((r) => r.id === change.id)?.value !== change.value,
        );
        if (!changes.length) throw new Error('No HP to reduce; adjudicate manually.');
        title = `Apply ${amount} damage to ${token.label}`;
      } else if (mode === 'short' || mode === 'long') {
        const results = Object.fromEntries(
          Object.entries(dice).map(([size, text]) => [
            size,
            text.trim()
              ? text
                  .trim()
                  .split(/[\s,]+/)
                  .map((n) => (/^\d+$/.test(n) ? Number(n) : NaN))
              : [],
          ]),
        );
        changes = restChanges(actor.sheet, mode, results, excluded);
        if (changes.length > 40)
          throw new Error('Exclude some counters for manual handling (up to 40 changes per rest).');
        title = mode === 'short' ? 'Short rest' : 'Long rest';
      } else return;
      setPreview({
        title,
        changes,
        revision: actor.revision,
        combatRevision,
        ...(mode === 'damage' ? { amount: Number(amount) } : {}),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preview unavailable.');
    }
  }

  async function send(next: Attempt) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setAttempt(next);
    remember(next, undoId);
    try {
      const result = await run(next.command, next.payload);
      if (typeof result?.revision !== 'string') throw new Error();
      const undo =
        next.payload.action === 'apply'
          ? String(next.payload.operation_id)
          : next.payload.action === 'undo'
            ? ''
            : undoId;
      setUndoId(undo);
      remember(undefined, undo);
      setAttempt(undefined);
      setPreview(undefined);
      setMessage(next.success);
    } catch {
      setMessage(
        'Not confirmed. Retry the same request, or review current state before discarding.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  function confirm() {
    if (!preview || stale || attempt || disabled || lock.current) return;
    if (!preview.changes.length) {
      setPreview(undefined);
      setMessage(
        mode === 'cast' ? 'Manual cast confirmed. No resources changed.' : 'No changes applied.',
      );
      return;
    }
    const common = { id: actor.id, operation_id: crypto.randomUUID(), revision: preview.revision };
    if (preview.amount !== undefined) {
      if (!active) return;
      void send({
        command: 'assist_damage',
        payload: {
          ...common,
          action: 'apply',
          token_id: token.id,
          amount: preview.amount,
          combat_revision: preview.combatRevision,
        },
        success: 'Damage applied.',
      });
    } else {
      void send({
        command: 'actor_resources',
        payload: { ...common, changes: preview.changes },
        success: mode === 'cast' ? 'Casting resource spent.' : 'Rest recovery applied.',
      });
    }
  }

  return (
    <details>
      <summary>Casting, rests &amp; damage</summary>
      <fieldset className="stack" disabled={!ready || disabled || busy || !!attempt}>
        <label>
          Assistance
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode | '');
              setExcluded(new Set());
              resetPreview();
            }}
          >
            <option value="">Choose an action</option>
            {spells.length > 0 && <option value="cast">Cast</option>}
            <option value="short">Short rest</option>
            <option value="long">Long rest</option>
            {active && <option value="damage">Apply damage to {token.label}</option>}
          </select>
        </label>
        {mode === 'cast' && (
          <>
            <label>
              Spell
              <select
                value={spellId}
                onChange={(e) => {
                  setSpellId(e.target.value);
                  setChoice('');
                  resetPreview();
                }}
              >
                <option value="">Choose a spell</option>
                {spells.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.level ? `level ${s.level}` : 'cantrip'}
                  </option>
                ))}
              </select>
            </label>
            {spell && (
              <label>
                Slot / casting source
                <select
                  value={choice}
                  onChange={(e) => {
                    setChoice(e.target.value);
                    resetPreview();
                  }}
                >
                  <option value="">Choose a source</option>
                  {choices.map((c) => (
                    <option key={c.key} value={c.key} disabled={!c.available}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="small">
              Only supported prepared SRD spells offer tracked slots. Rituals, feature-based free
              casting, homebrew, targeting, effects and rolls are manual.
            </p>
          </>
        )}
        {(mode === 'short' || mode === 'long') && (
          <>
            <p className="small">
              Confirm rest eligibility at the table. Exhaustion, ability scores, reduced HP maximum,
              temporary HP, optional feature effects and custom counters remain manual.
            </p>
            {mode === 'short' &&
              hitDieSizes.map((size) => {
                const pool = resources.find((f) => f.id === hitDieId(size));
                return (
                  pool &&
                  Number(pool.value) > 0 && (
                    <label key={size}>
                      d{size} Hit Dice results ({pool.value} available)
                      <input
                        value={dice[size] ?? ''}
                        placeholder="e.g. 4, 6"
                        onChange={(e) => {
                          setDice({ ...dice, [size]: e.target.value });
                          resetPreview();
                        }}
                      />
                    </label>
                  )
                );
              })}
            {mode === 'short' && (
              <p className="small">
                Roll Hit Dice at the table. Enter one result per die to spend; Constitution is added
                to each roll (minimum 1 healing per die).
              </p>
            )}
            {actor.sheet.character?.builder &&
              (() => {
                try {
                  const recoveries = restChanges(actor.sheet, mode);
                  return (
                    recoveries.length > 0 && (
                      <details>
                        <summary>Exclude recovery for manual handling</summary>
                        {recoveries.map((change) => (
                          <label key={change.id}>
                            <input
                              type="checkbox"
                              checked={excluded.has(change.id)}
                              onChange={(e) => {
                                const next = new Set(excluded);
                                if (e.target.checked) next.add(change.id);
                                else next.delete(change.id);
                                setExcluded(next);
                                resetPreview();
                              }}
                            />{' '}
                            {resources.find((f) => f.id === change.id)?.label}
                          </label>
                        ))}
                      </details>
                    )
                  );
                } catch {
                  return null;
                }
              })()}
          </>
        )}
        {mode === 'damage' && (
          <>
            <label>
              Final damage to {token.label}
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  resetPreview();
                }}
              />
            </label>
            <p className="small">
              Enter damage after saves, resistance and other rulings. Temporary HP is used first.
              Concentration prompts may be added; death saves and other effects stay manual.
            </p>
          </>
        )}
        {mode && (
          <button
            disabled={(mode === 'cast' && !selected?.available) || (mode === 'damage' && !active)}
            onClick={makePreview}
          >
            Preview {mode === 'cast' ? 'cast' : mode === 'damage' ? 'damage' : 'rest'}
          </button>
        )}
        {preview && (
          <div aria-label="Assistance preview" className="stack">
            <strong>{preview.title}</strong>
            {stale ? (
              <p>State changed. Make a new preview.</p>
            ) : preview.changes.length ? (
              <ul>
                {preview.changes.map((change) => {
                  const field = resources.find((f) => f.id === change.id);
                  return (
                    <li key={change.id}>
                      {field?.label}: {field?.value} → {change.value}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No tracked resources will change.</p>
            )}
            <button disabled={!!stale || (mode === 'damage' && !active)} onClick={confirm}>
              Confirm {mode === 'cast' ? 'cast' : mode === 'damage' ? 'damage' : 'rest'}
            </button>
            <button onClick={resetPreview}>Cancel preview</button>
          </div>
        )}
        {active && undoId && (
          <button
            onClick={() =>
              void send({
                command: 'assist_damage',
                payload: { action: 'undo', id: actor.id, token_id: token.id, operation_id: undoId },
                success: 'Damage undone.',
              })
            }
          >
            Undo last assisted damage
          </button>
        )}
      </fieldset>
      {attempt && !busy && (
        <>
          <button disabled={disabled} onClick={() => void send(attempt)}>
            Retry same request
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  'Discard this attempt? It may already have applied; this will not undo it.',
                )
              ) {
                setAttempt(undefined);
                remember(undefined, undoId);
                resetPreview();
              }
            }}
          >
            Discard unconfirmed request
          </button>
        </>
      )}
      <p role="status">{busy ? 'Saving…' : message}</p>
    </details>
  );
}
