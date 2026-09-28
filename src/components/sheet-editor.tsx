'use client';
import { useState } from 'react';
import type { Actor, Sheet, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';

type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
export function SheetEditor({
  actor,
  snapshot,
  run,
  onRoll,
}: {
  actor: Actor;
  snapshot: Snapshot;
  run: Run;
  onRoll: (actorId: string, expression: string) => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(() => structuredClone(actor.sheet));
  const [name, setName] = useState(actor.name);
  const [savedRevision, setSavedRevision] = useState(actor.revision);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
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
      </div>
      {actor.revision !== savedRevision && (
        <div className="notice">
          This sheet changed. Reload to get the latest version.{' '}
          {dirty && 'Your unsaved edits will be replaced.'}
          <button onClick={reload}>Reload sheet</button>
        </div>
      )}
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
      {sheet.sections.map((section, si) => (
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
                {editable && (
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
                {field.kind === 'text' ? (
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
                      value={field.value}
                      disabled={!editable}
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
          {section.abilities.map((ability, ai) => (
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
                <button disabled={dirty} onClick={() => onRoll(actor.id, ability.expression)}>
                  ◇ Prepare roll
                </button>
              )}
            </div>
          ))}
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
      ))}
      {editable && (
        <>
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
        </>
      )}
      {snapshot.role === 'gm' && (
        <details>
          <summary>Sheet permissions</summary>
          <div className="stack">
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
                      value={grant ? (grant.can_edit ? 'edit' : 'view') : 'none'}
                      onChange={(e) =>
                        run('grant', {
                          actor_id: actor.id,
                          user_id: member.user_id,
                          access: e.target.value,
                        })
                      }
                    >
                      <option value="none">No access</option>
                      <option value="view">View</option>
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
