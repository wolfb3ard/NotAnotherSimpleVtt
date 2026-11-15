'use client';
import { useEffect, useRef, useState } from 'react';
import { DndSheet } from './dnd-sheet';
import type { Actor, Sheet, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import {
  createDndSheet,
  dndDamageExpression,
  dndFieldOptions,
  dndId,
  dndNumbers,
  isDndSheet,
} from '@/lib/dnd';
import { numericFields } from '@/lib/sheets';

type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
export function SheetEditor({
  actor,
  snapshot,
  run,
  onRoll,
  onDirtyChange,
}: {
  actor: Actor;
  snapshot: Snapshot;
  run: Run;
  onRoll: (actorId: string, expression: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(() => structuredClone(actor.sheet));
  const [name, setName] = useState(actor.name);
  const [savedRevision, setSavedRevision] = useState(actor.revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [accessPending, setAccessPending] = useState(false);
  const accessRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const dnd = isDndSheet(sheet);
  const computed = dndNumbers(sheet);
  const builtInRolls = new Set(
    dnd ? createDndSheet().sections.flatMap((s) => s.abilities.map((a) => a.id)) : [],
  );
  const fields = numericFields(sheet);
  const editable =
    snapshot.role === 'gm' ||
    actor.owner_id === snapshot.userId ||
    snapshot.grants.some(
      (g) => g.actor_id === actor.id && g.user_id === snapshot.userId && g.can_edit,
    );
  const rollable =
    snapshot.role === 'gm' ||
    actor.owner_id === snapshot.userId ||
    snapshot.tokens.some((t) => t.actor_id === actor.id && t.controller_id === snapshot.userId);
  function update(edit: (s: Sheet) => void) {
    const copy = structuredClone(sheet);
    edit(copy);
    setSheet(copy);
    setDirty(true);
  }
  function reload() {
    setSheet(structuredClone(actor.sheet));
    setName(actor.name);
    setSavedRevision(actor.revision);
    setDirty(false);
  }
  return (
    <div className="stack sheet-editor">
      <div className="row">
        <span className="eyebrow">{actor.kind} sheet</span>
        <span className="badge">{editable ? 'Can edit' : 'Read only'}</span>
        {snapshot.role === 'gm' && (
          <button
            className="ghost"
            onClick={() => {
              if (accessRef.current) {
                accessRef.current.open = true;
                accessRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }
            }}
          >
            Manage sheet access
          </button>
        )}
      </div>
      {actor.revision !== savedRevision && (
        <div className="notice">
          This sheet changed. Reload to get the latest version.{' '}
          {dirty && 'Your unsaved edits will be replaced.'}
          <button onClick={reload}>Reload sheet</button>
        </div>
      )}
      {(!dnd || customize) && (
        <label>
          Name
          <input
            value={name}
            disabled={!editable}
            maxLength={100}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      )}
      {dnd && (
        <>
          <div className="row sheet-mode">
            <strong>5.5e · Character sheet</strong>
            <button aria-pressed={customize} onClick={() => setCustomize(!customize)}>
              {customize ? 'Character sheet layout' : 'Customize sheet'}
            </button>
          </div>
          <details className="sheet-help">
            <summary>Rules guidance & SRD attribution</summary>
            <p>
              Modifiers update from level, scores, and selected proficiencies. Configure class
              features, equipment, spell slots, and situational bonuses yourself. Save changes
              before rolling.
            </p>
            <p>
              Weapon attacks add the chosen ability and proficiency; damage never adds proficiency.
              For spell damage, choose “No” for adding ability unless a feature allows it.
            </p>
            <small>
              This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by
              Wizards of the Coast LLC, available at{' '}
              <a href="https://www.dndbeyond.com/srd">dndbeyond.com/srd</a>. The SRD 5.2.1 is
              licensed under the Creative Commons Attribution 4.0 International License, available
              at <a href="https://creativecommons.org/licenses/by/4.0/legalcode">CC BY 4.0</a>.
              Adapted as an interactive template.
            </small>
          </details>
        </>
      )}
      {dnd && !customize ? (
        <DndSheet
          name={name}
          onNameChange={(value) => {
            setName(value);
            setDirty(true);
          }}
          sheet={sheet}
          editable={editable}
          rollable={rollable}
          dirty={dirty || actor.revision !== savedRevision}
          update={update}
          onRoll={(expression) => onRoll(actor.id, expression)}
        />
      ) : (
        sheet.sections.map((section, si) => (
          <section className="sheet-section" key={section.id}>
            <div className="row">
              <input
                aria-label="Section title"
                className="section-title"
                value={section.title}
                disabled={!editable}
                onChange={(e) =>
                  update((s) => {
                    s.sections[si].title = e.target.value;
                  })
                }
              />
              {editable && (
                <>
                  <button
                    title="Move section up"
                    disabled={si === 0}
                    onClick={() =>
                      update((s) => {
                        [s.sections[si - 1], s.sections[si]] = [s.sections[si], s.sections[si - 1]];
                      })
                    }
                  >
                    ↑
                  </button>
                  {!dnd && (
                    <button
                      aria-label={`Delete ${section.title} section`}
                      onClick={() =>
                        update((s) => {
                          s.sections.splice(si, 1);
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </>
              )}
            </div>
            {section.fields.map((field, fi) => (
              <div className="sheet-field" key={field.id}>
                <div className="row">
                  <input
                    aria-label="Field label"
                    placeholder="Field name"
                    value={field.label}
                    disabled={!editable}
                    onChange={(e) =>
                      update((s) => {
                        s.sections[si].fields[fi].label = e.target.value;
                      })
                    }
                  />
                  {editable && !dnd && (
                    <button
                      aria-label={`Delete ${field.label}`}
                      onClick={() =>
                        update((s) => {
                          s.sections[si].fields.splice(fi, 1);
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="row">
                  {dnd && dndFieldOptions(field.id) ? (
                    <select
                      aria-label={field.label}
                      value={field.value}
                      disabled={!editable}
                      onChange={(e) =>
                        update((s) => {
                          s.sections[si].fields[fi].value = Number(e.target.value);
                        })
                      }
                    >
                      {dndFieldOptions(field.id)!.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.kind === 'text' ? (
                    <textarea
                      aria-label={field.label}
                      value={field.value}
                      disabled={!editable}
                      onChange={(e) =>
                        update((s) => {
                          s.sections[si].fields[fi].value = e.target.value;
                        })
                      }
                    />
                  ) : (
                    <>
                      <input
                        aria-label={field.label}
                        type="number"
                        value={computed[field.id] ?? field.value}
                        disabled={!editable || Object.hasOwn(computed, field.id)}
                        onChange={(e) =>
                          update((s) => {
                            s.sections[si].fields[fi].value = Number(e.target.value);
                          })
                        }
                      />
                      {field.kind === 'resource' && (
                        <>
                          <span>/</span>
                          <input
                            aria-label={`${field.label} maximum`}
                            type="number"
                            min={0}
                            value={field.max ?? 0}
                            disabled={!editable}
                            onChange={(e) =>
                              update((s) => {
                                s.sections[si].fields[fi].max = Number(e.target.value);
                              })
                            }
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {section.abilities.map((savedAbility, ai) => {
              const ability = { ...savedAbility };
              if (dnd)
                for (let i = 0; i < 3; i++) {
                  const critical = ability.id === dndId(`roll:weapon-critical:${i}`);
                  if (critical || ability.id === dndId(`roll:weapon-damage:${i}`)) {
                    const dice = sheet.sections
                      .flatMap((s) => s.fields)
                      .find((f) => f.id === dndId(`weapon-dice:${i}`));
                    try {
                      ability.expression = dndDamageExpression(String(dice?.value), i, critical);
                    } catch {
                      ability.expression = '';
                    }
                  }
                }
              if (builtInRolls.has(ability.id)) {
                const resolved = ability.expression.replace(/@\{([^}]+)\}/g, (_, id: string) =>
                  String(fields[id] ?? '?'),
                );
                const d20 = ability.expression.startsWith('1d20');
                return (
                  <div className="ability stack" key={ability.id}>
                    <strong>{ability.name}</strong>
                    <code>{resolved || 'Enter valid damage dice, e.g. 2d6'}</code>
                    {rollable && (
                      <div className="wrap">
                        <button
                          disabled={
                            dirty || actor.revision !== savedRevision || !ability.expression
                          }
                          onClick={() => onRoll(actor.id, ability.expression)}
                        >
                          ◇ Prepare roll
                        </button>
                        {d20 && (
                          <>
                            <button
                              disabled={dirty || actor.revision !== savedRevision}
                              onClick={() =>
                                onRoll(actor.id, ability.expression.replace('1d20', '2d20kh1'))
                              }
                            >
                              Advantage
                            </button>
                            <button
                              disabled={dirty || actor.revision !== savedRevision}
                              onClick={() =>
                                onRoll(actor.id, ability.expression.replace('1d20', '2d20kl1'))
                              }
                            >
                              Disadvantage
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div className="ability" key={ability.id}>
                  <div className="row">
                    <input
                      aria-label="Ability name"
                      placeholder="Ability name"
                      value={ability.name}
                      disabled={!editable}
                      onChange={(e) =>
                        update((s) => {
                          s.sections[si].abilities[ai].name = e.target.value;
                        })
                      }
                    />
                    {editable && (
                      <button
                        aria-label={`Delete ${ability.name}`}
                        onClick={() =>
                          update((s) => {
                            s.sections[si].abilities.splice(ai, 1);
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <textarea
                    aria-label={`${ability.name} description`}
                    placeholder="What does this ability do?"
                    value={ability.description}
                    disabled={!editable}
                    onChange={(e) =>
                      update((s) => {
                        s.sections[si].abilities[ai].description = e.target.value;
                      })
                    }
                  />
                  <input
                    aria-label={`${ability.name} expression`}
                    placeholder="Roll expression, e.g. 1d20 + 3"
                    value={ability.expression}
                    disabled={!editable}
                    onChange={(e) =>
                      update((s) => {
                        s.sections[si].abilities[ai].expression = e.target.value;
                      })
                    }
                  />
                  {editable && (
                    <select
                      aria-label="Insert sheet modifier"
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          update((s) => {
                            s.sections[si].abilities[ai].expression += ` + @{${e.target.value}}`;
                          });
                      }}
                    >
                      <option value="">+ Insert numeric field…</option>
                      {sheet.sections
                        .flatMap((s) => s.fields)
                        .filter((f) => f.kind !== 'text')
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  )}
                  {rollable && ability.expression && (
                    <button
                      disabled={dirty || actor.revision !== savedRevision}
                      onClick={() => onRoll(actor.id, ability.expression)}
                    >
                      ◇ Prepare roll
                    </button>
                  )}
                </div>
              );
            })}
            {editable && (
              <div className="wrap">
                <select
                  aria-label="Add field"
                  value=""
                  onChange={(e) => {
                    const kind = e.target.value as 'text' | 'number' | 'resource';
                    if (kind)
                      update((s) => {
                        s.sections[si].fields.push({
                          id: crypto.randomUUID(),
                          label: kind === 'resource' ? 'Resource' : 'New field',
                          kind,
                          value: kind === 'text' ? '' : 0,
                          ...(kind === 'resource' ? { max: 1 } : {}),
                        });
                      });
                  }}
                >
                  <option value="">+ Add field…</option>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="resource">Resource counter</option>
                </select>
                <button
                  onClick={() =>
                    update((s) => {
                      s.sections[si].abilities.push({
                        id: crypto.randomUUID(),
                        name: 'New ability',
                        description: '',
                        expression: '',
                      });
                    })
                  }
                >
                  + Ability
                </button>
              </div>
            )}
          </section>
        ))
      )}
      {editable && (
        <div className="sheet-save-bar wrap">
          {(!dnd || customize) && (
            <button
              onClick={() =>
                update((s) => {
                  s.sections.push({
                    id: crypto.randomUUID(),
                    title: 'New section',
                    fields: [],
                    abilities: [],
                  });
                })
              }
            >
              + Add section
            </button>
          )}
          <button
            className="primary"
            disabled={!dirty || saving || actor.revision !== savedRevision}
            onClick={async () => {
              setSaving(true);
              const data = await run('actor_save', {
                id: actor.id,
                name,
                sheet,
                revision: savedRevision,
              });
              if (data) {
                setSavedRevision(savedRevision + 1);
                setDirty(false);
              }
              setSaving(false);
            }}
          >
            {saving ? 'Saving…' : 'Save sheet'}
          </button>
          <button
            disabled={dirty}
            onClick={() => run('template_create', { actor_id: actor.id, name: `${name} template` })}
          >
            Save as reusable template
          </button>
        </div>
      )}
      {snapshot.role === 'gm' && (
        <details ref={accessRef} className="sheet-access">
          <summary>Sheet permissions</summary>
          <div className="stack">
            <p className="small">
              The GM always has full access. The owner can edit and roll. Other members have no
              access unless granted below.
            </p>
            <label>
              Sheet owner
              <select
                aria-label="Sheet owner"
                value={actor.owner_id}
                disabled={accessPending || dirty}
                onChange={async (e) => {
                  const owner = e.target.value;
                  if (
                    !window.confirm(
                      'Transfer ownership? The former owner loses access unless you grant it again. Their assigned tokens transfer too.',
                    )
                  )
                    return;
                  setAccessPending(true);
                  try {
                    await run('actor_owner', {
                      actor_id: actor.id,
                      owner_id: owner,
                      revision: actor.revision,
                    });
                  } finally {
                    setAccessPending(false);
                  }
                }}
              >
                {snapshot.members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </label>
            {snapshot.members
              .filter((m) => m.user_id !== actor.owner_id && m.role !== 'gm')
              .map((member) => {
                const grant = snapshot.grants.find(
                  (g) => g.actor_id === actor.id && g.user_id === member.user_id,
                );
                return (
                  <label key={member.user_id}>
                    {member.display_name}
                    <select
                      aria-label={`${member.display_name} sheet access`}
                      disabled={accessPending}
                      value={grant ? (grant.can_edit ? 'edit' : 'view') : 'none'}
                      onChange={async (e) => {
                        setAccessPending(true);
                        try {
                          await run('grant', {
                            actor_id: actor.id,
                            user_id: member.user_id,
                            access: e.target.value,
                          });
                        } finally {
                          setAccessPending(false);
                        }
                      }}
                    >
                      <option value="none">No access</option>
                      <option value="view">View only</option>
                      <option value="edit">View and edit</option>
                    </select>
                  </label>
                );
              })}
          </div>
        </details>
      )}
    </div>
  );
}
