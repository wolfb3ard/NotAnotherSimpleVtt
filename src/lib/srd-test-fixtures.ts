import { srdById, srdCatalog, srdEntry } from './srd-catalog';
import {
  allSkills,
  backgrounds,
  classRules,
  classSpellLimits,
  srdClasses,
  type SrdClass,
} from './srd-rules';
import {
  allowedOptions,
  automaticPreparedIds,
  blankFeat,
  blankLevel,
  builderScores,
  defaultBackgroundFeat,
  expertiseChoicesAt,
  featureChoicesAt,
  masteryCount,
  newSrdState,
  optionCount,
  skillChoicesAt,
  weaponNames,
  type SrdBuilderState,
} from './srd-state';
import { featAt } from './srd-state';

export function fighterBuilder(levels = 1): SrdBuilderState {
  const state = newSrdState();
  state.originFeat = defaultBackgroundFeat('Soldier');
  state.speciesSkill = 'Stealth';
  state.humanFeat = {
    ...blankFeat(srdEntry('feat', 'Skilled')!.id),
    skills: ['Arcana', 'Investigation', 'Medicine'],
  };
  state.languages = ['Elvish', 'Dwarvish'];
  state.tools = ['Dice'];
  state.levels = [];
  for (let level = 1; level <= levels; level++) {
    const step = blankLevel('Fighter');
    step.hp = level === 1 ? 10 : 6;
    step.skills = level === 1 ? ['Perception', 'Insight'] : [];
    step.mastery = ['Longsword', 'Longbow', 'Battleaxe', 'Greatsword', 'Spear', 'Dagger'].slice(
      0,
      level >= 16 ? 6 : level >= 10 ? 5 : level >= 4 ? 4 : 3,
    );
    if (level === 1 || level === 7)
      step.choices['fighting-style'] = [level === 1 ? 'Defense' : 'Archery'];
    if (featAt('Fighter', level)) {
      const feat = blankFeat(
        srdEntry('feat', level === 19 ? 'Boon of Combat Prowess' : 'Ability Score Improvement')!.id,
      );
      const scores = builderScores({ ...state, levels: [...state.levels, step] });
      let amount = level === 19 ? 1 : 2;
      for (let i = 0; i < 6 && amount > 0; i++) {
        const increase = Math.min(amount, Math.max(0, 20 - scores[i]));
        feat.increases[i] = increase;
        amount -= increase;
      }
      step.feat = feat;
    }
    state.levels.push(step);
  }
  return state;
}

