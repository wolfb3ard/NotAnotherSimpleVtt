'use client';
import { useState } from 'react';
import type { Scene } from '@/lib/types';
import { defaultGrid, gridSchema, type Grid } from '@/lib/navigation';

export function GridSettings({
  scene,
  blocked,
  save,
  close,
}: {
  scene: Scene;
  blocked: boolean;
  save: (grid: Grid, revision: number) => Promise<boolean>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(scene.grid ?? defaultGrid);
  const [revision] = useState(scene.revision);
  return (
    <div className="canvas-popover" aria-label="Grid calibration">
      <strong>Shared square grid</strong>
      <p>
        Size and origin use map pixels, independent of zoom. Align lines to the map; snapping uses
        cell centers. Distance scale is calibrated separately.
      </p>
      {revision !== scene.revision && (
        <p role="status">Map changed. Reopen grid settings to use the latest revision.</p>
      )}
      <label className="map-snap">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{' '}
        Show grid to everyone
      </label>
      {(
        [
          ['size', 'Cell size (pixels)'],
          ['origin_x', 'Grid origin X'],
          ['origin_y', 'Grid origin Y'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            aria-label={label}
            type="number"
            step="any"
            min={key === 'size' ? 8 : 0}
            max={key === 'size' ? 1024 : 4096}
            value={Number.isFinite(draft[key]) ? draft[key] : ''}
            onChange={(e) =>
              setDraft({ ...draft, [key]: e.target.value === '' ? NaN : Number(e.target.value) })
            }
          />
        </label>
      ))}
      <button
        disabled={blocked || revision !== scene.revision || !gridSchema.safeParse(draft).success}
        onClick={async () => {
          if (await save(draft, revision)) close();
        }}
      >
        Apply grid
      </button>
      <button disabled={blocked} onClick={close}>
        Close grid settings
      </button>
    </div>
  );
}
