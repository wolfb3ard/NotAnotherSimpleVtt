'use client';

import { useState } from 'react';
import {
  abilities,
  skills,
  dndId,
  dndNumbers,
  dndDamageExpression,
  dndFieldOptions,
} from '@/lib/dnd';
import type { Sheet } from '@/lib/types';
import { DndTabs } from './dnd-tabs';
import { srdCastingSources } from '@/lib/srd-casting';

type Props = {
  name: string;
  onNameChange: (name: string) => void;
  sheet: Sheet;
  editable: boolean;
  rollable: boolean;
  dirty: boolean;
  update: (edit: (sheet: Sheet) => void) => void;
  onRoll: (expression: string, rollType?: string) => void;
};
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
const ref = (key: string) => `@{${dndId(key)}}`;

/** Compact combat dashboard; the version-1 document remains the source of truth. */
export function DndSheet({
  name,
  onNameChange,
  sheet,
  editable,
  rollable,
  dirty,
  update,
  onRoll,
}: Props) {
  const [mode, setMode] = useState('normal');
  const fields = new Map(sheet.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
  const computed = dndNumbers(sheet);
  const castingSources = sheet.character?.builder ? srdCastingSources(sheet.character.builder) : [];
  const field = (key: string) => fields.get(dndId(key));
  function change(key: string, value: string | number, maximum = false) {
    update((copy) => {
      const target = copy.sections.flatMap((s) => s.fields).find((f) => f.id === dndId(key));
      if (target) {
        if (target.kind === 'resource') {
          const amount = Math.max(0, Math.trunc(Number(value)));
          if (maximum) {
            target.max = amount;
            target.value = Math.min(Number(target.value), amount);
          } else target.value = Math.min(amount, target.max ?? 0);
        } else target.value = value;
      }
    });
  }
  function input(key: string, label?: string, multiline = false) {
    const f = field(key);
    if (!f) return null;
    const options = dndFieldOptions(f.id);
    const derived = Object.hasOwn(computed, f.id);
    return (
      <div className={`dnd-value ${multiline ? 'dnd-notes' : ''}`}>
        <label htmlFor={f.id}>{label ?? f.label}</label>
        {options ? (
          <select
            id={f.id}
            aria-label={label ?? f.label}
            value={f.value}
            disabled={!editable}
            onChange={(e) => change(key, Number(e.target.value))}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : multiline ? (
          <textarea
            id={f.id}
            aria-label={label ?? f.label}
            value={f.value}
            disabled={!editable}
            onChange={(e) => change(key, e.target.value)}
          />
        ) : (
          <input
            id={f.id}
            aria-label={label ?? f.label}
            type={f.kind === 'text' ? 'text' : 'number'}
            value={computed[f.id] ?? f.value}
            disabled={
              !editable ||
              derived ||
              (!!sheet.character?.builder &&
                (key === 'level' || key === 'hit-dice' || key.startsWith('score:')))
            }
            min={
              key === 'level' || key.startsWith('score:')
                ? 1
                : key === 'exhaustion' || f.kind === 'resource'
                  ? 0
                  : undefined
            }
            max={
              key === 'level'
                ? 20
                : key.startsWith('score:')
                  ? 30
                  : key === 'exhaustion'
                    ? 6
                    : f.kind === 'resource'
                      ? f.max
                      : undefined
            }
            onChange={(e) =>
              change(key, f.kind === 'text' ? e.target.value : Number(e.target.value))
            }
          />
        )}
        {f.kind === 'resource' && (
          <label className="dnd-resource-max">
            Maximum
            <input
              aria-label={`${label ?? f.label} maximum`}
              type="number"
              min={0}
              value={f.max ?? 0}
              disabled={!editable || (!!sheet.character?.builder && key === 'hit-dice')}
              onChange={(e) => change(key, Number(e.target.value), true)}
            />
          </label>
        )}
      </div>
    );
  }
  function rollButton(
    label: string,
    key: string,
    expression = `1d20 + ${ref(key)}`,
    displayLabel = label,
    rollType = label,
  ) {
    const stored = fields.get(dndId(key))?.value;
    const value = computed[dndId(key)] ?? (typeof stored === 'number' ? stored : undefined);
    const resolved = expression.replace(/@\{([^}]+)\}/g, (_, id: string) =>
      String(computed[id] ?? fields.get(id)?.value ?? '?'),
    );
    return (
      <button
        className="dnd-roll"
        disabled={!rollable || dirty || !expression}
        title={dirty ? 'Save changes before rolling' : resolved}
        aria-label={`Roll ${label}`}
        onClick={() =>
          onRoll(
            mode === 'normal'
              ? expression
              : expression.replace(/^1d20/, mode === 'advantage' ? '2d20kh1' : '2d20kl1'),
            rollType,
          )
        }
      >
        <span>{displayLabel}</span>
        {value !== undefined && <strong>{signed(value)}</strong>} <span aria-hidden="true">◇</span>
      </button>
    );
  }
  function proficiency(key: string, label: string) {
    const f = field(key);
    return (
      f && (
        <select
          className="dnd-proficiency"
          aria-label={`${label} proficiency`}
          value={f.value}
          disabled={!editable}
          onChange={(e) => change(key, Number(e.target.value))}
        >
          {dndFieldOptions(f.id)?.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    );
  }
  const extraKeys = [
    'check-bonus',
    'save-bonus',
    'attack-bonus',
    'damage-bonus',
    ...abilities.map((_, i) => `save-extra:${i}`),
    ...skills.map((_, i) => `skill-extra:${i}`),
  ];
  const knownSections = new Set(
    [
      'character',
      'scores',
      'saves',
      'skills',
      'combat',
      'notes',
      'weapon:0',
      'weapon:1',
      'weapon:2',
      'srd-resources',
      'srd-resources:1',
    ].map(dndId),
  );
  return (
    <div className="dnd-sheet">
      <div className="dnd-identity">
        <label className="dnd-character-name">
          Name
          <input
            aria-label="Name"
            value={name}
            maxLength={100}
            disabled={!editable}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        {['class', 'level', 'species', 'alignment', 'pb'].map((key) => (
          <div
            className={['class', 'species', 'background'].includes(key) ? 'dnd-identity-wide' : ''}
            key={key}
          >
            {input(key)}
          </div>
        ))}
      </div>
      <div className="dnd-roll-toolbar">
        <label>
          Sheet roll mode{' '}
          <select
            aria-label="Sheet roll mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="normal">Normal</option>
            <option value="advantage">Advantage</option>
            <option value="disadvantage">Disadvantage</option>
          </select>
        </label>
        <span>
          {dirty
            ? 'Save changes to enable rolls.'
            : '◇ rolls immediately using dice panel visibility.'}
        </span>
      </div>
      <div className="dnd-ability-summary" role="group" aria-label="Quick ability checks">
        {abilities.map((name, i) => (
          <div key={name}>
            {rollButton(
              `${name} check`,
              `check:${i}`,
              undefined,
              `${name.slice(0, 3).toUpperCase()} ${field(`score:${i}`)?.value ?? ''}`,
            )}
          </div>
        ))}
      </div>
      <section className="dnd-box dnd-combat-dashboard" aria-label="Combat essentials">
        <div className="dnd-combat-stats">
          {input('ac')}
          {input('speed')}
          {input('initiative')}
          {input('exhaustion')}
          {rollButton('Initiative', 'initiative')}
        </div>
        <div className="dnd-resource-grid">
          {input('hp')}
          {input('hit-dice')}
          {input('inspiration')}
        </div>
      </section>
      {sheet.sections.some((section) => section.id === dndId('srd-resources')) && (
        <details className="dnd-box">
          <summary>Class resources, grouped Hit Dice & spellcasting</summary>
          <div className="dnd-resource-grid">
            {sheet.sections
              .filter((section) =>
                [dndId('srd-resources'), dndId('srd-resources:1')].includes(section.id),
              )
              .flatMap((section) => section.fields)
              .map((resource) => (
                <label key={resource.id}>
                  {resource.label}
                  {resource.kind === 'resource' ? (
                    <>
                      <input
                        aria-label={resource.label}
                        type="number"
                        min={0}
                        max={resource.max}
                        disabled={!editable}
                        value={resource.value}
                        onChange={(e) =>
                          update((copy) => {
                            const all = copy.sections.flatMap((section) => section.fields);
                            const target = all.find((field) => field.id === resource.id)!;
                            target.value = Math.max(
                              0,
                              Math.min(target.max ?? 0, Math.trunc(Number(e.target.value))),
                            );
                            const grouped = [6, 8, 10, 12].map((die) =>
                              dndId(`srd-resource:hit-die:${die}`),
                            );
                            if (grouped.includes(target.id)) {
                              const total = all.find((field) => field.id === dndId('hit-dice'));
                              if (total)
                                total.value = Math.min(
                                  total.max ?? 0,
                                  all
                                    .filter((field) => grouped.includes(field.id))
                                    .reduce((sum, field) => sum + Number(field.value), 0),
                                );
                            }
                          })
                        }
                      />
                      <span className="small muted"> / {resource.max}</span>
                    </>
                  ) : (
                    <output>{computed[resource.id] ?? resource.value}</output>
                  )}
                </label>
              ))}
          </div>
        </details>
      )}
      <DndTabs
        sheet={sheet}
        editable={editable}
        rollable={rollable}
        dirty={dirty}
        update={update}
        onRoll={onRoll}
        d20={mode === 'advantage' ? '2d20kh1' : mode === 'disadvantage' ? '2d20kl1' : '1d20'}
        input={input}
        spellAttack={
          <>
            {rollButton('Spell attack', 'spell-attack')}
            {castingSources.map((source) => (
              <div key={source.id}>
                {rollButton(`${source.label} spell attack`, source.attackKey)}
                <span className="small muted">Save DC {computed[dndId(source.dcKey)]}</span>
              </div>
            ))}
          </>
        }
        abilityPanel={
          <div className="dnd-columns">
            <div className="dnd-column">
              <section className="dnd-box">
                <h3>Ability scores</h3>
                <div className="dnd-ability-scores">
                  {abilities.map((name, i) => (
                    <div className="dnd-score" key={name}>
                      {input(`score:${i}`, name)}
                      <output aria-label={`${name} modifier`}>
                        {signed(computed[dndId(`mod:${i}`)])}
                      </output>
                      {rollButton(`${name} check`, `check:${i}`)}
                    </div>
                  ))}
                </div>
              </section>
              <section className="dnd-box">
                <h3>Saving throws</h3>
                {abilities.map((name, i) => (
                  <div className="dnd-stat-row" key={name}>
                    {proficiency(`save-prof:${i}`, name)}
                    {rollButton(`${name} save`, `save:${i}`)}
                  </div>
                ))}
              </section>
            </div>
            <div className="dnd-column">
              <section className="dnd-box">
                <h3>Skills</h3>
                {skills.map(([name, ability], i) => (
                  <div className="dnd-stat-row" key={name}>
                    {proficiency(`skill-prof:${i}`, name)}
                    {rollButton(
                      `${name} (${abilities[ability].slice(0, 3)})`,
                      `skill:${i}`,
                      undefined,
                      undefined,
                      `${name} check`,
                    )}
                  </div>
                ))}
                {input('passive')}
              </section>
            </div>
            <div className="dnd-column">
              <section className="dnd-box">
                <h3>Bonuses</h3>
                <details>
                  <summary>Additional roll bonuses</summary>
                  <div className="dnd-config">
                    {extraKeys.map((key) => (
                      <div key={key}>{input(key)}</div>
                    ))}
                  </div>
                </details>
              </section>
            </div>
          </div>
        }
      >
        <section className="dnd-box">
          <h3>Weapon & spell attacks</h3>
          {[0, 1, 2].map((i) => {
            if (sheet.character?.builder && field(`weapon-name:${i}`)?.value === 'Unequipped')
              return (
                <p key={i} className="muted">
                  Attack slot {i + 1} · Unequipped. Choose a ready weapon in the builder, or use
                  Customize sheet for a manual attack.
                </p>
              );
            let damage = '',
              critical = '';
            try {
              damage = dndDamageExpression(String(field(`weapon-dice:${i}`)?.value), i);
              critical = dndDamageExpression(String(field(`weapon-dice:${i}`)?.value), i, true);
            } catch {
              /* Invalid dice are explained below and rejected on save. */
            }
            return (
              <div className="dnd-attack" key={i}>
                {input(`weapon-name:${i}`, `Attack ${i + 1} name`)}
                <div className="dnd-inline">
                  {input(`weapon-dice:${i}`, `Attack ${i + 1} damage dice`)}
                  {input(`weapon-type:${i}`, `Attack ${i + 1} damage type`)}
                </div>
                {rollButton(
                  'Attack roll',
                  `weapon-total:${i}`,
                  undefined,
                  undefined,
                  `Attack roll with ${field(`weapon-name:${i}`)?.value}`,
                )}
                <div className="dnd-inline">
                  {rollButton(
                    'Damage',
                    `weapon-damage-total:${i}`,
                    damage,
                    undefined,
                    `Damage with ${field(`weapon-name:${i}`)?.value}`,
                  )}
                  {rollButton(
                    'Critical damage',
                    `weapon-damage-total:${i}`,
                    critical,
                    undefined,
                    `Critical damage with ${field(`weapon-name:${i}`)?.value}`,
                  )}
                </div>
                {!damage && <p role="alert">Use damage dice such as 1d8 or 2d6.</p>}
                <details>
                  <summary>Attack {i + 1} configuration</summary>
                  <div className="dnd-config">
                    {input(`weapon-ability:${i}`, `Attack ${i + 1} ability`)}
                    {input(`weapon-prof:${i}`, `Attack ${i + 1} proficiency`)}
                    {input(`weapon-add:${i}`, `Attack ${i + 1} add ability to damage`)}
                    {input(`weapon-hit:${i}`, `Attack ${i + 1} extra attack bonus`)}
                    {input(`weapon-damage:${i}`, `Attack ${i + 1} extra damage bonus`)}
                  </div>
                </details>
              </div>
            );
          })}
        </section>
      </DndTabs>
      {sheet.sections.some(
        (s) => s.abilities.some((a) => !a.id.startsWith('5e202024-')) || !knownSections.has(s.id),
      ) && (
        <p className="notice">Custom fields and abilities are available in “Customize sheet”.</p>
      )}
    </div>
  );
}
