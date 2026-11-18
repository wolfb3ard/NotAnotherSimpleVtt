import { srdById, srdExcerpt } from '@/lib/srd-catalog';

const sourceLine = /^(?:SRD 5\.2\.1[ ,]+PDF p|Source\(s\):)/;
const ruleLead =
  /^(At Higher Levels[.:]|(?:Using a Higher-Level Spell Slot|Cantrip Upgrade|Number of Uses|Known Forms|Rules While Shape-Shifted|Cantrips|Spellbook|Spell Slots|Prepared Spells of Level 1\+|Changing Your Prepared Spells|Spellcasting Ability|Spellcasting Focus|Copying a Spell into the Book|Copying the Book|Damage Resistance|Rage Damage|Strength Advantage|No Concentration or Spells|Duration)\.|(?:Trigger|Response|Cost|Prerequisite|Creature Type|Size|Speed|Tools|Languages):)\s*/;

const reflow = (text: string) => text.trim().replace(/[ \t]*\n[ \t]*/g, ' ');

const progressionHeading =
  /^(Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard) Features[ \t]*$/m;

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
  return {
    name: `${heading[1]} Features`,
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
    progression.name === 'Wizard Features'
      ? /\nExpanding and Replacing a Spellbook\n([\s\S]+?)(?=\n\t When you reach Wizard levels 4 and 10)/.exec(
          progression.text,
        )
      : null;
  return {
    text: sidebar ? progression.text.replace(sidebar[0], '') : progression.text,
    progression: progression.name,
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

function RulesParagraphs({ text, imported }: { text: string; imported: boolean }) {
  // The PDF uses indents instead of blank lines for many paragraph breaks.
  const paragraphs = text
    .split(/\n[ \t]*\n(?:[ \t]*\n)*|\n(?=\t)/)
    .map((paragraph) => (imported ? reflow(paragraph) : paragraph.trim()))
    .filter(Boolean);
  return (
    <>
      {paragraphs.length === 0 && <p>No description recorded.</p>}
      {paragraphs.map((paragraph, index) => {
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
}: {
  description: string;
  feature?: boolean;
}) {
  const rules = feature ? featureRules(description) : { text: description };
  const imported = /^SRD 5\.2\.1, PDF p\./m.test(rules.text);
  return (
    <div className="dnd-description">
      <RulesParagraphs text={rules.text} imported={imported} />
      {rules.sidebar && (
        <details className="dnd-rules-reference">
          <summary>Expanding and Replacing a Spellbook</summary>
          <div className="dnd-description">
            <RulesParagraphs text={rules.sidebar} imported />
          </div>
        </details>
      )}
      {rules.progression && (
        <p className="small muted">See the {rules.progression} progression table in the SRD.</p>
      )}
    </div>
  );
}
