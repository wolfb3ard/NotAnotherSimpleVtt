import { srdById, srdExcerpt } from '@/lib/srd-catalog';
import { DndRulesTable, type RulesTable } from './dnd-rules-table';
import { inlineRulesTable } from './dnd-inline-rules-tables';

const sourceLine = /^(?:SRD 5\.2\.1[ ,]+PDF p|Source\(s\):)/;
const ruleLead =
  /^(At Higher Levels[.:]|(?:Using a Higher-Level Spell Slot|Cantrip Upgrade|Number of Uses|Known Forms|Rules While Shape-Shifted|Cantrips|Spellbook|Spell Slots|Prepared Spells of Level 1\+|Changing Your Prepared Spells|Spellcasting Ability|Spellcasting Focus|Copying a Spell into the Book|Copying the Book|Damage Resistance|Rage Damage|Strength Advantage|No Concentration or Spells|Duration)\.|(?:Trigger|Response|Cost|Prerequisite|Creature Type|Size|Speed|Tools|Languages):)\s*/;

const reflow = (text: string) => text.trim().replace(/[ \t]*\n[ \t]*/g, ' ');

const progressionHeading =
  /^(Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard) Features[ \t]*$/m;
const slots = (count: number) => Array.from({ length: count }, (_, i) => `Level ${i + 1} Slots`);
const progressionColumns: Record<string, string[]> = {
  Barbarian: ['Rages', 'Rage Damage', 'Weapon Mastery'],
  Bard: ['Bardic Die', 'Cantrips', 'Prepared Spells', ...slots(9)],
  Cleric: ['Channel Divinity', 'Cantrips', 'Prepared Spells', ...slots(9)],
  Druid: ['Wild Shape', 'Cantrips', 'Prepared Spells', ...slots(9)],
  Fighter: ['Second Wind', 'Weapon Mastery'],
  Monk: ['Martial Arts', 'Focus Points', 'Unarmored Movement'],
  Paladin: ['Channel Divinity', 'Prepared Spells', ...slots(5)],
  Ranger: ['Favored Enemy', 'Prepared Spells', ...slots(5)],
  Rogue: ['Sneak Attack'],
  Sorcerer: ['Sorcery Points', 'Cantrips', 'Prepared Spells', ...slots(9)],
  Warlock: ['Eldritch Invocations', 'Cantrips', 'Prepared Spells', 'Spell Slots', 'Slot Level'],
  Wizard: ['Cantrips', 'Prepared Spells', ...slots(9)],
};

// The PDF extraction inserts the table at its page position, sometimes mid-sentence.
// Verify the row sequence before removing the table, then join the surrounding text.
function extractProgression(text: string) {
  const heading = progressionHeading.exec(text);
  if (!heading) return;
  const afterHeading = text.slice(heading.index + heading[0].length);
  const levels = [...afterHeading.matchAll(/^(\d{1,2})\n\+[2-6]$/gm)].slice(0, 20);
  if (levels.length !== 20 || levels.some((row, i) => Number(row[1]) !== i + 1)) return;
  const lastRow = levels[19];
  const afterLastRow = afterHeading.slice(lastRow.index + lastRow[0].length);
  const cells = /^\n[^\n]+(?:\n(?:—|D\d+|\d+d\d+|\+?\d+(?: ft\.)?)[ \t]*)+/.exec(afterLastRow);
  if (!cells) return;
  const end = lastRow.index + lastRow[0].length + cells[0].length;
  const columns = progressionColumns[heading[1]];
  const rows = levels.map((row, index) => {
    const body = afterHeading
      .slice(row.index + row[0].length, levels[index + 1]?.index ?? end)
      .trim()
      .split('\n');
    const values = body.splice(-columns.length).map((value) => value.trim());
    return [row[1], row[0].split('\n')[1], reflow(body.join('\n')), ...values];
  });
  if (
    rows.some(
      (row) =>
        !row[2] ||
        row.length !== columns.length + 3 ||
        !row.slice(3).every((value) => /^(?:—|D\d+|\d+d\d+|\+?\d+(?: ft\.)?)$/.test(value)),
    )
  )
    return;
  return {
    table: {
      name: `${heading[1]} Features`,
      columns: ['Level', 'Proficiency Bonus', 'Class Features', ...columns],
      rows,
    },
    text: text.slice(0, heading.index) + afterLastRow.slice(cells[0].length + 1),
  };
}

