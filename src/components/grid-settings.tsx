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
  save: (grid: Grid, revision: number, feet?: number) => Promise<boolean>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(scene.grid ?? defaultGrid);
  const [revision] = useState(scene.revision);
  const [columns, setColumns] = useState('');
  const [feet, setFeet] = useState('5');
  const [link, setLink] = useState(!scene.calibrated);
  return (
    <div className="canvas-popover" aria-label="Grid calibration">
      <strong>Shared square grid</strong>
      <p>
        For a map with edge-to-edge squares, enter its width in squares. The ruler can use the same
        squares at any zoom. For maps with margins, adjust cell size and origin below.
      </p>
      <label>
        Map width in squares
        <input
          type="number"
          min={1}
          step={1}
          value={columns}
          onChange={(e) => {
            setColumns(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0)
              setDraft({
                ...draft,
                size: scene.width / n,
                enabled: true,
                origin_x: 0,
                origin_y: 0,
              });
          }}
        />
      </label>
      <label>
        <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />{' '}
        Calibrate ruler with grid
      </label>
      {link && (
        <label>
          Feet per square
          <input
            type="number"
            step="any"
            min={0.001}
            max={100000}
            value={feet}
            onChange={(e) => setFeet(e.target.value)}
          />
        </label>
      )}
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
        disabled={
          blocked ||
          revision !== scene.revision ||
          !gridSchema.safeParse(draft).success ||
          (link && !(Number(feet) >= 0.001 && Number(feet) <= 100000)) ||
          (!!columns && !(Number.isInteger(Number(columns)) && Number(columns) > 0))
        }
        onClick={async () => {
          if (await save(draft, revision, link ? Number(feet) : undefined)) close();
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
