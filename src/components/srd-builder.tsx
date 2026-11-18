'use client';
import { useEffect, useRef, useState } from 'react';
import type { Sheet } from '@/lib/types';
import { emptyCharacterDetails } from '@/lib/character-details';
import { srdById, srdCatalog, srdExcerpt } from '@/lib/srd-catalog';
import { applySrdBuilder, deriveSrd, srdTransitionErrors } from '@/lib/srd-engine';
import { defaultEquipment, deriveEquipment } from '@/lib/srd-equipment';
import { draftEquipmentItems, SrdEquipmentControls } from './srd-equipment-controls';
import { defaultCompanions } from '@/lib/srd-shapes';
import { SrdShapesControls } from './srd-shapes-controls';
import {
  allowedOptions,
  automaticPreparedIds,
  blankFeat,
  blankLevel,
  builderErrors,
  classLevels,
  defaultBackgroundFeat,
  expertiseChoicesAt,
  featAt,
  featureChoicesAt,
  masteryCount,
  newSrdState,
  optionCount,
  skillChoicesAt,
  weaponNames,
  warlockCantripIds,
  type SrdBuilderState,
  type SrdFeatChoice,
  type SrdLevelChoice,
} from '@/lib/srd-state';
import {
  abilityNames,
  allSkills,
  backgrounds,
  classRules,
  classSpellLimits,
  gamingSets,
  lineages,
  srdAlignments,
  srdBackgrounds,
  srdClasses,
  srdSpecies,
  standardLanguages,
  toolNames,
  type SrdClass,
} from '@/lib/srd-rules';
import { SrdCatalog } from './srd-catalog';

type Option = { value: string; label: string };
const asOptions = (values: readonly string[]): Option[] =>
  values.map((value) => {
    const entry = srdById.get(value);
    return {
      value,
      label:
        entry?.category === 'form'
          ? `${entry.name} · CR ${entry.crLabel}${entry.fly ? ' · Fly' : ''}`
          : (entry?.name ?? value),
    };
  });
