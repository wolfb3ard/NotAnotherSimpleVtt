'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { DndSheet } from './dnd-sheet';
import { SrdBuilder } from './srd-builder';
import { TokenAppearanceEditor } from './token-appearance-editor';
import { TokenPortrait } from './token-portrait';
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
import { QuickResources } from './quick-resources';
import type { ResourceWriter } from '@/lib/resource-writer';
import { monsterId, monsterSourceId } from '@/lib/monster-sheet';
import { tableSystem } from '@/lib/table-system';
import { PlayInventory } from './play-inventory';
import type { changeInventory } from '@/lib/inventory-play';

const MonsterSheet = dynamic(() => import('./monster-sheet'));

type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
export function SheetEditor({
  actor,
  snapshot,
  run,
  onRoll,
  onDirtyChange,
  initialBuilderOpen,
  externalBusy = false,
}: {
  actor: Actor;
  snapshot: Snapshot;
  run: Run;
  onRoll: (actorId: string, expression: string, rollType?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialBuilderOpen?: boolean;
  externalBusy?: boolean;
}) {
  const [sheet, setSheet] = useState<Sheet>(() => structuredClone(actor.sheet));
  const [name, setName] = useState(actor.name);
  const [savedRevision, setSavedRevision] = useState(actor.revision);
  const conflict = actor.revision > savedRevision;
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playNotice, setPlayNotice] = useState('');
  const [itemName, setItemName] = useState('');
  async function inventoryChange(action: Parameters<typeof changeInventory>[1]) {
    try {
      const system = tableSystem(snapshot.game);
      const result = system.changeInventory(sheet, action);
      const before = system.armorClass(sheet),
        after = system.armorClass(result.sheet);
      return await commitPlay(
        result.sheet,
        `${result.message}${before !== after ? ` · AC ${before} → ${after}` : ''}`,
      );
    } catch (e) {
      setPlayNotice((e as Error).message);
      return false;
    }
  }
  async function commitPlay(next: Sheet, message: string) {
    if (!editable || saving || resourceBusy || externalBusy || conflict || dirty) return false;
    setSaving(true);
    try {
      if (
        !(await run('actor_save', { id: actor.id, name, sheet: next, revision: savedRevision }))
      ) {
        setPlayNotice('Change not confirmed. Check the latest sheet before retrying.');
        return false;
      }
      setSheet(next);
      setSavedRevision(savedRevision + 1);
      setPlayNotice(message);
      return true;
    } finally {
      setSaving(false);
    }
  }
  const [resourceBusy, setResourceBusy] = useState(false);
  const resourceWriter = useRef<ResourceWriter | null>(null);
  const [customize, setCustomize] = useState(false);
  const [accessPending, setAccessPending] = useState(false);
  const accessRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    onDirtyChange?.(dirty || resourceBusy);
  }, [dirty, resourceBusy, onDirtyChange]);
  // Reconcile clean editors only; configuration drafts retain their revision/conflict guard.
  if (!dirty && !saving && !resourceBusy && actor.revision > savedRevision) {
    setSheet(structuredClone(actor.sheet));
    setName(actor.name);
    setSavedRevision(actor.revision);
  }
  const dnd = isDndSheet(sheet);
  const monster = !!monsterId(sheet);
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
      <QuickResources
        controls={false}
        actor={actor}
        editable={editable}
        blocked={dirty || saving}
        run={run}
        onBusyChange={setResourceBusy}
        writerRef={resourceWriter}
        onCommitted={(nextSheet, revision, latestName) => {
          setSheet(structuredClone(nextSheet));
          setSavedRevision(revision);
          if (latestName !== undefined) setName(latestName);
        }}
      />
      {externalBusy && (
        <p role="status">
          Token quick actions saving or unconfirmed. Resolve them before editing this sheet.
        </p>
      )}
      {playNotice && <p role="status">{playNotice}</p>}
      <fieldset
        className="sheet-configuration stack"
        disabled={resourceBusy || saving || externalBusy}
      >
        {conflict && (
          <div className="notice" role="alert">
            This sheet changed. Reload to get the latest version.{' '}
            {dirty && 'Your unsaved edits will be replaced.'}
            <button onClick={reload}>Reload sheet</button>
          </div>
        )}
        <details className="sheet-tools" open={initialBuilderOpen || undefined}>
          <summary>Character settings & tools</summary>
          <div className="stack">
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
            <details>
              <summary>Portrait & token appearance</summary>
              <TokenAppearanceEditor
                key={`${actor.id}-${actor.appearance_revision ?? 0}`}
                actor={actor}
                snapshot={snapshot}
                run={run}
              />
              {actor.encounter_instance && (
                <p className="small">
                  {actor.appearance_source_id
                    ? 'Appearance follows the source definition. Saving appearance here creates an instance override.'
                    : 'This creature has its own appearance; changing it does not change other creatures.'}
                </p>
              )}
            </details>
            {(snapshot.role === 'gm' || actor.owner_id === snapshot.userId) && (
              <button
                className="danger"
                disabled={saving}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Permanently delete ${actor.name} and all their tokens? This cannot be undone. Past rolls and saved templates will remain.`,
                    )
                  )
                    return;
                  setSaving(true);
                  try {
                    await run('actor_delete', { id: actor.id, revision: savedRevision });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Delete character
              </button>
            )}
            {dnd && (
              <>
                <div className="row sheet-mode">
                  <strong>5.5e · Character sheet</strong>
                </div>
                <SrdBuilder
                  commit={
                    dirty
                      ? undefined
                      : (next) => commitPlay(next, 'Character progression saved to the table.')
                  }
                  sheet={sheet}
                  editable={editable && !conflict}
                  update={update}
                  initialOpen={initialBuilderOpen}
                />
                <details className="sheet-help">
                  <summary>Rules guidance & SRD attribution</summary>
                  <p>
                    Edit character details directly on the sheet. The optional builder manages class
                    progression and calculates level and ability scores. For manual control of those
                    values, switch to manual progression. Conditional effects still require
                    reviewing the source rules.
                  </p>
                  <p>
                    Weapon attacks add the chosen ability and proficiency; damage never adds
                    proficiency. For spell damage, choose “No” for adding ability unless a feature
                    allows it.
                  </p>
                  <small>
                    This work includes material from the System Reference Document 5.2.1 (“SRD
                    5.2.1”) by Wizards of the Coast LLC, available at{' '}
                    <a href="https://www.dndbeyond.com/srd">dndbeyond.com/srd</a>. The SRD 5.2.1 is
                    licensed under the Creative Commons Attribution 4.0 International License,
                    available at{' '}
                    <a href="https://creativecommons.org/licenses/by/4.0/legalcode">CC BY 4.0</a>.
                    Adapted as an interactive template.
                  </small>
                </details>
              </>
            )}
          </div>
        </details>
        {((!dnd && !monster) || customize) && (
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
        {monster && customize && (
          <button onClick={() => setCustomize(false)}>Done editing monster</button>
        )}
        {monster && !customize ? (
          <MonsterSheet
            inventory={
              <div className="stack">
                <p>
                  Printed AC already includes normal gear. Add a Shield here only if the creature
                  can gain the extra +2 AC; shields do not stack. Equipped weapons and armor are
                  recorded here without changing the monster’s printed attacks or defenses.
                </p>
                <PlayInventory
                  sheet={sheet}
                  disabled={!editable || dirty || conflict}
                  onChange={inventoryChange}
                />
                {editable && (
                  <div className="wrap">
                    <label>
                      Item name
                      <input
                        maxLength={80}
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={dirty || conflict || !itemName.trim()}
                      onClick={async () => {
                        if (
                          await inventoryChange({
                            type: 'add',
                            id: crypto.randomUUID(),
                            name: itemName,
                          })
                        )
                          setItemName('');
                      }}
                    >
                      Add item
                    </button>
                  </div>
                )}
              </div>
            }
            name={name}
            onCustomize={() => setCustomize(true)}
            portrait={
              <TokenPortrait name={name} assetId={actor.token_asset_id} ring={actor.token_ring} />
            }
            sheet={sheet}
            editable={editable}
            rollable={rollable}
            blocked={dirty || conflict || saving || resourceBusy || externalBusy}
            quickEditable={
              editable && !dirty && !conflict && !saving && !resourceBusy && !externalBusy
            }
            quickUpdate={(changes) => resourceWriter.current?.enqueue(changes)}
            onRoll={(expression, label) => onRoll(actor.id, expression, label)}
          />
        ) : dnd ? (
          <DndSheet
            onUseItem={(id) => void inventoryChange({ type: 'use', id })}
            onEquip={(id) => void inventoryChange({ type: 'toggle', id })}
            portrait={
              <TokenPortrait name={name} assetId={actor.token_asset_id} ring={actor.token_ring} />
            }
            name={name}
            onNameChange={(value) => {
              setName(value);
              setDirty(true);
            }}
            sheet={sheet}
            editable={editable}
            rollable={rollable}
            dirty={dirty || conflict}
            update={update}
            quickEditable={editable && !dirty && !saving && !resourceBusy}
            quickUpdate={(changes) => resourceWriter.current?.enqueue(changes)}
            onRoll={(expression, rollType) => onRoll(actor.id, expression, rollType)}
          />
        ) : (
          sheet.sections.map((section, si) => (
            <section className="sheet-section" key={section.id}>
              {monster ? (
                <h3>{section.title}</h3>
              ) : (
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
                            [s.sections[si - 1], s.sections[si]] = [
                              s.sections[si],
                              s.sections[si - 1],
                            ];
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
              )}
              {section.fields.map((field, fi) => (
                <div className="sheet-field" key={field.id}>
                  {monster ? (
                    <strong>{field.label}</strong>
                  ) : (
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
                  )}
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
                        disabled={!editable || field.id === monsterSourceId}
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
                if (dnd && ability.id === dndId('roll:initiative'))
                  ability.expression = `1d20 + @{${dndId('initiative')}}`;
                if (dnd)
                  for (let i = 0; i < 3; i++) {
                    const critical = ability.id === dndId(`roll:weapon-critical:${i}`);
                    if (
                      critical ||
                      ability.id === dndId(`roll:weapon-damage:${i}`) ||
                      ability.id === dndId(`roll:weapon-hit:${i}`)
                    ) {
                      const weapon = sheet.sections
                        .flatMap((s) => s.fields)
                        .find((f) => f.id === dndId(`weapon-name:${i}`))?.value;
                      ability.name = `${critical ? 'Critical damage' : ability.id === dndId(`roll:weapon-hit:${i}`) ? 'Attack roll' : 'Damage'} with ${weapon || 'unnamed attack'}`;
                    }
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
                            disabled={dirty || conflict || !ability.expression}
                            onClick={() => onRoll(actor.id, ability.expression, ability.name)}
                          >
                            ◇ Roll
                          </button>
                          {d20 && (
                            <>
                              <button
                                disabled={dirty || conflict}
                                onClick={() =>
                                  onRoll(
                                    actor.id,
                                    ability.expression.replace('1d20', '2d20kh1'),
                                    ability.name,
                                  )
                                }
                              >
                                Advantage
                              </button>
                              <button
                                disabled={dirty || conflict}
                                onClick={() =>
                                  onRoll(
                                    actor.id,
                                    ability.expression.replace('1d20', '2d20kl1'),
                                    ability.name,
                                  )
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
                      {editable && !monster && (
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
                        disabled={dirty || conflict}
                        onClick={() => onRoll(actor.id, ability.expression, ability.name)}
                      >
                        ◇ Roll
                      </button>
                    )}
                  </div>
                );
              })}
              {editable && !monster && (
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
            <span className="sheet-save-status" role="status">
              {resourceBusy
                ? 'Resource update saving or unconfirmed — see status above'
                : conflict
                  ? 'New version available — reload sheet'
                  : dirty
                    ? 'Unsaved changes'
                    : 'All changes saved'}
            </span>
            {!dnd && !monster && (
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
              disabled={!dirty || saving || conflict}
              onClick={async () => {
                setSaving(true);
                try {
                  const next =
                    sheet.character?.builder &&
                    JSON.stringify(sheet.character.items) !==
                      JSON.stringify(actor.sheet.character?.items)
                      ? tableSystem(snapshot.game).applyProgression(sheet, sheet.character.builder)
                      : sheet;
                  const data = await run('actor_save', {
                    id: actor.id,
                    name,
                    sheet: next,
                    revision: savedRevision,
                  });
                  if (data) {
                    setSheet(next);
                    setSavedRevision(savedRevision + 1);
                    setDirty(false);
                  }
                } catch (e) {
                  setPlayNotice((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Save sheet'}
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
      </fieldset>
    </div>
  );
}