/** Deterministic, legal choices for cross-class progression regression tests. */
export function classBuilder(name: SrdClass, levels = 1): SrdBuilderState {
  if (name === 'Fighter') return fighterBuilder(levels);
  const state = fighterBuilder();
  state.levels = [];
  if (name === 'Bard') state.equipment.instrument = 'Bagpipes';
  const known = new Set<string>([
    ...backgrounds.Soldier.skills,
    state.speciesSkill,
    ...state.humanFeat!.skills,
  ]);
  const expert = new Set<string>();
  for (let level = 1; level <= levels; level++) {
    const step = blankLevel(name),
      previous = state.levels.at(-1),
      limits = classSpellLimits(name, level);
    step.hp = level === 1 ? classRules[name].die : classRules[name].die / 2 + 1;
    const number = skillChoicesAt(name, level, level === 1);
    const skillList = name === 'Bard' && level === 3 ? allSkills : classRules[name].skills;
    step.skills = skillList.filter((skill) => !known.has(skill)).slice(0, number);
    step.skills.forEach((skill) => known.add(skill));
    step.expertise = [...known]
      .filter(
        (skill) =>
          !expert.has(skill) &&
          (name !== 'Wizard' ||
            ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion'].includes(
              skill,
            )),
      )
      .slice(0, expertiseChoicesAt(name, level));
    step.expertise.forEach((skill) => expert.add(skill));
    for (const item of featureChoicesAt(name, level, level === 1)) {
      step.choices[item.key] =
        item.key === 'primal-order'
          ? ['Warden']
          : item.options
              .filter((id) => item.key !== 'evocation-savant' || !previous?.spellbook.includes(id))
              .slice(0, item.count);
    }
    step.mastery = (name === 'Rogue' ? ['Dagger', 'Shortbow'] : weaponNames).slice(
      0,
      masteryCount(name, level),
    );
    if (optionCount(name, level)) {
      let options: string[] = previous?.options ?? [];
      const available = allowedOptions(name, level, options).filter(
        (e) =>
          !/a Warlock Cantrip/.test(e.text) &&
          !['Pact of the Tome', 'Lessons of the First Ones'].includes(e.name),
      );
      options = [...new Set([...options, ...available.map((e) => e.id)])].slice(
        0,
        optionCount(name, level),
      );
      step.options = options;
    }
    const spells = srdCatalog.filter((e) => e.category === 'spell' && e.classes?.includes(name));
    const extra = step.choices['divine-order']?.includes('Thaumaturge') ? 1 : 0;
    step.cantrips = spells
      .filter((e) => e.level === 0)
      .slice(0, limits.cantrips + extra)
      .map((e) => e.id);
    const available = spells.filter(
      (e) => (e.level ?? 0) >= 1 && (e.level ?? 10) <= limits.maxLevel,
    );
    const retained = previous?.spells ?? [];
    step.spells = [...new Set([...retained, ...available.map((e) => e.id)])].slice(
      0,
      limits.prepared,
    );
    if (name === 'Wizard') {
      step.spellbook = [
        ...new Set([
          ...(previous?.spellbook ?? []),
          ...(step.choices['evocation-savant'] ?? []),
          ...available.map((e) => e.id),
        ]),
      ].slice(0, limits.spellbook);
      step.spells = step.spellbook.slice(0, limits.prepared);
      for (const key of ['spell-mastery', 'signature-spells']) {
        const selected = step.choices[key];
        if (selected) {
          if (key === 'spell-mastery') {
            const options = featureChoicesAt(name, level).find((e) => e.key === key)!.options;
            step.choices[key] = [
              options.find((id) => srdById.get(id)?.level === 1)!,
              options.find((id) => srdById.get(id)?.level === 2)!,
            ];
          }
          step.spellbook = [...new Set([...step.spellbook, ...step.choices[key]])];
        }
      }
    }
    if (featAt(name, level)) {
      const feat = blankFeat(
        srdEntry('feat', level === 19 ? 'Boon of Combat Prowess' : 'Ability Score Improvement')!.id,
      );
      const scores = builderScores({ ...state, levels: [...state.levels, step] });
      let left = level === 19 ? 1 : 2;
      for (let i = 0; i < 6 && left; i++) {
        const increase = Math.min(left, Math.max(0, 20 - scores[i]));
        feat.increases[i] = increase;
        left -= increase;
      }
      step.feat = feat;
    }
    const automatic = automaticPreparedIds({ ...state, levels: [...state.levels, step] }, name);
    const eligible = (name === 'Wizard' ? step.spellbook : available.map((e) => e.id)).filter(
      (id) => !automatic.has(id),
    );
    step.spells = [
      ...new Set([...(previous?.spells ?? []).filter((id) => !automatic.has(id)), ...eligible]),
    ].slice(0, limits.prepared);
    const cantrips = spells.filter((e) => e.level === 0 && !automatic.has(e.id)).map((e) => e.id);
    step.cantrips = [
      ...new Set([...(previous?.cantrips ?? []).filter((id) => !automatic.has(id)), ...cantrips]),
    ].slice(0, limits.cantrips + extra);
    state.levels.push(step);
  }
  return state;
}

export function multiclassBuilder(): SrdBuilderState {
  const state = fighterBuilder();
  state.abilityMethod = 'point-buy';
  state.baseScores = [13, 13, 10, 13, 13, 13];
  const known = new Set<string>([
    ...backgrounds.Soldier.skills,
    state.speciesSkill,
    ...state.humanFeat!.skills,
    ...state.levels[0].skills,
  ]);
  for (const name of srdClasses.filter((name) => name !== 'Fighter')) {
    const step = structuredClone(classBuilder(name).levels[0]);
    step.hp = classRules[name].die / 2 + 1;
    step.skills = classRules[name].skills
      .filter((skill) => !known.has(skill))
      .slice(0, skillChoicesAt(name, 1, false));
    step.skills.forEach((skill) => known.add(skill));
    step.expertise = [...known].slice(0, expertiseChoicesAt(name, 1));
    step.choices = Object.fromEntries(
      featureChoicesAt(name, 1, false).map((choice) => [
        choice.key,
        choice.key === 'primal-order' ? ['Warden'] : choice.options.slice(0, choice.count),
      ]),
    );
    state.levels.push(step);
  }
  return state;
}

export function warlockTomeBuilder(): SrdBuilderState {
  const state = classBuilder('Warlock', 2);
  const tome = srdEntry('option', 'Pact of the Tome')!.id,
    agonizing = srdEntry('option', 'Agonizing Blast')!.id;
  const book = ['Fire Bolt', 'Light', 'Guidance', 'Alarm', 'Find Familiar'].map(
    (name) => srdEntry('spell', name)!.id,
  );
  for (const step of state.levels) {
    step.cantrips = ['Chill Touch', 'Eldritch Blast'].map((name) => srdEntry('spell', name)!.id);
    step.options = [tome];
    step.choices[tome] = [...book];
  }
  state.levels[1].options.push(agonizing, agonizing);
  state.levels[1].choices[agonizing] = ['Fire Bolt', 'Chill Touch'].map(
    (name) => srdEntry('spell', name)!.id,
  );
  return state;
}

export function magicInitiateBuilder(): SrdBuilderState {
  const state = fighterBuilder();
  state.humanFeat = {
    ...blankFeat(srdEntry('feat', 'Magic Initiate')!.id),
    spellList: 'Wizard',
    spellAbility: 5,
    spells: ['Fire Bolt', 'Mage Hand', 'Shield'].map((name) => srdEntry('spell', name)!.id),
  };
  return state;
}
