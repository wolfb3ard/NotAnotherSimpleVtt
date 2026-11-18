const sourceLine = /^(?:SRD 5\.2\.1[ ,]+PDF p|Source\(s\):)/;
const ruleLead =
  /^(At Higher Levels[.:]|Using a Higher-Level Spell Slot\.|Cantrip Upgrade\.|(?:Trigger|Response|Cost|Prerequisite|Creature Type|Size|Speed|Tools|Languages):|(?:Number of Uses|Known Forms|Rules While Shape-Shifted)\.)\s*/;

const reflow = (text: string) => text.trim().replace(/[ \t]*\n[ \t]*/g, ' ');

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

export function DndRulesText({ description }: { description: string }) {
  const imported = /^SRD 5\.2\.1, PDF p\./m.test(description);
  // The PDF uses indents instead of blank lines for many paragraph breaks.
  const paragraphs = description
    .split(/\n[ \t]*\n(?:[ \t]*\n)*|\n(?=\t)/)
    .map((paragraph) => (imported ? reflow(paragraph) : paragraph.trim()))
    .filter(Boolean);
  return (
    <div className="dnd-description">
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
    </div>
  );
}
