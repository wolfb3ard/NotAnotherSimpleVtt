import { useState } from 'react';
import { srdFullText, type SrdEntry } from '@/lib/srd-catalog';
import { DndRulesText } from './dnd-rules-text';

export function RulesPreview({
  name,
  entry,
  description,
}: {
  name: string;
  entry?: SrdEntry;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const notes = description?.trim();
  if (!notes && !entry?.text.trim()) return null;
  const text = open ? notes || (entry ? srdFullText(entry) : '') : '';
  return (
    <details className="rules-preview" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={`Description: ${name}`}>Description</summary>
      {text && <DndRulesText description={text} entry={entry} />}
    </details>
  );
}
