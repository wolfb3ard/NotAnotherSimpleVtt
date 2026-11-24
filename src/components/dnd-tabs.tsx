'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  actionTypes,
  emptyCharacterDetails,
  rarities,
  type CharacterDetails,
} from '@/lib/character-details';
import { dndId } from '@/lib/dnd';
import type { Sheet } from '@/lib/types';
import { srdCastingSources } from '@/lib/srd-casting';
import { dndNumbers } from '@/lib/dnd';
import type { QuickUpdate } from '@/lib/resources';
import { castChoices } from '@/lib/play-assistance';
import { PlayInventory } from './play-inventory';
import { SrdEquipmentSummary } from './srd-equipment-controls';
import { DndRulesText, spellRules } from './dnd-rules-text';

const tabs = [
  'Actions',
  'Spell',
  'Abilities',
  'Inventory',
  'Features & Traits',
  'Biography',
] as const;
type Tab = (typeof tabs)[number];
type Props = {
  playing?: boolean;
  onEquip?: (id: string) => void;
  onUseItem?: (id: string) => void;
  sheet: Sheet;
  editable: boolean;
  rollable: boolean;
  dirty: boolean;
  update: (edit: (sheet: Sheet) => void) => void;
  onRoll: (expression: string, rollType?: string) => void;
  d20?: string;
  input: (key: string, label?: string, multiline?: boolean) => ReactNode;
  spellAttack: ReactNode;
  abilityPanel: ReactNode;
  children: ReactNode;
  quickUpdate?: QuickUpdate;
  quickEditable?: boolean;
};

