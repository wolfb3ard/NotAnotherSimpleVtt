import type { RulesTable } from './dnd-rules-table';

const roll = /^\d+(?:[–-]\d+)?$/;
const specs = [
  {
    name: 'Draconic Ancestors',
    header: ['Draconic Ancestors', 'Dragon', 'Damage Type', 'Dragon', 'Damage Type'],
    columns: ['Dragon', 'Damage Type'],
    count: 10,
  },
  {
    name: 'Reincarnate Species',
    header: ['1d10', 'Species', '1d10', 'Species'],
    columns: ['1d10', 'Species'],
    count: 10,
    key: roll,
  },
  {
    name: 'Confusion Behavior',
    header: ['1d10', 'Behavior for the Turn'],
    columns: ['1d10', 'Behavior for the Turn'],
    count: 4,
    key: roll,
    wrapped: true,
  },
  {
    name: 'Divine Word Effects',
    header: ['Divine Word Effects', 'Hit Points', 'Effect'],
    columns: ['Hit Points', 'Effect'],
    count: 4,
    key: roll,
    wrapped: true,
  },
  {
    name: 'Prismatic Rays',
    header: ['Prismatic Rays', '1d8', 'Ray'],
    columns: ['1d8', 'Ray'],
    count: 8,
    key: roll,
    wrapped: true,
  },
  {
    name: 'Oath of Devotion Spells',
    header: ['Oath of Devotion Spells', 'Paladin Level', 'Spells'],
    columns: ['Paladin Level', 'Spells'],
    count: 5,
    key: roll,
    wrapped: true,
  },
  ...['Arid Land', 'Polar Land', 'Temperate Land', 'Tropical Land'].map((name) => ({
    name,
    header: [name, 'Druid Level', 'Circle Spells'],
    columns: ['Druid Level', 'Circle Spells'],
    count: 4,
    key: roll,
  })),
];

const teleportHeader = [
  'Teleportation Outcome',
  'Familiarity',
  'Mishap',
  'Similar',
  'Area',
  'Off',
  'Target',
  'On',
  'Target',
];

function teleportRows(lines: string[], next: number) {
  const rows: string[][] = [];
  const isOutcome = (cell: string) => cell === '—' || roll.test(cell);
  for (let i = 0; i < 6; i++) {
    const label = [lines[next++]?.trim()];
    if (lines[next]?.trim() && !isOutcome(lines[next].trim())) label.push(lines[next++].trim());
    const outcomes = lines.slice(next, next + 4).map((line) => line.trim());
    if (!label[0] || outcomes.length !== 4 || !outcomes.every(isOutcome)) return;
    rows.push([label.join(' '), ...outcomes]);
    next += 4;
  }
  return {
    table: {
      name: teleportHeader[0],
      columns: ['Familiarity', 'Mishap', 'Similar Area', 'Off Target', 'On Target'],
      rows,
    },
    next,
  };
}

// PDF text has no cell delimiters. Only parse recognizable headers and complete rows.
export function inlineRulesTable(lines: string[], start: number) {
  const matches = (header: string[], position: number) =>
    header.every((cell, offset) => lines[position + offset]?.trim() === cell);
  if (matches(teleportHeader, start)) return teleportRows(lines, start + teleportHeader.length);
  const spec = specs.find(({ header }) => matches(header, start));
  if (!spec) return;
  let next = start + spec.header.length;
  const rows: string[][] = [];
  const repeated = spec.name === 'Prismatic Rays' ? spec.columns : [];
  for (let i = 0; i < spec.count; i++) {
    if (repeated.length && matches(repeated, next)) next += repeated.length;
    const key = lines[next++]?.trim();
    if (!key || (spec.key && !spec.key.test(key))) return;
    const value = lines[next++]?.trim();
    if (!value || /^(?:SRD |Source\(s\):|•)/.test(value)) return;
    const cell = [value];
    if (spec.wrapped) {
      while (
        lines[next]?.trim() &&
        !/^\s|^SRD |^Source\(s\):|^•/.test(lines[next]) &&
        !spec.key?.test(lines[next].trim()) &&
        !(repeated.length && matches(repeated, next))
      ) {
        cell.push(lines[next++].trim());
      }
    }
    rows.push([key, cell.join(' ')]);
  }
  const table: RulesTable = { name: spec.name, columns: spec.columns, rows };
  return { table, next };
}
