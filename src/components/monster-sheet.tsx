'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { dndId } from '@/lib/dnd';
import { createMonsterSheet, monsterSource, monsterSpells } from '@/lib/srd-monsters';
import type { QuickUpdate } from '@/lib/resources';
import type { Ability, Field, Sheet } from '@/lib/types';

const tabs = [
  'Actions',
  'Spell',
  'Abilities',
  'Features & Traits',
  'Resources',
  'Inventory',
  'Notes & Source',
] as const;
const scores = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];

export default function MonsterSheet({
  inventory,
  sheet,
  name,
  portrait,
  onCustomize,
  editable,
  rollable,
  blocked,
  quickEditable,
  quickUpdate,
  onRoll,
}: {
  sheet: Sheet;
  inventory?: ReactNode;
  name?: string;
  portrait?: ReactNode;
  onCustomize?: () => void;
  editable: boolean;
  rollable: boolean;
  blocked: boolean;
  quickEditable: boolean;
  quickUpdate: QuickUpdate;
  onRoll: (expression: string, label: string) => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Actions');
  const [mode, setMode] = useState('normal');
  const id = useId();
  const source = monsterSource(sheet);
  const printedStats = new Map(
    [
      ...(source?.text ?? '').matchAll(
        /(?:^|\n)(Speed|Resistances|Vulnerabilities|Immunities|Senses|Languages)\s+([\s\S]*?)(?=\n(?:MOD SAVE|Resistances|Vulnerabilities|Immunities|Senses|Languages|CR)\b)/g,
      ),
    ].map((match) => [match[1], match[2].replace(/\s+/g, ' ').trim()]),
  );
  const fields = sheet.sections.flatMap((section) => section.fields);
  const abilities = sheet.sections.flatMap((section) => section.abilities);
  const field = (key: string) => fields.find((entry) => entry.id === dndId(`monster:${key}`));
  const ability = (key: string) => abilities.find((entry) => entry.id === dndId(`monster:${key}`));
  // Only the grouping comes from the template. All displayed values and rolls
  // come from the saved creature, including renamed/customized entries.
  const templateAbilities = useMemo(
    () =>
      source ? createMonsterSheet(source.id).sections.flatMap((section) => section.abilities) : [],
    [source],
  );
  const parents = useMemo(() => {
    const result = new Map<string, string>();
    if (!source) return result;
    const primary = new Set(source.actions.map((_, index) => dndId(`monster:action:${index}`)));
    let parent: string | undefined;
    for (const entry of templateAbilities) {
      if (primary.has(entry.id)) parent = entry.id;
      else if (!entry.expression) parent = undefined;
      else if (parent) result.set(entry.id, parent);
    }
    return result;
  }, [source, templateAbilities]);
  const children = new Map<string, Ability[]>();
  for (const entry of abilities) {
    const parent = parents.get(entry.id);
    if (parent && abilities.some((candidate) => candidate.id === parent)) {
      const group = children.get(parent) ?? [];
      group.push(entry);
      children.set(parent, group);
    }
  }
  const spells = source ? monsterSpells(source) : [];
  const spellRollIds = new Map(
    spells.map((spell) => [
      spell.entry.id,
      new Set(
        templateAbilities
          .filter((entry) => entry.name.startsWith(`${spell.entry.name} · `))
          .map((entry) => entry.id),
      ),
    ]),
  );
  const spellIds = new Set(
    spells.flatMap((spell) => [
      dndId(`monster:spell:${spell.entry.id}`),
      ...abilities
        .filter((entry) => entry.name.startsWith(`${spell.entry.name} · `))
        .map((entry) => entry.id),
      // Stable IDs preserve grouping even when the saved spell rolls are renamed.
      ...spellRollIds.get(spell.entry.id)!,
    ]),
  );
  const castingIds = new Set(
    source?.actions.flatMap((entry, index) =>
      entry.name === 'Spellcasting' && spells.some((spell) => spell.casting === entry.text)
        ? [dndId(`monster:action:${index}`)]
        : [],
    ),
  );
  const usedFields = new Set<string>();
  const usedAbilities = new Set<string>();
  function roll(entry: Ability, label = entry.name) {
    usedAbilities.add(entry.id);
    return (
      <button
        key={entry.id}
        className="dnd-roll"
        aria-label={`Roll ${entry.name}`}
        data-monster-ability={entry.id}
        title={`${entry.expression}${entry.description ? ` · ${entry.description}` : ''}`}
        disabled={!rollable || blocked}
        onClick={() =>
          onRoll(
            mode === 'normal'
              ? entry.expression
              : entry.expression.replace(/^1d20\b/, mode === 'advantage' ? '2d20kh1' : '2d20kl1'),
            entry.name,
          )
        }
      >
        <span>{label}</span>
        <strong>{entry.expression}</strong>
      </button>
    );
  }
  function value(entry: Field | undefined) {
    if (!entry) return null;
    usedFields.add(entry.id);
    const resource = entry.kind === 'resource';
    return (
      <div className="dnd-value" key={entry.id} data-monster-field={entry.id}>
        <label htmlFor={`${id}-${entry.id}`}>{entry.label}</label>
        {resource ? (
          <input
            id={`${id}-${entry.id}`}
            aria-label={entry.label}
            type="number"
            min={0}
            max={entry.max}
            value={entry.value}
            disabled={!editable || !quickEditable || blocked}
            onChange={(event) => {
              if (event.target.value === '') return;
              const next = Number(event.target.value);
              if (Number.isFinite(next))
                quickUpdate([
                  { id: entry.id, value: Math.max(0, Math.min(entry.max ?? 0, Math.trunc(next))) },
                ]);
            }}
          />
        ) : (
          <output id={`${id}-${entry.id}`}>{String(entry.value) || '—'}</output>
        )}
        {resource && entry.id !== dndId('monster:temporary-hp') && (
          <span className="dnd-resource-limit">/ {entry.max ?? 0}</span>
        )}
      </div>
    );
  }
  function counter(entry: Field | undefined, label: string, spell = false) {
    if (!entry) return null;
    usedFields.add(entry.id);
    return (
      <div className="monster-use-controls" data-monster-field={entry.id}>
        <span>
          {entry.value} / {entry.max} uses
        </span>
        <button
          disabled={!editable || !quickEditable || blocked || Number(entry.value) <= 0}
          onClick={() => quickUpdate([{ id: entry.id, value: Number(entry.value) - 1 }])}
        >
          {spell ? `Spend ${label} use` : 'Spend use'}
        </button>
        <button
          disabled={
            !editable || !quickEditable || blocked || Number(entry.value) >= (entry.max ?? 0)
          }
          onClick={() => quickUpdate([{ id: entry.id, value: entry.max ?? 0 }])}
        >
          {spell ? `Recover ${label} uses (manual)` : 'Recover uses (manual)'}
        </button>
      </div>
    );
  }
  function action(entry: Ability) {
    usedAbilities.add(entry.id);
    const related = children.get(entry.id) ?? [];
    const sourceIndex =
      source?.actions.findIndex((_, index) => entry.id === dndId(`monster:action:${index}`)) ?? -1;
    const uses =
      sourceIndex < 0
        ? fields.find(
            (candidate) =>
              candidate.kind === 'resource' && candidate.label === `${entry.name} uses`,
          )
        : field(`action:${sourceIndex}:uses`);
    return (
      <article key={entry.id} className="monster-action" data-monster-action={entry.id}>
        <h4>{entry.name}</h4>
        <div className="monster-roll-grid">
          {entry.expression ? (
            roll(entry)
          ) : (
            <button
              data-monster-ability={entry.id}
              aria-label={`Declare ${entry.name}`}
              disabled={!rollable || blocked}
              onClick={() => onRoll('0', `Use ${entry.name} (manual)`)}
            >
              Declare
            </button>
          )}
          {related.map((child) =>
            child.expression
              ? roll(
                  child,
                  child.name.startsWith(`${entry.name} · `)
                    ? child.name.slice(entry.name.length + 3)
                    : child.name,
                )
              : action(child),
          )}
        </div>
        {counter(uses, entry.name)}
        {(entry.description || related.some((child) => child.description)) && (
          <details>
            <summary>Rules & roll details</summary>
            {entry.description && <p className="dnd-description">{entry.description}</p>}
            {related
              .filter((child) => child.description)
              .map((child) => (
                <p className="small" key={child.id}>
                  <strong>{child.name}:</strong> {child.description}
                </p>
              ))}
          </details>
        )}
      </article>
    );
  }
  const sections = (traits: boolean) =>
    sheet.sections.flatMap((section) => {
      if (
        [
          'Source',
          'Published stat block',
          'Statistics',
          'Checks and saves',
          'Uses and recharge',
          'Spells',
        ].some((title) => section.title === title || section.title.startsWith(`${title} (`))
      )
        return [];
      if (/Traits/.test(section.title) !== traits) return [];
      const entries = section.abilities.filter(
        (entry) => !childrenHas(entry.id) && !spellIds.has(entry.id) && !castingIds.has(entry.id),
      );
      if (!entries.length && !section.fields.length) return [];
      return [
        <section key={section.id} className="dnd-box">
          <h3>{section.title}</h3>
          <div className="monster-stat-grid">{section.fields.map(value)}</div>
          {entries.map(action)}
        </section>,
      ];
    });
  function childrenHas(abilityId: string) {
    const parent = parents.get(abilityId);
    return !!parent && children.has(parent);
  }
  // Build every panel once per render; hidden panels keep their state, but only
  // the selected panel participates in layout or keyboard navigation.
  const actions = sections(false);
  const traits = sections(true);
  const initiative = ability('initiative');
  const combat = (
    <section className="dnd-box monster-combat" aria-label="Combat essentials">
      <div className="dnd-health">{value(field('hp'))}</div>
      {value(field('temporary-hp'))}
      {value(field('ac'))}
      {field('speed')
        ? value(field('speed'))
        : printedStats.has('Speed') && (
            <div className="dnd-value">
              <label>Speed (source)</label>
              <output aria-label="Speed (source)">{printedStats.get('Speed')}</output>
            </div>
          )}
      {initiative && (
        <div className="dnd-value">
          <label>Initiative</label>
          {roll(initiative)}
        </div>
      )}
      {!!field('conditions')?.value && value(field('conditions'))}
    </section>
  );
  const checks = (
    <div className="dnd-ability-summary" role="group" aria-label="Quick ability checks">
      {scores.map((key) => (
        <div key={key} className="monster-score">
          {value(field(`${key}:score`))}
          {ability(`${key}:check`) && roll(ability(`${key}:check`)!, 'Check')}
        </div>
      ))}
    </div>
  );
  const spellPanel = (
    <>
      {!spells.length && (
        <p className="muted">No printed spells. Any custom spell abilities appear below.</p>
      )}
      {[...new Set(spells.map((spell) => spell.casting))].map((casting) => {
        const index = source?.actions.findIndex((entry) => entry.text === casting) ?? -1;
        const saved = index >= 0 ? ability(`action:${index}`) : undefined;
        if (saved && castingIds.has(saved.id)) usedAbilities.add(saved.id);
        return (
          <details className="dnd-box" key={casting} data-monster-casting>
            <summary>{saved?.name ?? 'Monster casting rules and restrictions'}</summary>
            <p className="dnd-description">{saved?.description ?? casting}</p>
            {saved && castingIds.has(saved.id) && (
              <>
                {saved.expression ? (
                  roll(saved)
                ) : (
                  <button
                    data-monster-ability={saved.id}
                    disabled={!rollable || blocked}
                    onClick={() => onRoll('0', `Use ${saved.name} (manual)`)}
                  >
                    Declare {saved.name}
                  </button>
                )}
                <div className="monster-roll-grid">
                  {children.get(saved.id)?.map((entry) => roll(entry))}
                </div>
                {counter(field(`action:${index}:uses`), saved.name)}
              </>
            )}
          </details>
        );
      })}
      {spells.map((spell) => {
        const base = dndId(`monster:spell:${spell.entry.id}`);
        const cast = abilities.find((entry) => entry.id === base);
        const rolls = abilities.filter(
          (entry) =>
            spellRollIds.get(spell.entry.id)!.has(entry.id) ||
            entry.name.startsWith(`${spell.entry.name} · `),
        );
        usedAbilities.add(base);
        return (
          <article className="dnd-box monster-action" key={spell.entry.id}>
            <h3>{spell.entry.name}</h3>
            <p className="small">
              {spell.uses ? `${spell.uses}/day (source)` : 'At will / review casting restrictions'}
              {spell.levelOverride ? ` · Printed level ${spell.levelOverride} version` : ''}
            </p>
            {value(field(`spell:${spell.entry.id}:dc`))}
            <div className="monster-roll-grid">
              {cast?.expression ? (
                roll(cast)
              ) : (
                <button
                  data-monster-ability={base}
                  disabled={!rollable || blocked}
                  title={cast?.description}
                  onClick={() =>
                    onRoll(
                      '0',
                      `${cast?.name ?? `Cast ${spell.entry.name}`} (manual; review source restrictions)`,
                    )
                  }
                >
                  {cast?.name === `Cast ${spell.entry.name}` || !cast
                    ? `Declare cast ${spell.entry.name}`
                    : `Declare ${cast.name}`}
                </button>
              )}
              {rolls.map((entry) => (entry.expression ? roll(entry) : action(entry)))}
            </div>
            {counter(field(`spell:${spell.entry.id}:uses`), spell.entry.name, true)}
            <details>
              <summary>Full spell · SRD p. {spell.entry.page}</summary>
              <p className="dnd-description">{spell.entry.text}</p>
            </details>
          </article>
        );
      })}
      {sheet.sections
        .filter((section) => /^Spells(?:$| \()/.test(section.title))
        .map((section) => {
          const extraAbilities = section.abilities.filter((entry) => !spellIds.has(entry.id));
          const extraFields = section.fields.filter((entry) => !usedFields.has(entry.id));
          if (!extraAbilities.length && !extraFields.length) return null;
          return (
            <section className="dnd-box" key={section.id}>
              <h3>{section.title}</h3>
              <div className="monster-stat-grid">{extraFields.map(value)}</div>
              {extraAbilities.map(action)}
            </section>
          );
        })}
    </>
  );
  const abilityPanel = (
    <section className="dnd-box">
      <h3>Saving throws & skills</h3>
      <div className="monster-roll-grid">
        {sheet.sections
          .filter((section) => section.title.startsWith('Checks and saves'))
          .flatMap((section) => section.abilities)
          .filter((entry) => !usedAbilities.has(entry.id))
          .map((entry) => (entry.expression ? roll(entry) : action(entry)))}
      </div>
    </section>
  );
  const resources = fields.filter(
    (entry) => entry.kind === 'resource' && !usedFields.has(entry.id),
  );
  const resourcePanel = (
    <section className="dnd-box">
      <h3>Other resources & recharge</h3>
      <p className="small">
        Action and spell uses are beside their actions. Recover manually after checking the printed
        recharge/rest rules.
      </p>
      <div className="monster-stat-grid">{resources.map(value)}</div>
      {abilities
        .filter(
          (entry) =>
            !usedAbilities.has(entry.id) && !spellIds.has(entry.id) && !childrenHas(entry.id),
        )
        .map(action)}
    </section>
  );
  const panels: Record<(typeof tabs)[number], ReactNode> = {
    Actions: actions,
    Spell: spellPanel,
    Abilities: abilityPanel,
    'Features & Traits': (
      <>
        {printedStats.size > 1 && (
          <section className="dnd-box">
            <h3>Defenses & senses (source)</h3>
            <dl className="monster-source-stats">
              {[...printedStats]
                .filter(([label]) => label !== 'Speed')
                .map(([label, text]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}
        {traits}
      </>
    ),
    Resources: resourcePanel,
    Inventory: inventory,
    'Notes & Source': (
      <section className="dnd-box">
        <div className="monster-stat-grid">
          {fields
            .filter(
              (entry) =>
                !usedFields.has(entry.id) &&
                !sheet.sections
                  .filter((section) => ['Source', 'Published stat block'].includes(section.title))
                  .some((section) => section.fields.some((candidate) => candidate.id === entry.id)),
            )
            .map(value)}
        </div>
        <details>
          <summary>Play guidance & automation limits</summary>
          <p>
            Encounter edits affect only this creature. Configure statistics and expressions with
            “Customize monster sheet”. Rolls use the room’s displayed audience.
          </p>
          <p>
            Casting and declaring actions do not spend uses automatically. Multiattack, targeting,
            conditional damage, concentration and complex spell scaling require GM adjudication.
          </p>
        </details>
        {source && (
          <details>
            <summary>
              Published {source.name} · SRD 5.2.1 pp. {source.page}–{source.endPage} (unmodified)
            </summary>
            <p className="dnd-description">{source.text}</p>
            <small>
              This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by
              Wizards of the Coast LLC, available at{' '}
              <a href="https://www.dndbeyond.com/srd">dndbeyond.com/srd</a>, licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/legalcode">CC BY 4.0</a>. VTT
              controls and formatting are adaptations.
            </small>
          </details>
        )}
      </section>
    ),
  };
  return (
    <div className="dnd-sheet monster-sheet">
      <div className="dnd-identity">
        {portrait}
        <div className="dnd-identity-main">
          <h2>{name ?? source?.name ?? 'Creature'}</h2>
          {source && (
            <p className="muted">
              {source.creatureType} · CR {source.crLabel} (source)
            </p>
          )}
        </div>
        {editable && onCustomize && (
          <button className="dnd-edit-toggle" onClick={onCustomize}>
            Edit monster stats
          </button>
        )}
        {!editable && <span className="dnd-read-only">Read only</span>}
      </div>
      <div className="dnd-roll-toolbar">
        <label>
          Sheet roll mode{' '}
          <select
            aria-label="Sheet roll mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="normal">Normal</option>
            <option value="advantage">Advantage</option>
            <option value="disadvantage">Disadvantage</option>
          </select>
        </label>
        <span>
          {blocked
            ? 'Resolve unsaved or unconfirmed changes before rolling.'
            : 'Rolls use dice panel visibility. Uses are spent separately.'}
        </span>
      </div>
      {source?.cr === null && (
        <p role="status">
          This creature has summoner/size/spell-dependent statistics. Set HP, AC and roll
          expressions from the printed formulas before play; unresolved HP starts at 0.
        </p>
      )}
      {combat}
      {checks}
      <div className="dnd-tabbed">
        <div role="tablist" aria-label="Monster details" className="dnd-tabs">
          {tabs.map((label, index) => (
            <button
              key={label}
              role="tab"
              id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel-${index}`}
              aria-selected={tab === label}
              tabIndex={tab === label ? 0 : -1}
              onClick={() => setTab(label)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
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
            {panels[label]}
          </div>
        ))}
      </div>
    </div>
  );
}