export function DndTabs({
  playing,
  onEquip,
  onUseItem,
  sheet,
  editable,
  rollable,
  dirty,
  update,
  onRoll,
  d20 = '1d20',
  input,
  spellAttack,
  abilityPanel,
  children,
  quickUpdate,
  quickEditable = editable,
}: Props) {
  const [tab, setTab] = useState<Tab>('Actions');
  const [castPractice, setCastPractice] = useState('');
  const id = useId();
  const details = sheet.character ?? emptyCharacterDetails();
  const castingSources = details.builder ? srdCastingSources(details.builder) : [];
  const computed = dndNumbers(sheet);
  const attunementLimit =
    (details.builder?.levels.filter((level) => level.className === 'Rogue').length ?? 0) >= 13
      ? 4
      : 3;
  function edit(fn: (details: CharacterDetails) => void) {
    if (!editable) return;
    update((copy) => {
      copy.character ??= emptyCharacterDetails();
      fn(copy.character);
    });
  }
  function text(label: string, value: string, change: (value: string) => void, multiline = false) {
    return (
      <label>
        {label}
        {multiline ? (
          <textarea
            aria-label={label}
            value={value}
            maxLength={4000}
            disabled={!editable}
            onChange={(e) => change(e.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            value={value}
            maxLength={80}
            disabled={!editable}
            onChange={(e) => change(e.target.value)}
          />
        )}
      </label>
    );
  }
  function select(
    label: string,
    value: string,
    options: readonly string[],
    change: (value: string) => void,
  ) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={!editable}
          onChange={(e) => change(e.target.value)}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }
  function number(label: string, value: number, change: (value: number) => void, max = 999) {
    return (
      <label>
        {label}
        <input
          aria-label={label}
          type="number"
          min={0}
          max={max}
          step={1}
          value={value}
          disabled={!editable}
          onChange={(e) => change(Math.max(0, Math.min(max, Math.trunc(Number(e.target.value)))))}
        />
      </label>
    );
  }
  function check(
    label: string,
    value: boolean,
    change: (value: boolean) => void,
    disabled = false,
  ) {
    return (
      <label className="dnd-check">
        <input
          aria-label={label}
          type="checkbox"
          checked={value}
          disabled={!editable || disabled}
          onChange={(e) => change(e.target.checked)}
        />
        {label}
      </label>
    );
  }
  function uses(feature: CharacterDetails['features'][number]) {
    return (
      <div className="dnd-rules-buttons" role="group" aria-label={`${feature.name} uses`}>
        <button
          disabled={!editable || !quickEditable || feature.uses === 0}
          onClick={() =>
            quickUpdate
              ? quickUpdate([{ id: feature.id, value: feature.uses - 1, target: 'feature' }])
              : edit((d) => {
                  d.features.find((f) => f.id === feature.id)!.uses--;
                })
          }
        >
          Use {feature.name}
        </button>
        <button
          disabled={!editable || !quickEditable || feature.uses === feature.maxUses}
          onClick={() =>
            quickUpdate
              ? quickUpdate([{ id: feature.id, value: feature.uses + 1, target: 'feature' }])
              : edit((d) => {
                  d.features.find((f) => f.id === feature.id)!.uses++;
                })
          }
        >
          Recover {feature.name}
        </button>
      </div>
    );
  }
  function usesRemaining(feature: CharacterDetails['features'][number]) {
    return `${feature.uses} / ${feature.maxUses} uses remaining`;
  }
  function featureCard(feature: CharacterDetails['features'][number], compact = false) {
    return (
      <article
        className={`dnd-box dnd-rules-card${compact ? ' dnd-action-row' : ''}`}
        key={feature.id}
      >
        <h4>{feature.name}</h4>
        <p className="small muted dnd-rules-meta">
          {feature.actionType} · {feature.source === 'Class' ? 'Class feature' : feature.source}
          {feature.maxUses > 0 && ` · ${usesRemaining(feature)}`}
        </p>
        {compact ? (
          <details>
            <summary>Rules</summary>
            <DndRulesText description={feature.description} feature />
          </details>
        ) : (
          <DndRulesText description={feature.description} feature />
        )}
        {feature.maxUses > 0 && uses(feature)}
      </article>
    );
  }
  const spells = [...details.spells].sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name),
  );
  const options = (spell: CharacterDetails['spells'][number]) =>
    spell.level ? castChoices(sheet, spell).filter((c) => c.key !== 'manual') : [];
  function spellCard(spell: CharacterDetails['spells'][number], compact = false) {
    const choices = options(spell);
    const canCast = spell.level === 0 || spell.prepared;
    const sources = canCast
      ? (spell.casting ?? []).flatMap((casting) =>
          castingSources.filter((source) => source.id === casting.sourceId),
        )
      : [];
    const hasAttack = /spell attack/i.test(spell.description);
    const rules = spellRules(spell.description);
    return (
      <article
        className={`dnd-box dnd-rules-card${compact ? ' dnd-action-row' : ''}`}
        key={spell.id}
      >
        <h4>
          {spell.name} · {spell.level ? `Level ${spell.level}` : 'Cantrip'}
        </h4>
        <p className="small muted dnd-rules-meta">
          {rules.school ?? spell.actionType}
          {!canCast && ' · Not prepared'}
          {compact &&
            rules.facts?.filter((fact) => fact.label === 'Range').map(({ value }) => ` · ${value}`)}
        </p>
        {compact ? (
          <details>
            <summary>Spell rules</summary>
            <DndRulesText description={spell.description} hideSpellSchool />
          </details>
        ) : (
          <DndRulesText description={spell.description} hideSpellSchool />
        )}
        {sources.length > 0 && (
          <p className="small">
            {sources
              .map((source) => `${source.label} · Save DC ${computed[dndId(source.dcKey)]}`)
              .join(' / ')}
          </p>
        )}
        {(choices.length > 0 || !spell.level || (hasAttack && sources.length > 0)) && (
          <div className="dnd-rules-buttons" role="group" aria-label={`${spell.name} actions`}>
            {choices.map((c) => (
              <button
                key={c.key}
                disabled={
                  !rollable ||
                  !c.available ||
                  dirty ||
                  (c.changes.length > 0 && (!quickUpdate || !quickEditable))
                }
                onClick={() => {
                  if (c.changes.length) quickUpdate?.(c.changes);
                  else
                    setCastPractice(
                      `${spell.name}: ${c.label}. ${c.note ?? ''} Resolve its effect at the table.`,
                    );
                }}
              >
                Cast {spell.name} · {c.label}
              </button>
            ))}
            {spell.level === 0 && (
              <button
                disabled={!rollable || dirty}
                onClick={() =>
                  setCastPractice(`${spell.name}: no slot spent. Resolve its effect at the table.`)
                }
              >
                Cast {spell.name} · No slot
              </button>
            )}
            {hasAttack &&
              sources.map((source) => (
                <button
                  key={source.id}
                  disabled={!rollable || dirty}
                  onClick={() =>
                    onRoll(
                      `${d20} + @{${dndId(source.attackKey)}}`,
                      `Spell attack with ${spell.name} (${source.label})`,
                    )
                  }
                >
                  Roll {spell.name} ({source.label})
                </button>
              ))}
          </div>
        )}
        {choices.map(
          (choice) =>
            choice.note && (
              <p key={choice.key} className="small">
                {choice.label}: {choice.note}
              </p>
            ),
        )}
        {!!spell.level && canCast && !choices.length && (
          <p>
            No casting cost is tracked for this spell. Check its rules and track the cost manually.
          </p>
        )}
        {choices.length > 0 && choices.every((c) => !c.available) && (
          <p>No tracked uses left. Check the spell’s rules for any other way to cast it.</p>
        )}
      </article>
    );
  }
  const customAbilities = sheet.sections
    .flatMap((s) => s.abilities)
    .filter((a) => !a.id.startsWith('5e202024-'));
  function editCustomAbility(
    id: string,
    patch: Partial<Pick<(typeof customAbilities)[number], 'name' | 'description' | 'expression'>>,
  ) {
    update((copy) => {
      const ability = copy.sections.flatMap((s) => s.abilities).find((a) => a.id === id);
      if (ability) Object.assign(ability, patch);
    });
  }

  return (
    <div className="dnd-tabbed">
      {castPractice && <p role="status">{castPractice}</p>}
      {playing && tab !== 'Inventory' && (
        <SrdEquipmentSummary
          sheet={sheet}
          onManage={() => {
            setTab('Inventory');
            document.getElementById(`${id}-tab-${tabs.indexOf('Inventory')}`)?.focus();
          }}
        />
      )}
      <div role="tablist" aria-label="Character details" className="dnd-tabs">
        {tabs.map((label, index) => (
          <button
            key={label}
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={tab === label}
            tabIndex={tab === label ? 0 : -1}
            onClick={() => setTab(label)}
            onKeyDown={(e) => {
              let next = index;
              if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = tabs.length - 1;
              else return;
              e.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map((label, index) => (
        <div
          key={label}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={tab !== label}
          tabIndex={0}
          className="dnd-tab-panel"
        >
          {label === 'Abilities' && abilityPanel}
          {label === 'Actions' && (
            <>
              {children}
              {actionTypes.map((type) => {
                const availableSpells = spells.filter(
                  (s) =>
                    s.actionType === type &&
                    (s.level === 0 || s.prepared || (tab === label && options(s).length > 0)),
                );
                const features = details.features.filter((f) => f.actionType === type);
                if (!availableSpells.length && !features.length) return null;
                const compact = type !== 'Passive' && type !== 'Other';
                return (
                  <section className="dnd-box dnd-action-group" key={type}>
                    <h3>{type}</h3>
                    {tab === label && availableSpells.map((spell) => spellCard(spell, compact))}
                    {tab === label && features.map((feature) => featureCard(feature, compact))}
                  </section>
                );
              })}
              {customAbilities.map((ability) => (
                <article className="dnd-box dnd-rules-card" key={ability.id}>
                  <h4>{ability.name}</h4>
                  {!playing && editable ? (
                    <>
                      {text('Custom ability name', ability.name, (name) =>
                        editCustomAbility(ability.id, { name }),
                      )}
                      {text(
                        `${ability.name} description`,
                        ability.description,
                        (description) => editCustomAbility(ability.id, { description }),
                        true,
                      )}
                      <label>
                        Roll expression
                        <input
                          aria-label={`${ability.name} expression`}
                          maxLength={500}
                          value={ability.expression}
                          onChange={(e) =>
                            editCustomAbility(ability.id, { expression: e.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <DndRulesText description={ability.description} />
                  )}
                  {ability.expression && (
                    <div className="dnd-rules-buttons">
                      <button
                        disabled={!rollable || dirty}
                        onClick={() => onRoll(ability.expression, ability.name)}
                      >
                        Roll {ability.name}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
          {label === 'Spell' && playing && tab === label && (
            <section className="stack">
              <h3>Spellcasting</h3>
              <p>
                A spell is a magical effect. A cantrip needs no slot. Most other spells spend a slot
                of their level or higher.
              </p>
              {!spells.length && <p>No spells on this sheet.</p>}
              {spells.map((spell) => spellCard(spell))}
            </section>
          )}
          {label === 'Spell' && (
            <>
              <details open={!playing}>
                <summary>Spell slots and casting statistics</summary>
                <section className="dnd-box">
                  <h3>Spellcasting</h3>
                  {input('spell-ability')}
                  {input('spell-dc')}
                  {spellAttack}
                  <div className="dnd-entry-grid">
                    {Array.from({ length: 9 }, (_, level) => {
                      const slot = sheet.sections
                        .flatMap((s) => s.fields)
                        .find((f) => f.id === dndId(`slot:${level}`));
                      return (
                        slot && (
                          <div className="dnd-box" key={level}>
                            {input(`slot:${level}`, `Level ${level + 1} slots remaining`)}
                            <div className="wrap">
                              <button
                                disabled={!editable || !quickEditable || Number(slot.value) <= 0}
                                onClick={() =>
                                  quickUpdate
                                    ? quickUpdate([{ id: slot.id, value: Number(slot.value) - 1 }])
                                    : update((copy) => {
                                        const f = copy.sections
                                          .flatMap((s) => s.fields)
                                          .find((f) => f.id === slot.id)!;
                                        f.value = Number(f.value) - 1;
                                      })
                                }
                              >
                                Use level {level + 1} slot
                              </button>
                              <button
                                disabled={
                                  !editable ||
                                  !quickEditable ||
                                  Number(slot.value) >= (slot.max ?? 0)
                                }
                                onClick={() =>
                                  quickUpdate
                                    ? quickUpdate([{ id: slot.id, value: Number(slot.value) + 1 }])
                                    : update((copy) => {
                                        const f = copy.sections
                                          .flatMap((s) => s.fields)
                                          .find((f) => f.id === slot.id)!;
                                        f.value = Number(f.value) + 1;
                                      })
                                }
                              >
                                Recover level {level + 1} slot
                              </button>
                            </div>
                          </div>
                        )
                      );
                    })}
                  </div>
                </section>
              </details>
              {!playing && (
                <>
                  {editable && (
                    <button
                      disabled={spells.length >= 200}
                      onClick={() =>
                        edit((d) => {
                          d.spells.push({
                            id: crypto.randomUUID(),
                            name: 'New spell',
                            description: '',
                            level: 0,
                            prepared: false,
                            actionType: 'Action',
                          });
                        })
                      }
                    >
                      Add spell
                    </button>
                  )}
                  {Array.from({ length: 10 }, (_, level) => (
                    <section className="dnd-box" key={level}>
                      <h3>{level === 0 ? 'Cantrips' : `Level ${level}`}</h3>
                      {!spells.some((s) => s.level === level) && (
                        <p className="muted">No spells.</p>
                      )}
                      {spells
                        .filter((s) => s.level === level)
                        .map((spell) => (
                          <article className="dnd-entry" key={spell.id}>
                            {spell.casting?.map((casting) => {
                              const source = castingSources.find(
                                (source) => source.id === casting.sourceId,
                              );
                              if (!source) return null;
                              return (
                                <div key={source.id} className="wrap">
                                  <span className="small">
                                    {source.label} · Save DC {computed[dndId(source.dcKey)]}
                                  </span>
                                  {/spell attack/i.test(spell.description) && (
                                    <button
                                      disabled={!rollable || dirty}
                                      onClick={() =>
                                        onRoll(
                                          `${d20} + @{${dndId(source.attackKey)}}`,
                                          `Spell attack with ${spell.name} (${source.label})`,
                                        )
                                      }
                                    >
                                      Roll {spell.name} ({source.label})
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {text('Spell name', spell.name, (v) =>
                              edit((d) => {
                                d.spells.find((s) => s.id === spell.id)!.name = v;
                              }),
                            )}
                            {number(
                              `${spell.name} level`,
                              spell.level,
                              (v) =>
                                edit((d) => {
                                  d.spells.find((s) => s.id === spell.id)!.level = v;
                                }),
                              9,
                            )}
                            {select(
                              `${spell.name} casting time`,
                              spell.actionType,
                              actionTypes,
                              (v) =>
                                edit((d) => {
                                  d.spells.find((s) => s.id === spell.id)!.actionType =
                                    v as typeof spell.actionType;
                                }),
                            )}
                            {spell.level > 0 &&
                              check(`Prepare ${spell.name}`, spell.prepared, (v) =>
                                edit((d) => {
                                  d.spells.find((s) => s.id === spell.id)!.prepared = v;
                                }),
                              )}
                            {text(
                              `${spell.name} description`,
                              spell.description,
                              (v) =>
                                edit((d) => {
                                  d.spells.find((s) => s.id === spell.id)!.description = v;
                                }),
                              true,
                            )}
                            {editable && (
                              <button
                                onClick={() =>
                                  edit((d) => {
                                    d.spells = d.spells.filter((s) => s.id !== spell.id);
                                  })
                                }
                              >
                                Remove {spell.name}
                              </button>
                            )}
                          </article>
                        ))}
                    </section>
                  ))}
                  {input('spells', 'Existing spell notes', true)}
                </>
              )}
            </>
          )}
          {label === 'Inventory' && playing && tab === label && (
            <PlayInventory
              sheet={sheet}
              disabled={!quickEditable || dirty || !onEquip || !onUseItem}
              onChange={(action) => (action.type === 'toggle' ? onEquip : onUseItem)?.(action.id)}
            />
          )}
          {label === 'Inventory' && !playing && (
            <>
              <p>
                Attuned: {details.items.filter((i) => i.attuned).length} / {attunementLimit}
              </p>
              {editable && (
                <button
                  disabled={details.items.length >= 200}
                  onClick={() =>
                    edit((d) => {
                      d.items.push({
                        id: crypto.randomUUID(),
                        name: 'New item',
                        description: '',
                        quantity: 1,
                        rarity: 'Common',
                        requiresAttunement: false,
                        attuned: false,
                      });
                    })
                  }
                >
                  Add item
                </button>
              )}
              {details.items.length === 0 && <p className="muted">No inventory items.</p>}
              {details.items.map((item) => (
                <article className="dnd-box" key={item.id}>
                  <h3>
                    <span className={`dnd-rarity dnd-rarity-${rarities.indexOf(item.rarity)}`}>
                      {item.name} · {item.rarity}
                    </span>
                  </h3>
                  {text('Item name', item.name, (v) =>
                    edit((d) => {
                      d.items.find((i) => i.id === item.id)!.name = v;
                    }),
                  )}
                  {select(`${item.name} rarity`, item.rarity, rarities, (v) =>
                    edit((d) => {
                      d.items.find((i) => i.id === item.id)!.rarity = v as typeof item.rarity;
                    }),
                  )}
                  {number(`${item.name} quantity`, item.quantity, (v) =>
                    edit((d) => {
                      d.items.find((i) => i.id === item.id)!.quantity = v;
                    }),
                  )}
                  {check(`${item.name} requires attunement`, item.requiresAttunement, (v) =>
                    edit((d) => {
                      const i = d.items.find((i) => i.id === item.id)!;
                      i.requiresAttunement = v;
                      if (!v) i.attuned = false;
                    }),
                  )}
                  {item.requiresAttunement &&
                    check(
                      `Attune ${item.name}`,
                      item.attuned,
                      (v) =>
                        edit((d) => {
                          d.items.find((i) => i.id === item.id)!.attuned = v;
                        }),
                      !item.attuned &&
                        details.items.filter((i) => i.attuned).length >= attunementLimit,
                    )}
                  {text(
                    `${item.name} description`,
                    item.description,
                    (v) =>
                      edit((d) => {
                        d.items.find((i) => i.id === item.id)!.description = v;
                      }),
                    true,
                  )}
                  {editable && (
                    <button
                      onClick={() =>
                        edit((d) => {
                          d.items = d.items.filter((i) => i.id !== item.id);
                        })
                      }
                    >
                      Remove {item.name}
                    </button>
                  )}
                </article>
              ))}
              {input('equipment', 'Equipment & proficiency notes', true)}
            </>
          )}
          {label === 'Features & Traits' && (
            <>
              {!playing && editable && (
                <button
                  disabled={details.features.length >= 200}
                  onClick={() =>
                    edit((d) => {
                      d.features.push({
                        id: crypto.randomUUID(),
                        name: 'New feature',
                        description: '',
                        source: 'Class',
                        actionType: 'Passive',
                        uses: 0,
                        maxUses: 0,
                      });
                    })
                  }
                >
                  Add feature
                </button>
              )}
              {details.features.length === 0 && <p className="muted">No features or traits.</p>}
              {playing && tab === label && details.features.map((feature) => featureCard(feature))}
              {!playing &&
                details.features.map((feature) => (
                  <article className="dnd-box" key={feature.id}>
                    {text('Feature name', feature.name, (v) =>
                      edit((d) => {
                        d.features.find((f) => f.id === feature.id)!.name = v;
                      }),
                    )}
                    {select(
                      `${feature.name} source`,
                      feature.source,
                      ['Class', 'Species', 'Background', 'Feat', 'Other'],
                      (v) =>
                        edit((d) => {
                          d.features.find((f) => f.id === feature.id)!.source =
                            v as typeof feature.source;
                        }),
                    )}
                    {select(`${feature.name} action type`, feature.actionType, actionTypes, (v) =>
                      edit((d) => {
                        d.features.find((f) => f.id === feature.id)!.actionType =
                          v as typeof feature.actionType;
                      }),
                    )}
                    {number(`${feature.name} maximum uses`, feature.maxUses, (v) =>
                      edit((d) => {
                        const f = d.features.find((f) => f.id === feature.id)!;
                        f.maxUses = v;
                        f.uses = Math.min(f.uses, v);
                      }),
                    )}
                    {feature.maxUses > 0 && (
                      <>
                        <p>{usesRemaining(feature)}</p>
                        {uses(feature)}
                      </>
                    )}
                    {text(
                      `${feature.name} description`,
                      feature.description,
                      (v) =>
                        edit((d) => {
                          d.features.find((f) => f.id === feature.id)!.description = v;
                        }),
                      true,
                    )}
                    {editable && (
                      <button
                        onClick={() =>
                          edit((d) => {
                            d.features = d.features.filter((f) => f.id !== feature.id);
                          })
                        }
                      >
                        Remove {feature.name}
                      </button>
                    )}
                  </article>
                ))}
              {input('features', 'Existing feature notes', true)}
            </>
          )}
          {label === 'Biography' && (
            <section className="dnd-box">
              <h3>Biography & background</h3>
              {input('background')}
              {text(
                'Physical description',
                details.biography.physical,
                (v) =>
                  edit((d) => {
                    d.biography.physical = v;
                  }),
                true,
              )}
              {text(
                'Personality & mental description',
                details.biography.personality,
                (v) =>
                  edit((d) => {
                    d.biography.personality = v;
                  }),
                true,
              )}
              {text(
                'Family & history',
                details.biography.history,
                (v) =>
                  edit((d) => {
                    d.biography.history = v;
                  }),
                true,
              )}
              {input('notes-text', 'Additional notes', true)}
            </section>
          )}
        </div>
      ))}
    </div>
  );
}
