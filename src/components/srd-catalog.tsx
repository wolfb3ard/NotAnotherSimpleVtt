'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  searchSrd,
  srdManifest,
  srdFullText,
  type SrdCategory,
  type SrdEntry,
} from '@/lib/srd-catalog';
const SourcePages = dynamic(() => import('./srd-source-pages'), {
  loading: () => <p role="status">Loading source pages…</p>,
});

const categories: SrdCategory[] = [
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'feature',
  'option',
  'spell',
  'equipment',
  'magic-item',
  'form',
  'rule',
];
export function SrdCatalog({ onAddItem }: { onAddItem?: (entry: SrdEntry) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SrdCategory | ''>('');
  const [limit, setLimit] = useState(30);
  const [sourceOpen, setSourceOpen] = useState(false);
  const results = useMemo(() => searchSrd(query, category || undefined), [query, category]);
  return (
    <details className="sheet-help">
      <summary>SRD 5.2.1 catalog & complete source pages</summary>
      <p>{srdManifest.attribution}</p>
      <p className="notice">{srdManifest.verification}</p>
      <details>
        <summary>Automation limitations</summary>
        <ul>
          {srdManifest.limitations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
      <div className="row">
        <label>
          Search rules
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(30);
            }}
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as SrdCategory | '');
              setLimit(30);
            }}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <p role="status">{results.length} entries</p>
      {results.slice(0, limit).map((entry) => (
        <details key={entry.id}>
          <summary>
            {entry.name} · {entry.category} · PDF p.{entry.page}
            {entry.endPage !== entry.page && `–${entry.endPage}`}
          </summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{srdFullText(entry)}</p>
          <small>{entry.id}</small>
          {onAddItem &&
            entry.addable !== false &&
            ['equipment', 'magic-item'].includes(entry.category) && (
              <p>
                <button type="button" onClick={() => onAddItem(entry)}>
                  Add {entry.name} to inventory
                </button>
                <small>
                  Review quantity and conditional effects. Does not spend currency or attune.
                </small>
              </p>
            )}
        </details>
      ))}
      {results.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 30)}>
          Show 30 more
        </button>
      )}
      <details onToggle={(event) => setSourceOpen(event.currentTarget.open)}>
        <summary>Read original page text (including tables and nested choices)</summary>
        {sourceOpen && <SourcePages />}
      </details>
    </details>
  );
}
