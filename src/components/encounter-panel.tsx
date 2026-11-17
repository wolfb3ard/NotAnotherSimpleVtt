'use client';

import { useState } from 'react';
import type { Command } from '@/lib/commands';
import type { Snapshot } from '@/lib/types';
import { boardEncounter, encounterTurn } from '@/lib/encounter-view';
import { initiativeExpression } from '@/lib/initiative';
import { useEncounterCommand } from './use-encounter-command';
import { combatSummary } from '@/lib/combat';

export function EncounterTurnCue({ snapshot }: { snapshot: Snapshot }) {
  const { encounter, token, yours } = encounterTurn(snapshot);
  if (!encounter) return null;
  return (
    <div
      className={`encounter-turn${yours ? ' is-your-turn' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <strong>
        {yours
          ? 'Your turn'
          : encounter.status === 'paused'
            ? 'Encounter paused'
            : encounter.status === 'ended'
              ? 'Encounter ended'
              : token
                ? 'Current turn'
                : 'Waiting for GM'}
      </strong>
      {token && <span>{token.label}</span>}
      <span>Round {encounter.round}</span>
    </div>
  );
}

export function EncounterPanel({
  snapshot,
  run,
  refresh,
  onSheet,
}: {
  snapshot: Snapshot;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  refresh: () => Promise<void>;
  onSheet: (id: string) => void;
}) {
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const encounter = boardEncounter(snapshot);
  const gm = snapshot.role === 'gm';
  const operation = useEncounterCommand(
    `${snapshot.userId}:${snapshot.game.id}:${scene?.id ?? 'none'}`,
    run,
    refresh,
  );
  const [selection, setSelection] = useState<Record<string, string>>({});
  const participants = encounter?.participants ?? [];
  const live = encounter && encounter.status !== 'ended';
  const available = snapshot.tokens.filter(
    (t) => t.scene_id === scene?.id && (!live || !participants.some((p) => p.token_id === t.id)),
  );
  const chosen = Object.keys(selection).flatMap((id) => {
    const token = available.find((t) => t.id === id);
    return token ? [token] : [];
  });
  const scoreValid = (text: string) =>
    text.trim() !== '' && Number.isFinite(Number(text)) && Math.abs(Number(text)) <= 1000000;
  const canAdd =
    chosen.length > 0 &&
    chosen.every((t) =>
      selection[t.id].trim() === ''
        ? !!initiativeExpression(
            snapshot.actors.find((a) => a.id === t.actor_id)?.sheet ?? { version: 1, sections: [] },
          )
        : scoreValid(selection[t.id]),
    );
  async function change(action: string, extra: Record<string, unknown> = {}) {
    if (!scene || !encounter) return false;
    return operation.commit({
      action,
      scene_id: scene.id,
      id: encounter.id,
      revision: encounter.revision,
      ...extra,
    });
  }
  async function add() {
    if (!scene || !canAdd) return;
    const extra = {
      participants: chosen.map((t) => ({
        token_id: t.id,
        initiative: selection[t.id].trim() === '' ? null : Number(selection[t.id]),
      })),
    };
    const saved = live
      ? await change('add', extra)
      : await operation.commit({ action: 'start', scene_id: scene.id, ...extra });
    if (saved) setSelection({});
  }
  function reorder(index: number, delta: number) {
    const ids = participants.map((p) => p.token_id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void change('reorder', { token_ids: ids });
  }
  return (
    <section className="stack" aria-label="Encounter tracker">
      <h2>Encounter</h2>
      {!scene ? (
        <p>
          {gm
            ? 'Activate a scene to manage its encounter.'
            : 'Waiting for the GM to activate a scene.'}
        </p>
      ) : (
        <>
          <p className="small">
            Encounters stay with their scene. Only the GM advances turns. Rolls use saved initiative
            rules; manual totals override them.
          </p>
          {encounter && (
            <>
              <p>
                <strong>Round {encounter.round}</strong> · {encounter.status}
              </p>
              <ol className="encounter-order" aria-label="Turn order">
                {participants.map((p, index) => {
                  const current = live && p.token_id === encounter.active_token_id;
                  const token = snapshot.tokens.find((t) => t.id === p.token_id);
                  const actor = snapshot.actors.find((a) => a.id === token?.actor_id);
                  return (
                    <li
                      key={p.token_id}
                      className={current ? 'is-current-turn' : ''}
                      aria-current={current ? 'step' : undefined}
                    >
                      <strong>
                        {current ? '▶ ' : ''}
                        {p.label}
                      </strong>
                      <span>Initiative {p.initiative}</span>
                      {actor && <span className="small">{combatSummary(actor)}</span>}
                      {actor && (
                        <button onClick={() => onSheet(actor.id)}>Sheet for {p.label}</button>
                      )}
                      {gm && live && (
                        <>
                          <InitiativeEdit
                            key={`${p.token_id}:${p.initiative}`}
                            label={p.label}
                            value={p.initiative}
                            disabled={operation.blocked}
                            onSave={(value) =>
                              void change('initiative', {
                                changes: [{ token_id: p.token_id, value }],
                              })
                            }
                          />
                          <div className="wrap">
                            <button
                              aria-label={`Move ${p.label} up`}
                              disabled={operation.blocked || index === 0}
                              onClick={() => reorder(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`Move ${p.label} down`}
                              disabled={operation.blocked || index === participants.length - 1}
                              onClick={() => reorder(index, 1)}
                            >
                              ↓
                            </button>
                            <button
                              disabled={operation.blocked}
                              onClick={() => void change('roll', { token_ids: [p.token_id] })}
                            >
                              Reroll {p.label}
                            </button>
                            <button
                              disabled={operation.blocked}
                              onClick={() => void change('remove', { token_ids: [p.token_id] })}
                            >
                              Remove {p.label}
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
              {encounter.status === 'active' && !encounter.active_token_id && (
                <p>Waiting for GM.</p>
              )}
              {!participants.length && <p>No visible turn-order entries.</p>}
              {gm && live && (
                <div className="wrap">
                  <button
                    className="primary"
                    disabled={
                      operation.blocked || encounter.status !== 'active' || !participants.length
                    }
                    onClick={() => void change('next')}
                  >
                    Next turn
                  </button>
                  {encounter.status === 'active' ? (
                    <button disabled={operation.blocked} onClick={() => void change('pause')}>
                      Pause encounter
                    </button>
                  ) : (
                    <button
                      disabled={operation.blocked || !participants.length}
                      onClick={() => void change('resume')}
                    >
                      Resume encounter
                    </button>
                  )}
                  <button
                    disabled={operation.blocked}
                    onClick={() => {
                      if (
                        window.confirm(
                          'End this encounter? Turn advancement stops; sheets and resources are unchanged.',
                        )
                      )
                        void change('end');
                    }}
                  >
                    End encounter
                  </button>
                </div>
              )}
            </>
          )}
          {!encounter && <p>No encounter in this scene.</p>}
          {gm && (
            <>
              <details open={!live}>
                <summary>{live ? 'Add participants' : 'Select tokens and start encounter'}</summary>
                <p className="small">
                  Blank total rolls saved initiative privately as GM. Enter a manual total when no
                  rule exists. Tokens need not have visible sheets for players; hidden combatants
                  are omitted from their tracker.
                </p>
                {available.map((t) => {
                  const actor = snapshot.actors.find((a) => a.id === t.actor_id);
                  const rule = actor && initiativeExpression(actor.sheet);
                  return (
                    <div className="encounter-pick stack" key={t.id}>
                      <label className="row">
                        <input
                          type="checkbox"
                          aria-label={`Include ${t.label} in encounter`}
                          checked={Object.hasOwn(selection, t.id)}
                          disabled={operation.blocked}
                          onChange={(e) =>
                            setSelection((old) => {
                              const next = { ...old };
                              if (e.target.checked) next[t.id] = '';
                              else delete next[t.id];
                              return next;
                            })
                          }
                        />
                        {t.label} <small>({t.id.slice(0, 6)})</small>
                      </label>
                      {Object.hasOwn(selection, t.id) && (
                        <label>
                          Manual initiative for {t.label}
                          <input
                            aria-label={`Manual initiative for ${t.label}`}
                            type="number"
                            step="any"
                            min={-1000000}
                            max={1000000}
                            disabled={operation.blocked}
                            value={selection[t.id]}
                            placeholder={
                              rule ? 'Blank: roll saved initiative' : 'Manual total required'
                            }
                            onChange={(e) =>
                              setSelection((old) => ({ ...old, [t.id]: e.target.value }))
                            }
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
                {!available.length && (
                  <p>No additional tokens in this scene. Place creatures on the board first.</p>
                )}
                <button disabled={operation.blocked || !canAdd} onClick={() => void add()}>
                  {live ? 'Add selected participants' : 'Start encounter'}
                </button>
              </details>
              <p className="small">
                Initial order is descending initiative; ties retain selection order. Up/down
                resolves ties or overrides order. Editing/adding/rerolling preserves the current
                turn; removal advances to the next survivor. No HP, actions or resources reset
                automatically.
              </p>
              <p role="status">{operation.message}</p>
              {operation.uncertain && (
                <div className="wrap">
                  <button disabled={operation.busy} onClick={() => void operation.retry()}>
                    Retry encounter change
                  </button>
                  <button disabled={operation.busy} onClick={() => void operation.dismiss()}>
                    Dismiss encounter attempt
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function InitiativeEdit({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const valid =
    draft.trim() !== '' && Number.isFinite(Number(draft)) && Math.abs(Number(draft)) <= 1000000;
  return (
    <div className="row">
      <label>
        Initiative for {label}
        <input
          type="number"
          step="any"
          min={-1000000}
          max={1000000}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button
        disabled={disabled || !valid || Number(draft) === value}
        onClick={() => onSave(Number(draft))}
      >
        Set initiative for {label}
      </button>
    </div>
  );
}
