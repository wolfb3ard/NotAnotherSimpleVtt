'use client';

import { useEffect, useState } from 'react';
import { tokenRings, type TokenRing } from '@/lib/token-appearance';
import type { Actor, Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { TokenPortrait } from './token-portrait';

export function TokenAppearanceEditor({
  actor,
  snapshot,
  run,
}: {
  actor: Actor;
  snapshot: Snapshot;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
}) {
  const [ring, setRing] = useState<TokenRing>(actor.token_ring ?? 'gold');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [remove, setRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const allowed = snapshot.role === 'gm' || actor.owner_id === snapshot.userId;
  const sceneId = snapshot.game.active_scene_id;
  const placed = snapshot.tokens.some((t) => t.actor_id === actor.id && t.scene_id === sceneId);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  return (
    <section className="token-appearance stack" aria-label="Token appearance">
      <h3>Token appearance</h3>
      <div className="row">
        <TokenPortrait
          name={actor.name}
          assetId={remove ? null : actor.token_asset_id}
          preview={file ? preview : undefined}
          ring={ring}
        />
        <p className="small muted">
          Saved on this character, shared across all scenes. Tokens use this sheet’s current stats.
        </p>
      </div>
      {allowed && (
        <>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError('');
              setStatus('');
              try {
                let assetId = remove ? null : (actor.token_asset_id ?? null);
                if (file) {
                  const form = new FormData();
                  form.set('game_id', actor.game_id);
                  form.set('kind', 'token');
                  form.set('file', file);
                  const { uploadAsset } = await import('@/app/actions');
                  const result = await uploadAsset(form);
                  if (result.error || !result.id) throw new Error(result.error ?? 'Upload failed.');
                  assetId = result.id;
                }
                const result = await run('actor_appearance', {
                  id: actor.id,
                  asset_id: assetId,
                  ring,
                  revision: actor.appearance_revision ?? 0,
                });
                if (result) setStatus('Appearance saved.');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Unable to save appearance.');
              } finally {
                setPending(false);
              }
            }}
          >
            <label>
              Portrait image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={pending}
                onChange={(event) => {
                  setFile(event.target.files?.[0]);
                  setPreview(
                    event.target.files?.[0]
                      ? URL.createObjectURL(event.target.files[0])
                      : undefined,
                  );
                  setRemove(false);
                }}
              />
              <span className="small muted">
                PNG, JPEG or WebP · up to 4 MB · center-cropped to a circle
              </span>
            </label>
            <label>
              Token ring
              <select
                aria-label="Token ring"
                value={ring}
                disabled={pending}
                onChange={(event) => setRing(event.target.value as TokenRing)}
              >
                {Object.entries(tokenRings).map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={remove}
                disabled={pending || !!file}
                onChange={(event) => setRemove(event.target.checked)}
              />
              Remove portrait
            </label>
            <button disabled={pending}>{pending ? 'Saving…' : 'Save appearance'}</button>
          </form>
          <button
            disabled={pending || !sceneId || (placed && snapshot.role !== 'gm')}
            onClick={async () => {
              if (!sceneId) return;
              setPending(true);
              setStatus('');
              try {
                const result = await run('token_create', { actor_id: actor.id, scene_id: sceneId });
                if (result) setStatus('Token placed. The GM may need to reveal its starting area.');
              } finally {
                setPending(false);
              }
            }}
          >
            {placed && snapshot.role !== 'gm' ? 'Already in scene' : 'Add token to scene'}
          </button>
          {!sceneId && <p className="small muted">Activate a scene before placing a token.</p>}
          <p className="small muted">
            Save appearance before placing. New tokens start near the map’s top-left; fog may
            conceal them.
          </p>
        </>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
