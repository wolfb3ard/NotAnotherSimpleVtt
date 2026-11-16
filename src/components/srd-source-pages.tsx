'use client';
import { useState } from 'react';
import pages from '@/lib/srd-data/pages.json' with { type: 'json' };

/** Kept in its own lazy chunk: ordinary sheets do not download the whole book. */
export default function SrdSourcePages() {
  const [page, setPage] = useState(19);
  return (
    <>
      <label>
        PDF page
        <input
          type="number"
          min={1}
          max={pages.length}
          value={page}
          onChange={(event) =>
            setPage(
              Math.max(1, Math.min(pages.length, Math.trunc(Number(event.target.value)) || 1)),
            )
          }
        />
      </label>
      <p style={{ whiteSpace: 'pre-wrap' }}>{pages[page - 1].text}</p>
    </>
  );
}
