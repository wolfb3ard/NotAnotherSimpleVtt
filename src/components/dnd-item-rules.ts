import { srdById, type SrdEntry } from '@/lib/srd-catalog';

export type RuleFact = { label: string; value: string };
const weight = /^(?:[\d.,/½¼¾]+(?:\s+[\d/]+)?\s+lb\.|[—-]|Varies)$/;
const price = /^(?:[\d,]+ [GSCPE]P|Varies)$/;
const gearLines =
  srdById
    .get('equipment-ammunition-varies')
    ?.text.split('\n')
    .map((line) => line.trim()) ?? [];
const gearWeights = new Map<string, string>();
// The importer retained the printed gear table with Ammunition. Only read
// complete item/weight/price rows after a matching header.
for (let i = 0; i < gearLines.length; i++) {
  if (gearLines[i] !== 'Item' || gearLines[i + 1] !== 'Weight' || gearLines[i + 2] !== 'Cost')
    continue;
  for (i += 3; weight.test(gearLines[i + 1] ?? '') && price.test(gearLines[i + 2] ?? ''); i += 3) {
    gearWeights.set(gearLines[i], gearLines[i + 1]);
  }
  i--;
}

export function itemRules(text: string, entry?: SrdEntry) {
  const facts: RuleFact[] = [];
  const add = (label: string, value?: string) => {
    if (value && !/^[—-]$/.test(value)) facts.push({ label, value });
  };
  const lines = text.split('\n');
  const row = entry?.text
    .trim()
    .split('\n')
    .map((line) => line.trim());
  if (
    (entry?.kind === 'armor' || entry?.kind === 'weapon') &&
    row?.length === 5 &&
    weight.test(row[3]) &&
    price.test(row[4])
  ) {
    const labels =
      entry.kind === 'armor'
        ? ['Armor Class', 'Strength', 'Stealth', 'Weight', 'Cost']
        : ['Damage', 'Properties', 'Mastery', 'Weight', 'Cost'];
    row.forEach((value, i) => add(labels[i], value));
    return {
      facts,
      description: text.startsWith(entry.text) ? text.slice(entry.text.length).trim() : text,
    };
  }
  const magicType =
    entry?.category === 'magic-item'
      ? /^(?:Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous Item)(?: \([^)\n]+\))?, (?:Common|Uncommon|Rare|Very Rare|Legendary|Artifact|Rarity Varies)(?: \([^)\n]+\))?$/i.exec(
          lines[0].trim(),
        )
      : null;
  if (magicType)
    return {
      facts: [{ label: 'Item type & rarity', value: magicType[0] }],
      description: lines.slice(1).join('\n'),
    };
  let i = 0;
  if (entry?.category === 'equipment') {
    // Only leading labeled facts are extracted. Keep prose and inline tables intact.
    for (; i < lines.length; i++) {
      const fact = /^(Ability|Weight|Cost|Capacity|Speed):\s*(.+)$/.exec(lines[i].trim());
      if (!fact) break;
      const value = fact[2].trim();
      if (fact[1] === 'Weight' && !weight.test(value)) break;
      if (fact[1] === 'Weight' && /^[—-]$/.test(value)) facts.push({ label: 'Weight', value });
      else add(fact[1], value);
    }
    if (!facts.some(({ label }) => label === 'Weight')) {
      const printed = gearWeights.get(entry.name.replace(/ \([^()]+\)$/, ''));
      if (printed) facts.push({ label: 'Weight', value: printed });
    }
    if (i > 0 && price.test(lines[i]?.trim() ?? '')) add('Cost', lines[i++].trim());
    if (entry.costCopper !== undefined && !facts.some(({ label }) => label === 'Cost')) {
      const copper = entry.costCopper;
      add(
        'Cost',
        copper % 100 === 0
          ? `${copper / 100} GP`
          : copper % 10 === 0
            ? `${copper / 10} SP`
            : `${copper} CP`,
      );
    }
  }
  return { facts, description: lines.slice(i).join('\n') };
}