function Picks({
  label,
  values,
  options,
  count,
  onChange,
}: {
  label: string;
  values: string[];
  options: Option[];
  count: number;
  onChange: (values: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  return (
    <fieldset>
      <legend>
        {label} · {values.length}/{count}
      </legend>
      {options.length > 30 && (
        <label>
          Filter {label}
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      )}
      <div style={{ maxHeight: '15rem', overflowY: 'auto' }}>
        {options
          .filter(
            (option) =>
              !search ||
              values.includes(option.value) ||
              option.label.toLowerCase().includes(search.toLowerCase()),
          )
          .map((option) => (
            <label className="row" key={option.value}>
              <input
                type="checkbox"
                checked={values.includes(option.value)}
                disabled={!values.includes(option.value) && values.length >= count}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...values, option.value]
                      : values.filter((value) => value !== option.value),
                  )
                }
              />
              {option.label}
            </label>
          ))}
      </div>
    </fieldset>
  );
}
function Increases({
  values,
  onChange,
  max = 2,
  allowed = [0, 1, 2, 3, 4, 5],
}: {
  values: number[];
  onChange: (values: number[]) => void;
  max?: number;
  allowed?: readonly number[];
}) {
  return (
    <div className="row">
      {abilityNames.map((name, i) => (
        <label key={name}>
          {name} increase
          <select
            value={values[i]}
            disabled={!allowed.includes(i)}
            onChange={(e) => onChange(values.map((n, j) => (j === i ? Number(e.target.value) : n)))}
          >
            {Array.from({ length: max + 1 }, (_, value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
function FeatChoices({
  value,
  onChange,
  forced,
  origin = false,
  total,
  identityLocked = false,
  spellsLocked = false,
  label = 'Feat',
  forcedList,
}: {
  value?: SrdFeatChoice;
  onChange: (value: SrdFeatChoice) => void;
  forced?: string;
  origin?: boolean;
  total: number;
  identityLocked?: boolean;
  spellsLocked?: boolean;
  label?: string;
  forcedList?: 'Cleric' | 'Druid' | 'Wizard';
}) {
  const current = value ?? blankFeat(),
    entry = srdById.get(current.id);
  const choices = srdCatalog.filter(
    (e) =>
      e.category === 'feat' &&
      (!origin || e.featCategory === 'Origin') &&
      (e.featCategory !== 'Epic Boon' || total >= 19) &&
      (e.featCategory !== 'General' || total >= 4) &&
      (!forced || e.name === forced),
  );
  const update = (patch: Partial<SrdFeatChoice>) => onChange({ ...current, ...patch });
  const boosts =
    entry?.name === 'Ability Score Improvement'
      ? 2
      : entry?.name === 'Grappler' || entry?.featCategory === 'Epic Boon'
        ? 1
        : 0;
  return (
    <fieldset>
      <legend>{label}</legend>
      <p className="builder-help">
        A feat is a special talent. Each source grants its own choices.
      </p>
      <label>
        Choose feat
        <select
          disabled={identityLocked || !!forced}
          value={current.id}
          onChange={(e) => onChange(blankFeat(e.target.value))}
        >
          <option value="">Choose…</option>
          {choices.map((e) => (
            <option value={e.id} key={e.id}>
              {e.name} · {e.featCategory}
            </option>
          ))}
        </select>
      </label>
      {entry && (
        <details>
          <summary>Feat rules · p.{entry.page}</summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{entry.text}</p>
        </details>
      )}
      {boosts > 0 && (
        <fieldset disabled={identityLocked}>
          <p>Allocate {boosts} ability increase(s).</p>
          <Increases
            values={current.increases}
            max={boosts}
            onChange={(increases) => update({ increases })}
          />
        </fieldset>
      )}
      {entry?.name === 'Skilled' && (
        <fieldset disabled={identityLocked}>
          <Picks
            label="Skilled skills/tools"
            values={current.skills}
            count={3}
            options={asOptions([...allSkills, ...toolNames])}
            onChange={(skills) => update({ skills })}
          />
        </fieldset>
      )}
      {entry?.name === 'Magic Initiate' && (
        <>
          <p className="builder-help">
            Choose two cantrips (spells you can cast without spell slots) and one level 1 spell.
            This feat gives one free cast of its level 1 spell per Long Rest. Your chosen ability
            affects spell attack rolls and how hard these spells are to resist.
          </p>
          <label>
            Magic Initiate spell list
            <select
              disabled={identityLocked || !!forcedList}
              value={current.spellList ?? ''}
              onChange={(e) =>
                update({ spellList: e.target.value as 'Cleric' | 'Druid' | 'Wizard', spells: [] })
              }
            >
              <option value="">Choose…</option>
              {['Cleric', 'Druid', 'Wizard'].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          {forcedList && (
            <p className="builder-help">Your background grants the {forcedList} spell list.</p>
          )}
          <label>
            Spellcasting ability
            <select
              disabled={identityLocked}
              value={current.spellAbility ?? ''}
              onChange={(e) =>
                update({ spellAbility: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            >
              <option value="">Choose…</option>
              {abilityNames.slice(3).map((name, i) => (
                <option key={name} value={i + 3}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={spellsLocked}>
            {[0, 1].map((level) => (
              <Picks
                key={level}
                label={level === 0 ? 'Cantrips' : 'Level 1 spell'}
                values={current.spells.filter((id) => srdById.get(id)?.level === level)}
                count={level === 0 ? 2 : 1}
                options={asOptions(
                  srdCatalog
                    .filter(
                      (e) =>
                        e.category === 'spell' &&
                        e.classes?.includes(current.spellList ?? '') &&
                        e.level === level,
                    )
                    .map((e) => e.id),
                )}
                onChange={(spells) =>
                  update({
                    spells: [
                      ...current.spells.filter((id) => srdById.get(id)?.level !== level),
                      ...spells,
                    ],
                  })
                }
              />
            ))}
          </fieldset>
        </>
      )}
    </fieldset>
  );
}
function LevelChoices({
  draft,
  index,
  onChange,
  appliedLevels = 0,
}: {
  draft: SrdBuilderState;
  index: number;
  onChange: (value: SrdLevelChoice) => void;
  appliedLevels?: number;
}) {
  const step = draft.levels[index],
    name = step.className;
  const level = draft.levels.slice(0, index + 1).filter((s) => s.className === name).length;
  const limits = classSpellLimits(name, level);
  const patch = (value: Partial<SrdLevelChoice>) => {
    const next = { ...step, ...value };
    const state = { ...draft, levels: draft.levels.map((row, i) => (i === index ? next : row)) };
    const automatic = automaticPreparedIds(state, name, index + 1);
    next.spells = next.spells.filter((id) => !automatic.has(id));
    next.cantrips = next.cantrips.filter((id) => !automatic.has(id));
    if (name === 'Wizard') next.spells = next.spells.filter((id) => next.spellbook.includes(id));
    next.choices = { ...next.choices };
    if (
      !next.choices['fighting-style']?.some((style) =>
        ['Blessed Warrior', 'Druidic Warrior'].includes(style),
      )
    )
      delete next.choices['warrior-cantrips'];
    if (value.cantrips)
      for (const id of next.options)
        if (/a Warlock Cantrip/.test(srdById.get(id)?.text ?? '') && next.choices[id])
          next.choices[id] = next.choices[id].filter((spell) =>
            warlockCantripIds(next).includes(spell),
          );
    onChange(next);
  };
  const choice = (key: string, values: string[]) =>
    patch({ choices: { ...step.choices, [key]: values } });
  const setOptions = (options: string[]) => {
    const choices = Object.fromEntries(
      Object.entries(step.choices).filter(
        ([key]) => !step.options.includes(key) || options.includes(key),
      ),
    );
    for (const id of options)
      if (/a Warlock Cantrip/.test(srdById.get(id)?.text ?? '') && choices[id])
        choices[id] = choices[id].slice(0, options.filter((value) => value === id).length);
    const lessons = options.filter(
      (id) => srdById.get(id)?.name === 'Lessons of the First Ones',
    ).length;
    patch({ options, choices, invocationFeats: step.invocationFeats.slice(0, lessons) });
  };
  const skills = name === 'Bard' && level === 3 ? allSkills : classRules[name].skills;
  const extraCantrip = draft.levels
    .slice(0, index + 1)
    .some(
      (s) =>
        s.className === name &&
        (s.choices['divine-order']?.includes('Thaumaturge') ||
          s.choices['primal-order']?.includes('Magician')),
    )
    ? 1
    : 0;
  const spells = srdCatalog.filter(
    (e) =>
      e.category === 'spell' &&
      (e.classes?.includes(name) ||
        (name === 'Bard' &&
          level >= 10 &&
          e.classes?.some((n) => ['Cleric', 'Druid', 'Wizard'].includes(n)))),
  );
  const automatic = automaticPreparedIds(draft, name, index + 1);
  const spellOptions = spells
    .filter((e) => (e.level ?? 0) > 0 && (e.level ?? 10) <= limits.maxLevel)
    .map((e) => ({ value: e.id, label: `${e.name} · level ${e.level}` }));
  const features = srdCatalog.filter(
    (e) => e.category === 'feature' && e.className === name && e.level === level,
  );
  const count = skillChoicesAt(name, level, index === 0),
    expertise = expertiseChoicesAt(name, level);
  const priorSkills = new Set<string>([
    ...backgrounds[draft.background].skills,
    draft.speciesSkill,
    ...draft.replacementSkills,
    ...(draft.originFeat?.skills ?? []),
    ...(draft.humanFeat?.skills ?? []),
    ...draft.levels
      .slice(0, index)
      .flatMap((s) => [...s.skills, ...s.replacementSkills, ...(s.feat?.skills ?? [])]),
  ]);
  const replacements = step.skills.filter((skill) => priorSkills.has(skill)).length;
  return (
    <div className="stack">
      <p>
        Character level {index + 1}; {name} class level {level}. Hit Die d{classRules[name].die}.
      </p>
      {level >= 3 && (
        <p>
          SRD subclass:{' '}
          {srdCatalog.find((e) => e.category === 'subclass' && e.className === name)?.name} (only
          SRD option).
        </p>
      )}
      <label>
        HP die result before Constitution (fixed average or recorded roll)
        <input
          type="number"
          min={1}
          max={classRules[name].die}
          disabled={index === 0}
          value={step.hp}
          onChange={(e) => patch({ hp: Number(e.target.value) })}
        />
      </label>
      {count > 0 && (
        <Picks
          label="Class skills"
          values={step.skills}
          count={count}
          options={asOptions(skills)}
          onChange={(skills) => patch({ skills, replacementSkills: [] })}
        />
      )}
      {replacements > 0 && (
        <Picks
          label="Replace overlapping class skill proficiencies"
          count={replacements}
          values={step.replacementSkills}
          options={asOptions(
            allSkills.filter((skill) => !priorSkills.has(skill) && !step.skills.includes(skill)),
          )}
          onChange={(replacementSkills) => patch({ replacementSkills })}
        />
      )}
      {expertise > 0 && (
        <Picks
          label="Expertise (must already be proficient)"
          values={step.expertise}
          count={expertise}
          options={asOptions(allSkills)}
          onChange={(expertise) => patch({ expertise })}
        />
      )}
      {featureChoicesAt(name, level, index === 0).map((item) => (
        <Picks
          key={item.key}
          label={item.label}
          values={step.choices[item.key] ?? []}
          count={item.count}
          options={asOptions(item.options)}
          onChange={(values) => choice(item.key, values)}
        />
      ))}
      {step.choices['fighting-style']?.some((value) =>
        ['Blessed Warrior', 'Druidic Warrior'].includes(value),
      ) && (
        <Picks
          label="Warrior cantrips"
          count={2}
          values={step.choices['warrior-cantrips'] ?? []}
          options={asOptions(
            srdCatalog
              .filter(
                (e) =>
                  e.category === 'spell' &&
                  e.level === 0 &&
                  e.classes?.includes(name === 'Paladin' ? 'Cleric' : 'Druid'),
              )
              .map((e) => e.id),
          )}
          onChange={(values) => choice('warrior-cantrips', values)}
        />
      )}
      {masteryCount(name, level) > 0 && (
        <Picks
          label="Weapon mastery"
          values={step.mastery}
          count={masteryCount(name, level)}
          options={asOptions(weaponNames)}
          onChange={(mastery) => patch({ mastery })}
        />
      )}
      {optionCount(name, level) > 0 && (
        <>
          <Picks
            label={name === 'Warlock' ? 'Eldritch Invocations' : 'Metamagic'}
            count={optionCount(name, level)}
            values={step.options}
            options={allowedOptions(name, level, step.options).map((e) => ({
              value: e.id,
              label: e.name,
            }))}
            onChange={setOptions}
          />
          {[...new Set(step.options)].map((id) => {
            const entry = srdById.get(id);
            return (
              <details key={id}>
                <summary>{entry?.name} rules</summary>
                <p style={{ whiteSpace: 'pre-wrap' }}>{entry?.text}</p>
                <p>
                  Selected copies: {step.options.filter((value) => value === id).length}.{' '}
                  <button
                    type="button"
                    onClick={() => {
                      const options = [...step.options];
                      options.splice(options.indexOf(id), 1);
                      setOptions(options);
                    }}
                  >
                    Remove one {entry?.name}
                  </button>
                </p>
                {entry?.text.includes('Repeatable.') && (
                  <button
                    type="button"
                    disabled={step.options.length >= optionCount(name, level)}
                    onClick={() => setOptions([...step.options, id])}
                  >
                    Take another {entry.name}
                  </button>
                )}
                {entry && /a Warlock Cantrip/.test(entry.text) && (
                  <Picks
                    label="Invocation cantrip"
                    values={step.choices[id] ?? []}
                    count={step.options.filter((value) => value === id).length}
                    options={asOptions(warlockCantripIds(step))}
                    onChange={(values) => choice(id, values)}
                  />
                )}
                {entry?.name === 'Pact of the Tome' && (
                  <Picks
                    label="Book of Shadows (three cantrips + two level 1 rituals)"
                    values={step.choices[id] ?? []}
                    count={5}
                    options={srdCatalog
                      .filter(
                        (e) =>
                          e.category === 'spell' &&
                          (e.level === 0 || (e.level === 1 && /Ritual/.test(e.text))),
                      )
                      .map((e) => ({
                        value: e.id,
                        label: `${e.name} · ${e.level === 0 ? 'cantrip' : 'level 1 ritual'}`,
                      }))}
                    onChange={(values) => choice(id, values)}
                  />
                )}
              </details>
            );
          })}
          {Array.from(
            {
              length: step.options.filter(
                (id) => srdById.get(id)?.name === 'Lessons of the First Ones',
              ).length,
            },
            (_, i) => (
              <FeatChoices
                key={i}
                origin
                total={index + 1}
                value={step.invocationFeats[i]}
                onChange={(feat) => {
                  const invocationFeats = [...step.invocationFeats];
                  invocationFeats[i] = feat;
                  patch({ invocationFeats });
                }}
              />
            ),
          )}
        </>
      )}
      {limits.cantrips + extraCantrip > 0 && (
        <Picks
          label="Cantrips"
          values={step.cantrips}
          count={limits.cantrips + extraCantrip}
          options={asOptions(
            spells
              .filter((e) => e.level === 0 && e.classes?.includes(name) && !automatic.has(e.id))
              .map((e) => e.id),
          )}
          onChange={(cantrips) => patch({ cantrips })}
        />
      )}
      {limits.spellbook > 0 && (
        <Picks
          label={`Wizard spellbook (at least ${limits.spellbook}; additional copied/savant spells permitted)`}
          count={100}
          values={step.spellbook}
          options={spellOptions}
          onChange={(spellbook) => patch({ spellbook })}
        />
      )}
      {limits.prepared > 0 && (
        <Picks
          label="Prepared spells (class level limits, not multiclass slots)"
          values={step.spells}
          count={limits.prepared}
          options={(name === 'Wizard'
            ? spellOptions.filter((e) => step.spellbook.includes(e.value))
            : spellOptions
          ).filter((e) => !automatic.has(e.value))}
          onChange={(spells) => patch({ spells })}
        />
      )}
      {automatic.size > 0 && (
        <p>
          Additional always-prepared spells (do not use selection quota):{' '}
          {[...automatic].map((id) => srdById.get(id)?.name).join(', ')}.
        </p>
      )}
      {featAt(name, level) && (
        <FeatChoices
          value={step.feat}
          total={index + 1}
          identityLocked={index < appliedLevels}
          spellsLocked={index < appliedLevels && draft.levels.length === appliedLevels}
          onChange={(feat) => patch({ feat })}
        />
      )}
      <details>
        <summary>
          Features granted at {name} {level}
        </summary>
        {features.map((feature) => (
          <details key={feature.id}>
            <summary>
              {feature.name} · p.{feature.page}
            </summary>
            <p style={{ whiteSpace: 'pre-wrap' }}>{feature.text}</p>
          </details>
        ))}
      </details>
    </div>
  );
}
function DraftBuilder({
  commit,
  sheet,
  update,
  close,
}: {
  sheet: Sheet;
  update: (edit: (s: Sheet) => void) => void;
  close: () => void;
  commit?: (sheet: Sheet) => Promise<boolean>;
}) {
  const [initial] = useState(() => JSON.stringify(sheet));
  const [draft, setDraft] = useState<SrdBuilderState>(() => {
    const saved = sheet.character?.builder;
    const value = saved ? structuredClone(saved) : newSrdState();
    value.equipment = { ...defaultEquipment(), ...value.equipment };
    value.companions = { ...defaultCompanions(), ...value.companions };
    if (!saved) value.originFeat = defaultBackgroundFeat(value.background);
    return value;
  });
  const [selected, setSelected] = useState(draft.levels.length - 1);
  const [nextClass, setNextClass] = useState<SrdClass>(draft.levels.at(-1)!.className);
  const [failure, setFailure] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const patch = (value: Partial<SrdBuilderState>) =>
    setDraft((current) => ({ ...current, ...value }));
  const derived = deriveSrd(draft);
  const loadout = deriveEquipment(draft, draftEquipmentItems(sheet, draft), derived.scores);
  const errors = [
    ...builderErrors(draft),
    ...loadout.errors,
    ...(sheet.character?.builder ? srdTransitionErrors(sheet.character.builder, draft) : []),
  ];
  const stale = initial !== JSON.stringify(sheet);
  const counts = classLevels(draft.levels);
  const backgroundRules = backgrounds[draft.background];
  function addLevel() {
    const previous = draft.levels.findLast((step) => step.className === nextClass);
    const level = blankLevel(nextClass);
    if (previous) {
      level.cantrips = [...previous.cantrips];
      level.spells = [...previous.spells];
      level.spellbook = [...previous.spellbook];
      level.options = [...previous.options];
      level.mastery = [...previous.mastery];
      level.invocationFeats = structuredClone(previous.invocationFeats);
      level.choices = structuredClone(
        Object.fromEntries(
          Object.entries(previous.choices).filter(
            ([key]) =>
              previous.options.includes(key) ||
              ['magical-discoveries', 'wild-shape-forms', 'land'].includes(key),
          ),
        ),
      );
    }
    const levels = [...draft.levels, level];
    const automatic = automaticPreparedIds({ ...draft, levels }, nextClass);
    level.spells = level.spells.filter((id) => !automatic.has(id));
    level.cantrips = level.cantrips.filter((id) => !automatic.has(id));
    patch({ levels });
    setSelected(draft.levels.length);
  }
  return (
    <dialog
      ref={dialog}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="srd-builder-title"
      style={{ width: 'min(70rem, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}
    >
      <div className="stack">
        <div className="row">
          <h2 id="srd-builder-title">SRD 5.2.1 character builder</h2>
          <button type="button" onClick={close}>
            Cancel draft
          </button>
        </div>
        <p>
          Draft only. Apply updates the unsaved sheet; use Save sheet to persist. Cancel/Escape
          discards this draft.
        </p>
        <nav className="builder-journey" aria-label="Builder sections">
          <a href="#builder-origin">1. Origin & abilities</a>
          <a href="#builder-progression">2. Class choices</a>
          <a href="#builder-equipment">3. Equipment</a>
          <a href="#builder-review">4. Review & apply</a>
        </nav>
        <details className="builder-guide">
          <summary>New player? Start here</summary>
          <p>
            Class is your adventuring role. Background is your life before adventuring; species
            gives inherited traits. Ability scores describe your strengths, and proficiency means
            training that adds your proficiency bonus to a roll.
          </p>
          <p>
            Complete origin choices, then your class choices and equipment. Review the preview and
            remaining selections, Apply, then Save sheet. Nothing is saved by Apply alone.
          </p>
        </details>
        <p className="notice">
          Core progression is automated. Review source rules for conditional combat effects,
          conditional encounter effects and any explicitly listed unsupported choices below.
          Equipment, AC, Speed, and ready attacks are applied from the loadout. This is not an
          independently verified complete rules implementation.
        </p>
        {stale && (
          <p role="alert">
            Sheet changed while this draft was open. Cancel and reopen before applying.
          </p>
        )}
        <details id="builder-origin" open={!sheet.character?.builder}>
          <summary>Origin & ability generation</summary>
          <fieldset disabled={!!sheet.character?.builder}>
            <legend>Origin (locked after first apply; detach for manual rebuild)</legend>
            <label>
              Starting class
              <select
                value={draft.levels[0].className}
                onChange={(e) => {
                  const name = e.target.value as SrdClass;
                  patch({
                    levels: [{ ...blankLevel(name), hp: classRules[name].die }],
                    classEquipment: 'A',
                  });
                  setNextClass(name);
                  setSelected(0);
                }}
              >
                {srdClasses.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Ability generation
              <select
                value={draft.abilityMethod}
                onChange={(e) =>
                  patch({
                    abilityMethod: e.target.value as SrdBuilderState['abilityMethod'],
                    rolls: undefined,
                  })
                }
              >
                <option value="standard">Standard array</option>
                <option value="point-buy">27-point buy</option>
                <option value="rolled">4d6, drop lowest (recorded rolls)</option>
              </select>
            </label>
            {draft.abilityMethod === 'rolled' && (
              <button
                type="button"
                onClick={() => {
                  const die = () => {
                    const value = new Uint32Array(1);
                    do {
                      crypto.getRandomValues(value);
                    } while (value[0] >= 4294967292);
                    return (value[0] % 6) + 1;
                  };
                  const rolls = Array.from({ length: 6 }, () => Array.from({ length: 4 }, die));
                  patch({
                    rolls,
                    baseScores: rolls.map((roll) =>
                      [...roll]
                        .sort((a, b) => b - a)
                        .slice(0, 3)
                        .reduce((a, b) => a + b, 0),
                    ),
                  });
                }}
              >
                Roll six ability scores
              </button>
            )}
            {draft.rolls && (
              <p>
                Recorded 4d6: {draft.rolls.map((roll) => `[${roll.join(', ')}]`).join(' · ')}.
                Assign totals below.
              </p>
            )}
            <div className="row">
              {abilityNames.map((name, i) => (
                <label key={name}>
                  {name} base
                  <input
                    type="number"
                    min={3}
                    max={18}
                    value={draft.baseScores[i]}
                    onChange={(e) =>
                      patch({
                        baseScores: draft.baseScores.map((value, j) =>
                          i === j ? Number(e.target.value) : value,
                        ),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Background
              <select
                value={draft.background}
                onChange={(e) => {
                  const background = e.target.value as SrdBuilderState['background'];
                  patch({
                    background,
                    backgroundBoosts: [0, 0, 0, 0, 0, 0],
                    originFeat: defaultBackgroundFeat(background),
                    tools: [],
                    replacementSkills: [],
                  });
                }}
              >
                {srdBackgrounds.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <p>Background boosts: +2/+1 or +1/+1/+1 among its three abilities.</p>
            <Increases
              values={draft.backgroundBoosts}
              allowed={backgrounds[draft.background].abilities}
              onChange={(backgroundBoosts) => patch({ backgroundBoosts })}
            />
            <FeatChoices
              label="Background feat"
              value={draft.originFeat}
              total={0}
              origin
              forced={backgrounds[draft.background].feat}
              forcedList={'magicList' in backgroundRules ? backgroundRules.magicList : undefined}
              onChange={(originFeat) => patch({ originFeat })}
            />
            <label>
              Species
              <select
                value={draft.species}
                onChange={(e) => {
                  const species = e.target.value as SrdBuilderState['species'];
                  patch({
                    species,
                    lineage: '',
                    speciesSkill: '',
                    speciesCantrip: '',
                    replacementSkills: [],
                    size: ['Gnome', 'Halfling'].includes(species) ? 'Small' : 'Medium',
                    humanFeat: undefined,
                  });
                }}
              >
                {srdSpecies.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            {lineages[draft.species] && (
              <label>
                Lineage / ancestry
                <select
                  value={draft.lineage}
                  onChange={(e) => patch({ lineage: e.target.value, speciesCantrip: '' })}
                >
                  <option value="">Choose…</option>
                  {lineages[draft.species].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            {['Elf', 'Gnome', 'Tiefling'].includes(draft.species) && (
              <label>
                Species spellcasting ability
                <select
                  value={draft.speciesSpellAbility}
                  onChange={(e) => patch({ speciesSpellAbility: Number(e.target.value) })}
                >
                  {abilityNames.slice(3).map((name, i) => (
                    <option key={name} value={i + 3}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {['Human', 'Elf'].includes(draft.species) && (
              <label>
                Species skill
                <select
                  value={draft.speciesSkill}
                  onChange={(e) => patch({ speciesSkill: e.target.value, replacementSkills: [] })}
                >
                  <option value="">Choose…</option>
                  {(draft.species === 'Elf'
                    ? ['Insight', 'Perception', 'Survival']
                    : allSkills
                  ).map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            {(backgrounds[draft.background].skills as readonly string[]).includes(
              draft.speciesSkill,
            ) && (
              <Picks
                label="Replacement for overlapping origin skill"
                count={1}
                values={draft.replacementSkills}
                options={asOptions(
                  allSkills.filter(
                    (skill) =>
                      !(backgrounds[draft.background].skills as readonly string[]).includes(skill),
                  ),
                )}
                onChange={(replacementSkills) => patch({ replacementSkills })}
              />
            )}
            {['Human', 'Tiefling'].includes(draft.species) && (
              <label>
                Size
                <select
                  value={draft.size}
                  onChange={(e) => patch({ size: e.target.value as 'Small' | 'Medium' })}
                >
                  <option>Medium</option>
                  <option>Small</option>
                </select>
              </label>
            )}
            {draft.species === 'Human' && (
              <FeatChoices
                label="Human bonus feat"
                value={draft.humanFeat}
                total={0}
                origin
                onChange={(humanFeat) => patch({ humanFeat })}
              />
            )}
            <Picks
              label="Standard languages (plus Common)"
              count={2}
              values={draft.languages}
              options={asOptions(standardLanguages)}
              onChange={(languages) => patch({ languages })}
            />
            <label>
              Alignment
              <select
                value={draft.alignment}
                onChange={(e) =>
                  patch({ alignment: e.target.value as SrdBuilderState['alignment'] })
                }
              >
                {srdAlignments.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            {draft.background === 'Soldier' && (
              <Picks
                label="Soldier Gaming Set"
                count={1}
                values={draft.tools}
                options={asOptions(gamingSets)}
                onChange={(tools) => patch({ tools })}
              />
            )}
          </fieldset>
        </details>
        {sheet.character?.builder &&
          (
            [
              ['Background', draft.originFeat, 'originFeat'],
              ['Human', draft.humanFeat, 'humanFeat'],
            ] as const
          )
            .filter(([, feat]) => srdById.get(feat?.id ?? '')?.name === 'Magic Initiate')
            .map(([label, feat, key]) => (
              <section key={key}>
                <h3>{label} Magic Initiate · level-up spell changes</h3>
                <p>
                  Origin identity/list/ability remain locked. One chosen spell may change per gained
                  character level, to the same spell level and list (SRD p.87).{' '}
                  {draft.levels.length - sheet.character!.builder!.levels.length} replacement(s)
                  available in this draft.
                </p>
                <FeatChoices
                  value={feat}
                  identityLocked
                  spellsLocked={draft.levels.length === sheet.character!.builder!.levels.length}
                  total={draft.levels.length}
                  onChange={(value) => patch({ [key]: { ...feat!, spells: value.spells } })}
                />
              </section>
            ))}
        <section id="builder-progression" className="stack" aria-label="Class progression">
          <h3>Class progression · total level {derived.total}</h3>
          {draft.lineage === 'High Elf' && (
            <Picks
              label="High Elf Wizard cantrip (replace after a Long Rest)"
              count={1}
              values={draft.speciesCantrip ? [draft.speciesCantrip] : []}
              options={asOptions(
                srdCatalog
                  .filter(
                    (entry) =>
                      entry.category === 'spell' &&
                      entry.level === 0 &&
                      entry.classes?.includes('Wizard'),
                  )
                  .map((entry) => entry.id),
              )}
              onChange={(values) => patch({ speciesCantrip: values[0] ?? '' })}
            />
          )}
          <p>
            {Object.entries(counts)
              .map(([name, level]) => `${name} ${level}`)
              .join(' / ')}
          </p>
          <label>
            Edit class level
            <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
              {draft.levels.map((step, i) => (
                <option key={i} value={i}>
                  Character {i + 1} · {step.className}
                </option>
              ))}
            </select>
          </label>
          <LevelChoices
            appliedLevels={sheet.character?.builder?.levels.length ?? 0}
            draft={draft}
            index={selected}
            onChange={(value) =>
              patch({ levels: draft.levels.map((step, i) => (i === selected ? value : step)) })
            }
          />
          {draft.levels.length < 20 && (
            <div className="row">
              <label>
                Next level class (multiclass requires primary abilities 13)
                <select
                  value={nextClass}
                  onChange={(e) => setNextClass(e.target.value as SrdClass)}
                >
                  {srdClasses.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={addLevel}>
                Add level {draft.levels.length + 1}
              </button>
            </div>
          )}
          {draft.levels.length > (sheet.character?.builder?.levels.length ?? 1) && (
            <button
              type="button"
              onClick={() => {
                patch({ levels: draft.levels.slice(0, -1) });
                setSelected(Math.min(selected, draft.levels.length - 2));
              }}
            >
              Undo last draft level
            </button>
          )}
        </section>
        <section id="builder-equipment" className="stack" aria-label="Equipment and companions">
          <h3>Equipment & companions</h3>
          <p className="builder-help">
            Starting equipment comes from your class and background. Choose what to equip; your
            armor and weapons determine your Armor Class and ready attacks.
          </p>
          <SrdEquipmentControls
            sheet={sheet}
            state={draft}
            onChange={(equipment) => patch({ equipment })}
            onPackageChange={patch}
          />
          <SrdShapesControls
            state={draft}
            sheet={sheet}
            onChange={(companions) => patch({ companions })}
          />
        </section>
        <section id="builder-review" aria-label="Progression preview">
          <h3>Preview</h3>
          <p>
            Hit Point maximum {derived.hp} · Proficiency bonus +{derived.pb} · Hit Dice{' '}
            {Object.entries(derived.hitDice)
              .map(([die, count]) => `${count}d${die}`)
              .join(' + ')}
          </p>
          <p>
            Spellcasting slots:{' '}
            {derived.slots
              .map((count, i) => (count ? `${count} × level ${i + 1}` : ''))
              .filter(Boolean)
              .join(', ') || 'none'}
            . Pact Magic: {derived.pact.count} × level {derived.pact.level}, separately tracked.
          </p>
          <p>Scores: {abilityNames.map((name, i) => `${name} ${derived.scores[i]}`).join(' · ')}</p>
          <p>
            Speed base {derived.speed}; non-heavy {derived.nonHeavySpeed}; unarmored Monk{' '}
            {derived.unarmoredSpeed}. The loadout applies eligible Speed and preserves later manual
            offsets; Manual AC / Speed preserves the existing fields entirely.
          </p>
          <p>
            Attacks per Attack action: {derived.attacks}
            {derived.pactAttacks !== derived.attacks && `; pact weapon ${derived.pactAttacks}`}.
            Extra Attack features do not stack.
          </p>
          <p>
            Alternative AC formulas (choose one, never add together):{' '}
            {derived.acOptions.map((option) => `${option.name} ${option.ac}`).join('; ')}. The
            loadout selects one eligible formula and applies armor, trained Shield and Defense.
            Temporary/unsupported bonuses remain manual.
          </p>
          {draft.species === 'Dragonborn' && (
            <p>
              Breath weapon: {derived.dragonBreathDice}d10; {derived.pb} uses.{' '}
              {derived.total >= 5 && 'Draconic Flight unlocked.'}
            </p>
          )}
        </section>
        {errors.length > 0 && (
          <details open>
            <summary>{errors.length} selections to resolve before Apply</summary>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </details>
        )}
        {failure && <p role="alert">{failure}</p>}
        <div className="row builder-actions">
          <button
            type="button"
            disabled={stale || errors.length > 0}
            onClick={async () => {
              try {
                const next = applySrdBuilder(sheet, draft);
                if (commit) {
                  if (await commit(next)) close();
                  else setFailure('Could not confirm this progression. Check the sheet revision.');
                  return;
                }
                update((target) => {
                  target.character = next.character;
                  target.sections = next.sections;
                });
                close();
              } catch (error) {
                setFailure((error as Error).message);
              }
            }}
          >
            {commit ? 'Apply and save to table' : 'Apply builder to unsaved sheet'}
          </button>
          <button type="button" onClick={close}>
            Cancel draft
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function SrdBuilder({
  commit,
  sheet,
  editable,
  update,
  initialOpen = false,
}: {
  sheet: Sheet;
  editable: boolean;
  update: (edit: (s: Sheet) => void) => void;
  initialOpen?: boolean;
  commit?: (sheet: Sheet) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [catalogNotice, setCatalogNotice] = useState('');
  return (
    <section className="stack" aria-label="SRD character tools">
      <div className="row">
        <button type="button" disabled={!editable} onClick={() => setOpen(true)}>
          {sheet.character?.builder ? 'Progress / level up character' : 'Create with SRD builder'}
        </button>
        {sheet.character?.builder && (
          <button
            type="button"
            className="ghost"
            disabled={!editable}
            onClick={() => {
              if (
                window.confirm(
                  'Use manual progression? Current values, spells, features, and spent resources stay on the sheet. The builder will no longer automate future progression or class-based casting.',
                )
              )
                update((target) => {
                  target.character ??= emptyCharacterDetails();
                  delete target.character.builder;
                });
            }}
          >
            Use manual progression
          </button>
        )}
      </div>
      <SrdCatalog
        onAddItem={
          editable
            ? (entry) => {
                if ((sheet.character?.items.length ?? 0) >= 200) {
                  setCatalogNotice('Inventory has reached the 200-entry limit.');
                  return;
                }
                const header = entry.text.slice(0, 250);
                const rarity = (
                  entry.rarity ??
                  /\b(Very Rare|Uncommon|Common|Rare|Legendary|Artifact)\b/i.exec(header)?.[1]
                )?.toLowerCase();
                const rarities = {
                  common: 'Common',
                  uncommon: 'Uncommon',
                  rare: 'Rare',
                  'very rare': 'Very rare',
                  legendary: 'Legendary',
                  artifact: 'Artifact',
                } as const;
                update((target) => {
                  target.character ??= emptyCharacterDetails();
                  target.character.items.push({
                    id: crypto.randomUUID(),
                    name: (entry.inventoryName ?? entry.name).slice(0, 80),
                    description: srdExcerpt(entry),
                    rarity: rarities[rarity as keyof typeof rarities] ?? 'Common',
                    quantity: entry.purchaseQuantity ?? 1,
                    requiresAttunement:
                      entry.requiresAttunement ?? /Requires Attunement/i.test(header),
                    attuned: false,
                  });
                });
                setCatalogNotice(
                  `Added ${entry.name} to unsaved inventory. Review variant, rarity, and quantity; Save sheet to persist.`,
                );
              }
            : undefined
        }
      />
      {catalogNotice && <p role="status">{catalogNotice}</p>}
      {open && editable && (
        <DraftBuilder sheet={sheet} update={update} commit={commit} close={() => setOpen(false)} />
      )}
    </section>
  );
}
