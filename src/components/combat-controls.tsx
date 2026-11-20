'use client';

import { useEffect, useId, useState } from 'react';
import type { Actor, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { combatSummary, emptyCombat, type Combat } from '@/lib/combat';
import { boardEncounter } from '@/lib/encounter-view';
import { useCombatCommand } from './use-combat-command';

export function CombatControls({
  actor,
  snapshot,
  editable,
  blocked,
  run,
  onBusyChange,
  onRoll,
  showDeathSaves = false,
}: {
  actor: Actor;
  snapshot: Snapshot;
  editable: boolean;
  blocked: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onBusyChange: (busy: boolean) => void;
  onRoll?: (roll: { actorId: string; expression: string; rollType: string }) => Promise<void>;
  showDeathSaves?: boolean;
}) {
  const state = actor.combat ?? emptyCombat();
  const markerFormId = useId();
  const operation = useCombatCommand(actor, snapshot.userId, run);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<'manual' | 'start' | 'end'>('manual');
  const [round, setRound] = useState('');
  const [concentration, setConcentration] = useState('');
  const [concentrationNotes, setConcentrationNotes] = useState('');
  const encounter = boardEncounter(snapshot);
  const inEncounter =
    encounter &&
    encounter.status !== 'ended' &&
    encounter.participants.some((p) =>
      snapshot.tokens.some((t) => t.id === p.token_id && t.actor_id === actor.id),
    );
  const disabled = !editable || blocked || operation.blocked;
  useEffect(() => onBusyChange(operation.pending), [operation.pending, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const change = (edit: (next: Combat) => void) => {
    const next = structuredClone(state);
    edit(next);
    operation.commit(next);
  };
  return (
    <section className="stack" aria-label="Combat bookkeeping">
      <h3>Conditions & survival</h3>
      <p className="small" aria-label="Authorized combat summary">
        {combatSummary(actor) || 'No combat markers.'}
      </p>
      <p className="small">
        Private to sheet viewers. Prompts are reminders, not a rules engine. HP, death saves and
        concentration never reset automatically.
      </p>
      {state.conditions.map((condition) => (
        <div className="stack encounter-pick" key={condition.id}>
          <strong>{condition.name}</strong>
          {condition.source && <span>Source: {condition.source}</span>}
          {condition.notes && <span>Notes: {condition.notes}</span>}
          {condition.expiry && (
            <span>
              {condition.expiry.phase} of this actor’s turn, round {condition.expiry.round}. Other
              creatures’ turns and ambiguous durations: track manually.
              {condition.expiry.encounter_id !== encounter?.id || encounter?.status === 'ended'
                ? ' Original encounter is not active here; review manually.'
                : ''}
            </span>
          )}
          {condition.due && (
            <p role="status">
              Expiry review: remove {condition.name}, or keep it. No rule was resolved
              automatically.
            </p>
          )}
          <div className="wrap">
            <button
              disabled={disabled}
              onClick={() => {
                setEditing(condition.id);
                setName(condition.name);
                setSource(condition.source);
                setNotes(condition.notes);
                setPhase(condition.expiry?.phase ?? 'manual');
                setRound(condition.expiry?.round.toString() ?? '');
                document.getElementById(markerFormId)?.setAttribute('open', '');
              }}
            >
              Edit {condition.name}
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                change((next) => {
                  next.conditions = next.conditions.filter((c) => c.id !== condition.id);
                })
              }
            >
              Remove {condition.name}
            </button>
            {condition.expiry && (
              <button
                disabled={disabled}
                onClick={() =>
                  change((next) => {
                    const c = next.conditions.find((c) => c.id === condition.id)!;
                    c.expiry = null;
                    c.due = false;
                  })
                }
              >
                Keep {condition.name} until manual removal
              </button>
            )}
          </div>
        </div>
      ))}
      <details id={markerFormId}>
        <summary>
          {editing ? 'Edit condition / custom marker' : 'Add condition / custom marker'}
        </summary>
        <div className="stack">
          <label>
            Condition name
            <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Condition source
            <input maxLength={160} value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label>
            Condition notes
            <textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label>
            Expiry prompt
            <select value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)}>
              <option value="manual">Manual removal only</option>
              {inEncounter && (
                <>
                  <option value="start">Start of this actor’s turn</option>
                  <option value="end">End of this actor’s turn</option>
                </>
              )}
            </select>
          </label>
          {phase !== 'manual' && (
            <label>
              Expiry round
              <input
                type="number"
                min={encounter?.round ?? 1}
                max={1000000}
                step={1}
                value={round}
                onChange={(e) => setRound(e.target.value)}
              />
            </label>
          )}
          <button
            disabled={
              disabled ||
              !name.trim() ||
              (!editing && state.conditions.length >= 30) ||
              (phase !== 'manual' &&
                (!inEncounter ||
                  !Number.isInteger(Number(round)) ||
                  Number(round) < (encounter?.round ?? 1) ||
                  Number(round) > 1000000))
            }
            onClick={() =>
              change((next) => {
                const marker = {
                  id: editing ?? crypto.randomUUID(),
                  name: name.trim(),
                  source,
                  notes,
                  due: false,
                  expiry:
                    phase === 'manual'
                      ? null
                      : { encounter_id: encounter!.id, round: Number(round), phase },
                };
                if (editing)
                  next.conditions = next.conditions.map((c) => (c.id === editing ? marker : c));
                else next.conditions.push(marker);
              })
            }
          >
            {editing ? 'Save condition changes' : 'Add condition'}
          </button>
          {editing && (
            <button
              disabled={disabled}
              onClick={() => {
                setEditing(null);
                setName('');
                setSource('');
                setNotes('');
                setPhase('manual');
              }}
            >
              Cancel condition edit
            </button>
          )}
        </div>
      </details>
      <details open={!!state.concentration}>
        <summary>Concentration</summary>
        <div className="stack">
          {state.concentration ? (
            <>
              <strong>Concentrating: {state.concentration.source}</strong>
              {state.concentration.notes && <p>{state.concentration.notes}</p>}
              {state.concentration.checks.map((check) => (
                <div className="stack" key={check.id}>
                  <p role="status">
                    Constitution save suggested: DC {check.dc} after {check.damage} recorded
                    HP/temporary HP loss.
                  </p>
                  <p className="small">
                    Roll a Constitution save from the sheet. Override DC/rules manually; record the
                    outcome here.
                  </p>
                  <label>
                    Override concentration DC
                    <input
                      type="number"
                      min={10}
                      max={30}
                      step={1}
                      disabled={disabled}
                      value={check.dc}
                      onChange={(e) =>
                        change((next) => {
                          next.concentration!.checks.find((c) => c.id === check.id)!.dc = Number(
                            e.target.value,
                          );
                        })
                      }
                    />
                  </label>
                  <div className="wrap">
                    <button
                      disabled={disabled}
                      onClick={() =>
                        change((next) => {
                          next.concentration!.checks = next.concentration!.checks.filter(
                            (c) => c.id !== check.id,
                          );
                        })
                      }
                    >
                      Check passed / ignore reminder
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        change((next) => {
                          next.concentration = null;
                        })
                      }
                    >
                      Check failed — end concentration
                    </button>
                  </div>
                </div>
              ))}
              <button
                disabled={disabled}
                onClick={() =>
                  change((next) => {
                    next.concentration = null;
                  })
                }
              >
                End concentration manually
              </button>
            </>
          ) : (
            <>
              <label>
                Concentration source
                <input
                  maxLength={160}
                  value={concentration}
                  onChange={(e) => setConcentration(e.target.value)}
                />
              </label>
              <label>
                Concentration notes
                <textarea
                  maxLength={1000}
                  value={concentrationNotes}
                  onChange={(e) => setConcentrationNotes(e.target.value)}
                />
              </label>
              <button
                disabled={disabled || !concentration.trim()}
                onClick={() =>
                  change((next) => {
                    next.concentration = {
                      source: concentration.trim(),
                      notes: concentrationNotes,
                      checks: [],
                    };
                  })
                }
              >
                Start concentration
              </button>
            </>
          )}
          <p className="small">
            Checks are inferred from committed HP/temporary HP decreases, including manual edits.
            Resistance, overkill and separate damage sources are not inferred. Use the actual damage
            for adjudication (2024 DC: half damage rounded down, minimum 10, capped at 30). At 100
            pending reminders, additional losses are grouped into the last reminder; resolve them
            manually. At 0 HP, review incapacitation and end concentration if appropriate.
          </p>
        </div>
      </details>
      <details
        open={
          showDeathSaves ||
          state.death.successes > 0 ||
          state.death.failures > 0 ||
          state.death.stable
        }
      >
        <summary>Death saves & recovery</summary>
        <div className="stack">
          <p>
            {state.death.successes} successes / {state.death.failures} failures ·{' '}
            {state.death.failures >= 3
              ? 'Dead'
              : state.death.stable || state.death.successes >= 3
                ? 'Stable'
                : 'Not stabilized'}
          </p>
          <div className="wrap" role="group" aria-label="Roll and record death save">
            {onRoll && (
              <button
                disabled={disabled}
                onClick={() =>
                  void onRoll({
                    actorId: actor.id,
                    expression: '1d20',
                    rollType: 'Death saving throw — record outcome manually',
                  })
                }
              >
                Roll death save (d20)
              </button>
            )}
            <button
              disabled={disabled || state.death.successes >= 3}
              onClick={() =>
                change((next) => {
                  next.death.successes++;
                })
              }
            >
              Record success
            </button>
            <button
              disabled={disabled || state.death.failures >= 3}
              onClick={() =>
                change((next) => {
                  next.death.failures++;
                  next.death.stable = false;
                })
              }
            >
              Record failure
            </button>
          </div>
          <p className="small">
            {onRoll ? 'Record the result manually.' : 'Roll a d20 and record the result manually.'}{' '}
            Natural 1: record two failures. Natural 20: apply 1 HP with the health controls, then
            reset death saves below.
          </p>
          <details>
            <summary>Adjust or reset</summary>
            <div className="stack">
              <label>
                Manual successes
                <input
                  type="number"
                  min={0}
                  max={3}
                  step={1}
                  disabled={disabled}
                  value={state.death.successes}
                  onChange={(e) =>
                    change((next) => {
                      next.death.successes = Number(e.target.value);
                    })
                  }
                />
              </label>
              <label>
                Manual failures
                <input
                  type="number"
                  min={0}
                  max={3}
                  step={1}
                  disabled={disabled}
                  value={state.death.failures}
                  onChange={(e) =>
                    change((next) => {
                      next.death.failures = Number(e.target.value);
                    })
                  }
                />
              </label>
              <div className="wrap">
                <button
                  disabled={disabled}
                  onClick={() =>
                    change((next) => {
                      next.death = { successes: 0, failures: 0, stable: true };
                    })
                  }
                >
                  Stabilize — reset death saves
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    change((next) => {
                      next.death = emptyCombat().death;
                    })
                  }
                >
                  Recovered / revived — reset death saves
                </button>
              </div>
              <p className="small">
                Resetting death saves does not heal, revive, remove conditions, or end
                concentration. Monster death is not automatic.
              </p>
            </div>
          </details>
        </div>
      </details>
      <p role="status">{operation.message}</p>
      {operation.uncertain && (
        <div className="wrap">
          <button disabled={!editable || blocked || operation.busy} onClick={operation.retry}>
            Retry combat change
          </button>
          <button disabled={operation.busy} onClick={operation.dismiss}>
            Dismiss combat attempt
          </button>
        </div>
      )}
    </section>
  );
}
