import data from './srd-data/catalog.json' with { type: 'json' };
import manifest from './srd-data/manifest.json' with { type: 'json' };
import shapes from './srd-data/shapes.json' with { type: 'json' };
import shapesManifest from './srd-data/shapes-manifest.json' with { type: 'json' };

export type SrdCategory =
  | 'class'
  | 'subclass'
  | 'species'
  | 'background'
  | 'feat'
  | 'feature'
  | 'option'
  | 'spell'
  | 'equipment'
  | 'magic-item'
  | 'rule'
  | 'form';
// Shape stat blocks have their own independent importer/manifest.
export type SrdEntry = {
  id: string;
  name: string;
  category: SrdCategory;
  text: string;
  page: number;
  endPage: number;
  className?: string;
  subclass?: string;
  level?: number;
  classes?: string[];
  featCategory?: string;
  kind?: 'weapon' | 'armor' | 'tool' | 'gear';
  cr?: number;
  crLabel?: string;
  fly?: boolean;
  addable?: boolean;
  inventoryName?: string;
  costCopper?: number;
  purchaseQuantity?: number;
  shopKey?: string;
  parentId?: string;
  rarity?: 'Common' | 'Uncommon' | 'Rare' | 'Very rare' | 'Very Rare' | 'Legendary' | 'Artifact';
  requiresAttunement?: boolean;
};
export const srdCatalog = [
  ...data,
  ...shapes.map((shape) => ({ ...shape, category: 'form' })),
] as SrdEntry[];
export const srdManifest = {
  ...manifest,
  counts: { ...manifest.counts, form: shapes.length },
  shapeVerification: shapesManifest.verification,
};
export const srdById = new Map(srdCatalog.map((entry) => [entry.id, entry]));
export function srdFullText(entry: SrdEntry): string {
  const parent = entry.parentId ? srdById.get(entry.parentId) : undefined;
  return parent ? `${entry.text}\n\n${parent.name}\n${parent.text}` : entry.text;
}
const searchIndex = srdCatalog.map((entry) =>
  `${entry.name} ${srdFullText(entry)} ${entry.className ?? ''}`.toLocaleLowerCase(),
);
export function searchSrd(query: string, category?: SrdCategory): SrdEntry[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/);
  return srdCatalog.filter(
    (entry, index) =>
      (!category || entry.category === category) &&
      words.every((word) => searchIndex[index].includes(word)),
  );
}
export function srdEntry(category: SrdCategory, name: string): SrdEntry | undefined {
  return srdCatalog.find((entry) => entry.category === category && entry.name === name);
}
/** Long rules stay in the source catalog; sheet excerpts never silently truncate them. */
export function srdExcerpt(entry: SrdEntry, maxLength = 4000): string {
  const citation = `\n\nSRD 5.2.1; catalog: ${entry.id}. Full text in SRD catalog.`;
  const room = maxLength - citation.length;
  const text = srdFullText(entry);
  return (text.length <= room ? text : `${text.slice(0, room - 2)}…`) + citation;
}