function featureRules(description: string) {
  const citation = /\n\nSRD 5\.2\.1, PDF p\.[^\n]+; catalog: ([\w-]+)\./.exec(description);
  if (!citation || !progressionHeading.test(description)) return { text: description };
  const entry = srdById.get(citation[1]);
  // Recover rules cut off by the old excerpt limit, but only for untouched stock excerpts.
  const original =
    entry?.category === 'feature' && description === srdExcerpt(entry)
      ? entry.text + description.slice(citation.index)
      : description;
  const progression = extractProgression(original);
  if (!progression) return { text: description };

  const sidebar =
    progression.table.name === 'Wizard Features'
      ? /\nExpanding and Replacing a Spellbook\n([\s\S]+?)(?=\n\t When you reach Wizard levels 4 and 10)/.exec(
          progression.text,
        )
      : null;
  return {
    text: sidebar ? progression.text.replace(sidebar[0], '') : progression.text,
    progression: progression.table,
    sidebar: sidebar?.[1],
  };
}

// The SRD spell header has a fixed order. Read through the next label so wrapped
// material components and reaction casting conditions stay with their values.
export function spellRules(description: string) {
  const header =
    /^((?:Level \d+\b|(?:[^\n]+ )?Cantrip\b)[\s\S]*?)\nCasting Time: ([\s\S]+?)\nRange: ([\s\S]+?)\nComponents?: ([\s\S]+?)\nDuration: ([^\n]+)(?:\n|$)/.exec(
      description,
    );
  if (!header) return { description };
  const [prefix, school, time, range, components, duration] = header;
  return {
    school: reflow(school),
    facts: [
      { label: 'Casting Time', value: reflow(time) },
      { label: 'Range', value: reflow(range) },
      { label: 'Components', value: reflow(components) },
      { label: 'Duration', value: reflow(duration) },
    ],
    description: description.slice(prefix.length),
  };
}

type RulesBlock = { paragraph: string } | { bullets: string[] } | { table: RulesTable };

function rulesBlocks(text: string, imported: boolean): RulesBlock[] {
  // The PDF uses indents instead of blank lines for many paragraph breaks.
  const blocks: RulesBlock[] = [];
  const lines = text.split('\n');
  let pending: string[] = [];
  const flush = () => {
    const paragraph = (imported ? reflow : (value: string) => value.trim())(pending.join('\n'));
    if (paragraph) blocks.push({ paragraph });
    pending = [];
  };
  const bullet = /^[ \t]*•[ \t]+/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const table = imported ? inlineRulesTable(lines, i) : undefined;
    if (table) {
      flush();
      blocks.push({ table: table.table });
      i = table.next - 1;
    } else if (bullet.test(line)) {
      flush();
      const items: string[] = [];
      do {
        let item = lines[i].replace(bullet, '');
        // Wrapped PDF lines end in a space; a new bullet or indented paragraph ends the item.
        while (/[ \t]$/.test(lines[i]) && /^(?![ \t]*•)[^\s]/.test(lines[i + 1] ?? '')) {
          item += `\n${lines[++i]}`;
        }
        items.push(reflow(item));
        i++;
      } while (bullet.test(lines[i] ?? ''));
      blocks.push({ bullets: items });
      i--;
    } else {
      if (!line.trim() || line.startsWith('\t')) flush();
      pending.push(line);
    }
  }
  flush();
  return blocks;
}

function RulesParagraphs({ text, imported }: { text: string; imported: boolean }) {
  const blocks = rulesBlocks(text, imported);
  return (
    <>
      {blocks.length === 0 && <p>No description recorded.</p>}
      {blocks.map((block, index) => {
        if ('table' in block) return <DndRulesTable key={index} {...block.table} />;
        if ('bullets' in block) {
          return (
            <ul className="dnd-rules-list" key={index}>
              {block.bullets.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        const { paragraph } = block;
        const lead = ruleLead.exec(paragraph);
        return (
          <p key={index}>
            {sourceLine.test(paragraph) ? (
              <em className="small muted">{paragraph}</em>
            ) : lead ? (
              <>
                <strong>{lead[1]}</strong> {paragraph.slice(lead[0].length)}
              </>
            ) : (
              paragraph
            )}
          </p>
        );
      })}
    </>
  );
}

export function DndRulesText({
  description,
  feature = false,
  imported,
}: {
  description: string;
  feature?: boolean;
  imported?: boolean;
}) {
  const rules = feature ? featureRules(description) : { text: description };
  return (
    <div className="dnd-description">
      <RulesParagraphs
        text={rules.text}
        imported={imported ?? /^SRD 5\.2\.1, PDF p\./m.test(rules.text)}
      />
      {rules.sidebar && (
        <details className="dnd-rules-reference">
          <summary>Expanding and Replacing a Spellbook</summary>
          <div className="dnd-description">
            <RulesParagraphs text={rules.sidebar} imported />
          </div>
        </details>
      )}
      {rules.progression && (
        <details className="dnd-rules-reference">
          <summary>{rules.progression.name} progression table</summary>
          <DndRulesTable {...rules.progression} />
        </details>
      )}
    </div>
  );
}
