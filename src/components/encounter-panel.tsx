'use client';

import { useState } from 'react';
import type { Command } from '@/lib/commands';
import type { Snapshot } from '@/lib/types';
import { boardEncounter, encounterTurn } from '@/lib/encounter-view';
import { initiativeExpression } from '@/lib/initiative';
import { useEncounterCommand } from './use-encounter-command';
import { combatSummary } from '@/lib/combat';

export function EncounterTurnCue({ snapshot }: { snapshot: Snapshot }) {
  const { encounter, token, yours, upNext } = encounterTurn(snapshot);
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
          : encounter.status === 'setup'
            ? 'Waiting for initiative'
            : encounter.status === 'paused'
              ? 'Encounter paused'
              : encounter.status === 'ended'
                ? 'Encounter ended'
                : token
                  ? 'Current turn'
                  : 'Waiting for GM'}
      </strong>
      {token && <span>{token.label}</span>}
      {upNext && <span>Up next: {upNext.label}</span>}
      {encounter.status !== 'setup' && <span>Round {encounter.round}</span>}
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
  const setup = encounter?.status === 'setup';
  const inOrder = participants.filter((p) => !p.outcome || p.outcome === 'active');
  const outOfOrder = participants.filter((p) => p.outcome && p.outcome !== 'active');
  const archived = gm ? (encounter?.archived_outcomes ?? []) : [];
  const waiting = inOrder.filter((p) => p.initiative === null).length;
  const upNext = inOrder.find((p) => p.token_id === encounter?.next_token_id);
  const available = snapshot.tokens.filter(
    (t) => t.scene_id === scene?.id && (!live || !participants.some((p) => p.token_id === t.id)),
  );
  const chosen = Object.keys(selection).flatMap((id) => {
    const token = available.find((t) => t.id === id);
    return token ? [token] : [];
  });
  const scoreValid = (text: string) =>
    text.trim() !== '' && Number.isFinite(Number(text)) && Math.abs(Number(text)) <= 1000000;
  const validSelection =
    chosen.length > 0 &&
    chosen.every((t) => !selection[t.id].trim() || scoreValid(selection[t.id]));
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
  async function add(prepare = false) {
    if (!scene || !(prepare || setup ? validSelection : canAdd)) return;
    const extra = {
      participants: chosen.map((t) => ({
        token_id: t.id,
        initiative: selection[t.id].trim() === '' ? null : Number(selection[t.id]),
      })),
    };
    const saved = live
      ? await change(setup ? 'queue' : 'add', extra)
      : await operation.commit({
          action: prepare ? 'prepare' : 'start',
          scene_id: scene.id,
          ...extra,
        });
    if (saved) setSelection({});
  }
  function reorder(index: number, delta: number) {
    const ids = [...inOrder, ...outOfOrder].map((p) => p.token_id);
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
            Roll Initiative on your sheet to update your token here. The tracker shows totals, even
            for private rolls. Only the GM advances turns.
          </p>
          {encounter && (
            <>
              {setup ? (
                <p role="status">
                  <strong>Waiting for initiative</strong> · {inOrder.length - waiting} of{' '}
                  {inOrder.length} ready
                </p>
              ) : (
                <p>
                  <strong>Round {encounter.round}</strong> · {encounter.status}
                  {upNext && (
                    <>
                      {' '}
                      · Up next: <strong>{upNext.label}</strong>
                    </>
                  )}
                </p>
              )}
              <ol className="encounter-order" aria-label="Turn order">
                {inOrder.map((p, index) => {
                  const current = live && p.token_id === encounter.active_token_id;
                  const token = snapshot.tokens.find((t) => t.id === p.token_id);
                  const actor = snapshot.actors.find((a) => a.id === token?.actor_id);
                  return (
                    <li
                      key={p.token_id}
                      className={current ? 'is-current-turn' : ''}
                      aria-current={current ? 'step' : undefined}
                    >
                      <div className="encounter-entry">
                        <strong>{p.label}</strong>
                        {current && <span className="small">Current turn</span>}
                        <span className="initiative-score">
                          {p.initiative === null ? (
                            'Not rolled'
                          ) : (
                            <>
                              <small>Initiative</small> {p.initiative}
                            </>
                          )}
                        </span>
                      </div>
                      {actor && <span className="small">{combatSummary(actor)}</span>}
                      {actor && (
                        <button onClick={() => onSheet(actor.id)}>Sheet for {p.label}</button>
                      )}
                      {gm && live && (
                        <details>
                          <summary>Manage {p.label}</summary>
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
                              disabled={
                                operation.blocked ||
                                p.initiative === null ||
                                inOrder[index - 1]?.initiative !== p.initiative
                              }
                              onClick={() => reorder(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`Move ${p.label} down`}
                              disabled={
                                operation.blocked ||
                                p.initiative === null ||
                                inOrder[index + 1]?.initiative !== p.initiative
                              }
                              onClick={() => reorder(index, 1)}
                            >
                              ↓
                            </button>
                            <button
                              disabled={
                                operation.blocked || !actor || !initiativeExpression(actor.sheet)
                              }
                              onClick={() => void change('roll', { token_ids: [p.token_id] })}
                            >
                              {p.initiative === null ? 'Roll' : 'Reroll'} {p.label}
                            </button>
                            {!setup &&
                              (['defeated', 'fled'] as const).map((outcome) => (
                                <button
                                  key={outcome}
                                  aria-label={`Mark ${p.label} ${outcome}`}
                                  disabled={operation.blocked}
                                  onClick={() =>
                                    void change('outcome', { token_id: p.token_id, outcome })
                                  }
                                >
                                  {outcome === 'defeated' ? 'Mark defeated' : 'Mark fled'}
                                </button>
                              ))}
                            <button
                              disabled={operation.blocked}
                              aria-label={`Remove ${p.label} from encounter`}
                              onClick={() => void change('remove', { token_ids: [p.token_id] })}
                            >
                              Remove from encounter
                            </button>
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
              {(outOfOrder.length > 0 || archived.length > 0) && (
                <section aria-label="Out of the turn order">
                  <h3>Out of the turn order</h3>
                  <ul className="encounter-order">
                    {outOfOrder.map((p) => (
                      <li key={p.token_id}>
                        <strong>
                          {p.label} · {p.outcome === 'defeated' ? 'Defeated' : 'Fled'}
                        </strong>
                        {p.initiative !== null && <small>Initiative {p.initiative}</small>}
                        {gm && live && (
                          <button
                            aria-label={`Return ${p.label} to turn order`}
                            disabled={operation.blocked}
                            onClick={() =>
                              void change('outcome', { token_id: p.token_id, outcome: 'active' })
                            }
                          >
                            Return to turn order
                          </button>
                        )}
                      </li>
                    ))}
                    {archived.map((p) => (
                      <li key={p.token_id}>
                        <strong>
                          {p.label} · {p.outcome === 'defeated' ? 'Defeated' : 'Fled'}
                        </strong>
                        <small>Removed from table</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {encounter.status === 'active' && !encounter.active_token_id && (
                <p>Waiting for GM.</p>
              )}
              {!inOrder.length && <p>No visible turn-order entries.</p>}
              {gm && live && (
                <div className="wrap">
                  {setup ? (
                    <button
                      className="primary"
                      disabled={operation.blocked || !inOrder.length || waiting > 0}
                      onClick={() => void change('begin')}
                    >
                      Begin combat
                    </button>
                  ) : encounter.status === 'active' ? (
                    <>
                      <button
                        className="primary"
                        disabled={operation.blocked || !encounter.active_token_id}
                        onClick={() => void change('next')}
                      >
                        Next turn
                      </button>
                      <button disabled={operation.blocked} onClick={() => void change('pause')}>
                        Pause encounter
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={operation.blocked || !encounter.active_token_id}
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
                <summary>{live ? 'Add participants' : 'Select encounter participants'}</summary>
                <p className="small">
                  {setup
                    ? 'Leave initiative blank to use a recent sheet roll or wait for a new one.'
                    : live
                      ? 'Leave initiative blank to use a recent sheet roll or roll as GM.'
                      : 'Prepare to wait for sheet rolls, or start immediately to roll missing initiative as GM.'}{' '}
                  Enter a total to override it. Hidden combatants are omitted from the player
                  tracker.
                </p>
                {available.map((t) => {
                  const actor = snapshot.actors.find((a) => a.id === t.actor_id);
                  const rule = actor && initiativeExpression(actor.sheet);
                  return (
                    <div className="encounter-pick stack" key={t.id}>
                      <div className="encounter-entry">
                        <strong>{t.label}</strong>
                        <button
                          aria-label={`Include ${t.label} in encounter`}
                          aria-pressed={Object.hasOwn(selection, t.id)}
                          disabled={operation.blocked}
                          onClick={() =>
                            setSelection((old) => {
                              const next = { ...old };
                              if (Object.hasOwn(old, t.id)) delete next[t.id];
                              else next[t.id] = '';
                              return next;
                            })
                          }
                        >
                          {Object.hasOwn(selection, t.id) ? 'Selected' : 'Select'}
                        </button>
                      </div>
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
                              rule ? 'Use saved initiative' : 'Add a total before combat'
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
                <div className="wrap">
                  {!live && (
                    <button
                      disabled={operation.blocked || !validSelection}
                      onClick={() => void add(true)}
                    >
                      Prepare encounter
                    </button>
                  )}
                  <button
                    disabled={operation.blocked || !(setup ? validSelection : canAdd)}
                    onClick={() => void add()}
                  >
                    {live ? 'Add selected participants' : 'Start encounter'}
                  </button>
                </div>
              </details>
              <p className="small">
                Highest initiative goes first; arrows only break ties. Removing a combatant here
                leaves its token on the map.
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
  value: number | null;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
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
