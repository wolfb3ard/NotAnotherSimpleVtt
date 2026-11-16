import data from './srd-data/monsters.json' with { type: 'json' };
import { srdCatalog, type SrdEntry } from './srd-catalog';
import { dndId, skills } from './dnd';
import { monsterId, monsterSourceId, monsterHpId, monsterTemporaryHpId } from './monster-sheet';
import type { Ability, Field, Section, Sheet } from './types';

export const srdMonsters = data;
export type SrdMonster = (typeof data)[number];
export const monsterById = new Map(srdMonsters.map((m) => [m.id, m]));
export function monsterSource(sheet: Sheet) {
  return monsterById.get(monsterId(sheet) ?? '');
}
const normalized = (text: string) =>
  text
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .replace(/−/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
const spells = srdCatalog
  .filter((e) => e.category === 'spell')
  .sort((a, b) => b.name.length - a.name.length);

/** Match source spell names, longest first; never invent a caster class or level. */
export function monsterSpells(
  monster: SrdMonster,
): { entry: SrdEntry; casting: string; uses?: number; levelOverride?: number }[] {
  const result = new Map<
    string,
    { entry: SrdEntry; casting: string; uses?: number; levelOverride?: number }
  >();
  for (const action of monster.actions) {
    let remaining = normalized(action.text);
    // Spell names may also occur in a dedicated action (Imp Invisibility, etc.).
    if (!/\bcasts?\b|\bSpellcasting\b/.test(remaining)) continue;
    const list =
      /\bSpellcasting\b/.test(action.name) || /(?:At Will|\d+\/Day(?: Each)?):/i.test(remaining);
    for (const entry of spells) {
      const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!list && !new RegExp(`\\bcasts? (?:the )?${escaped}\\b`).test(remaining)) continue;
      const pattern = new RegExp(`\\b${escaped}\\b`);
      const found = pattern.exec(remaining);
      if (!found) continue;
      const prefix = remaining.slice(0, found.index);
      const frequency = [
        ...prefix.matchAll(/(?:At Will|\d+\/Day(?: Each)?|\d+\/Rest(?: Each)?):/gi),
      ].at(-1)?.[0];
      const limited = frequency?.match(/^(\d+)\//);
      const override = remaining
        .slice(found.index + entry.name.length)
        .match(/^ \(level (\d+) version\)/i);
      result.set(entry.id, {
        entry,
        casting: action.text,
        ...(limited ? { uses: Number(limited[1]) } : {}),
        ...(override ? { levelOverride: Number(override[1]) } : {}),
      });
      remaining = remaining.replace(pattern, ' '.repeat(entry.name.length));
    }
  }
  return [...result.values()].sort((a, b) => a.entry.name.localeCompare(b.entry.name));
}

export function createMonsterSheet(id: string): Sheet {
  const monster = monsterById.get(id);
  if (!monster) throw new Error('Unknown SRD 5.2.1 monster.');
  const text = normalized(monster.text);
  const numberField = (key: string, label: string, value: number): Field => ({
    id: dndId(`monster:${key}`),
    label,
    kind: 'number',
    value,
  });
  const resource = (key: string, label: string, max: number): Field => ({
    id: dndId(`monster:${key}`),
    label,
    kind: 'resource',
    value: max,
    max,
  });
  const ability = (key: string, name: string, description: string, expression = ''): Ability => ({
    id: dndId(`monster:${key}`),
    name,
    description,
    expression,
  });
  const section = (key: string, title: string): Section => ({
    id: dndId(`monster:section:${key}`),
    title,
    fields: [],
    abilities: [],
  });
  const stats = section('stats', 'Statistics');
  const checks = section('checks', 'Checks and saves');
  const hp = monster.cr === null ? null : monster.text.match(/^HP (\d+)(?=\s*(?:\(|$))/m);
  // Summoned creatures have parameter-dependent HP/AC. Never present a partial
  // formula as the final value; the GM sets it in configuration using source.
  stats.fields.push(resource('hp', 'HP', hp ? Number(hp[1]) : 0));
  stats.fields.push({
    id: monsterTemporaryHpId,
    label: 'Temporary HP',
    kind: 'resource',
    value: 0,
    max: 1e12,
  });
  const ac = monster.text.match(/^AC (\d+)\s*$/m);
  if (ac) stats.fields.push(numberField('ac', 'AC', Number(ac[1])));
  stats.fields.push({
    id: dndId('monster:conditions'),
    label: 'Conditions / manual notes',
    kind: 'text',
    value: '',
  });
  for (const key of ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha']) {
    const values = text.match(new RegExp(`\\b${key}\\s+(\\d+)\\s*([+-]\\d+)\\s*([+-]?\\d+)`));
    if (!values) throw new Error(`Missing ${monster.name} ${key} ability table.`);
    stats.fields.push(numberField(`${key}:score`, key, Number(values[1])));
    for (const [index, label] of [
      [2, 'check'],
      [3, 'save'],
    ] as const)
      checks.abilities.push(
        ability(
          `${key}:${label}`,
          `${key} ${label}`,
          `Printed ${key} ${label} modifier.`,
          `1d20 + ${Number(values[index])}`,
        ),
      );
  }
  const initiative = text.match(/\bInitiative ([+-]\d+)/);
  if (initiative)
    checks.abilities.push(
      ability(
        'initiative',
        'Initiative',
        'Printed initiative modifier.',
        `1d20 + ${Number(initiative[1])}`,
      ),
    );
  const skillText =
    text.match(
      /\bSkills (.*?)(?:Resistances|Vulnerabilities|Immunities|Senses|Languages|CR)\b/,
    )?.[1] ?? '';
  for (const [name] of skills) {
    const match = skillText.match(new RegExp(`\\b${name} ([+-]\\d+)`));
    if (match)
      checks.abilities.push(
        ability(`skill:${name}`, name, 'Printed skill modifier.', `1d20 + ${Number(match[1])}`),
      );
  }
  const sections = [stats, checks];
  const counters = section('counters', 'Uses and recharge');
  for (const [i, action] of monster.actions.entries()) {
    let target = sections.find((s) => s.title === action.section);
    if (!target) {
      target = section(action.section, action.section);
      sections.push(target);
    }
    target.abilities.push(ability(`action:${i}`, action.name, action.text));
    const body = normalized(action.text);
    const attack = body.match(/Attack Roll: ([+-]\d+)/);
    if (attack)
      target.abilities.push(
        ability(`action:${i}:hit`, `${action.name} · Attack`, '', `1d20 + ${Number(attack[1])}`),
      );
    const fixedDamage = body.match(/\bHit:\s*(\d+)\s+[A-Za-z]+ damage/);
    if (fixedDamage)
      target.abilities.push(
        ability(
          `action:${i}:fixed`,
          `${action.name} · Damage 1`,
          'Printed fixed damage; no dice are invented.',
          fixedDamage[1],
        ),
      );
    // Each component is separate: conditional extra damage, healing and durations
    // are never silently combined. The complete paragraph remains directly above.
    for (const [j, dice] of [...body.matchAll(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/g)].entries()) {
      target.abilities.push(
        ability(
          `action:${i}:dice:${j}`,
          `${action.name} · Damage ${j + 1}`,
          'Source dice component; review its trigger and damage/healing type above.',
          dice[1].replace(/\s+/g, ' '),
        ),
      );
      const save = body.indexOf('Saving Throw:');
      if (attack && (save < 0 || (dice.index ?? 0) < save))
        target.abilities.push(
          ability(
            `action:${i}:critical:${j}`,
            `${action.name} · Critical damage ${j + 1}`,
            'Doubles these attack-hit dice, not the flat modifier. Confirm this component is eligible; conditional/save damage remains manual.',
            dice[1]
              .replace(
                /(\d+)d(\d+)/g,
                (_, count: string, die: string) => `${Number(count) * 2}d${die}`,
              )
              .replace(/\s+/g, ' '),
          ),
        );
    }
    if (/Recharge\b/.test(action.name))
      target.abilities.push(
        ability(
          `action:${i}:recharge`,
          `${action.name} · Recharge`,
          'Roll 1d6; recover a use manually only if the printed recharge condition succeeds.',
          '1d6',
        ),
      );
    const daily = action.name.match(/\((\d+)\/Day/);
    if (daily || /Recharges?\b/.test(action.name))
      counters.fields.push(
        resource(`action:${i}:uses`, `${action.name} uses`, daily ? Number(daily[1]) : 1),
      );
  }
  const legendary = text.match(/Legendary Action Uses: (\d+)/);
  if (legendary)
    counters.fields.push(resource('legendary', 'Legendary action uses', Number(legendary[1])));
  const casting = section('spells', 'Spells');
  for (const spell of monsterSpells(monster)) {
    casting.abilities.push(
      ability(
        `spell:${spell.entry.id}`,
        `Cast ${spell.entry.name}`,
        `Review the monster's casting restrictions and the full spell text. Casting is declared manually; rolls and use expenditure are separate explicit actions. SRD p.${spell.entry.page}.`,
      ),
    );
    if (spell.uses)
      counters.fields.push(
        resource(`spell:${spell.entry.id}:uses`, `${spell.entry.name} uses`, spell.uses),
      );
    const rules = normalized(spell.entry.text);
    const castingRules = normalized(spell.casting);
    const dc = castingRules.match(/spell save DC (\d+)/i);
    if (dc)
      casting.fields.push(
        numberField(`spell:${spell.entry.id}:dc`, `${spell.entry.name} save DC`, Number(dc[1])),
      );
    const attack = castingRules.match(/([+-]\d+) to hit with spell attacks/i);
    const castingAbility = castingRules.match(
      /using (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) as (?:the )?spellcasting ability/i,
    );
    const keys: Record<string, string> = {
      Strength: 'Str',
      Dexterity: 'Dex',
      Constitution: 'Con',
      Intelligence: 'Int',
      Wisdom: 'Wis',
      Charisma: 'Cha',
    };
    const score = castingAbility
      ? stats.fields.find((f) => f.label === keys[castingAbility[1]])
      : undefined;
    const modifier = score ? Math.floor((Number(score.value) - 10) / 2) : undefined;
    const pb = text.match(/\bPB \+(\d+)/);
    const attackBonus = attack
      ? Number(attack[1])
      : modifier !== undefined && pb
        ? modifier + Number(pb[1])
        : undefined;
    if (/spell attack/i.test(rules) && attackBonus !== undefined)
      casting.abilities.push(
        ability(
          `spell:${spell.entry.id}:attack`,
          `${spell.entry.name} · Spell attack`,
          'Printed spell attack bonus, or the printed casting ability modifier plus printed PB.',
          `1d20 + ${attackBonus}`,
        ),
      );
    const baseRules = rules.split(/Using a Higher-Level Spell Slot|Cantrip Upgrade/)[0];
    const scaling = rules.match(
      /(?:damage|healing) increases by (\d+)d(\d+) for each spell slot level above (\d+)/i,
    );
    for (const [j, dice] of [...baseRules.matchAll(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/g)].entries()) {
      let expression = dice[1].replace(/\s+/g, ' ');
      // Only the simple, explicitly printed linear slot rule is automated.
      // Alternate triggers and more complex scaling remain separate/manual.
      if (j === 0 && spell.levelOverride && scaling && expression.endsWith(`d${scaling[2]}`))
        expression = `${Number(expression.split('d')[0]) + Math.max(0, spell.levelOverride - Number(scaling[3])) * Number(scaling[1])}d${scaling[2]}`;
      const suffix = baseRules.slice((dice.index ?? 0) + dice[0].length);
      if (/^ plus your spellcasting ability modifier/.test(suffix) && modifier !== undefined)
        expression += ` + ${modifier}`;
      casting.abilities.push(
        ability(
          `spell:${spell.entry.id}:dice:${j}`,
          `${spell.entry.name} · Dice ${j + 1}`,
          `Review the printed trigger and damage/healing type. ${spell.levelOverride ? `Printed level ${spell.levelOverride} version; only simple linear slot scaling is applied.` : 'Printed base-level dice; no inferred cantrip upgrade.'} No automatic targeting or application.`,
          expression,
        ),
      );
    }
  }
  // Split long sections at the existing sheet limits, preserving every entry.
  const expanded: Section[] = [];
  for (const s of [...sections, counters, casting]) {
    if (!s.fields.length && !s.abilities.length) continue;
    for (
      let i = 0;
      i < Math.max(Math.ceil(s.fields.length / 40), Math.ceil(s.abilities.length / 30));
      i++
    )
      expanded.push({
        id: i ? dndId(`monster:split:${s.id}:${i}`) : s.id,
        title: i ? `${s.title} (continued)` : s.title,
        fields: s.fields.slice(i * 40, (i + 1) * 40),
        abilities: s.abilities.slice(i * 30, (i + 1) * 30),
      });
  }
  const source = section('source', 'Source');
  source.fields.push({
    id: monsterSourceId,
    label: 'SRD monster ID',
    kind: 'text',
    value: monster.id,
  });
  const printed = section('printed', 'Published stat block');
  for (let i = 0; i < monster.text.length; i += 4000)
    printed.fields.push({
      id: dndId(`monster:printed:${i}`),
      label: `Source text ${i / 4000 + 1}`,
      kind: 'text',
      value: monster.text.slice(i, i + 4000),
    });
  return { version: 1, sections: [...expanded, source, printed] };
}

export { monsterHpId };
