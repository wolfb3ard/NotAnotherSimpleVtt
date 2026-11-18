'use client';

import { useState } from 'react';
import type { Token } from '@/lib/types';

type TokenChange = (token: Token, remove: boolean, folder: string | null) => Promise<unknown>;

export function TableTokenList({
  tokens,
  gm,
  onChange,
}: {
  tokens: Token[];
  gm: boolean;
  onChange: TokenChange;
}) {
  const folders = [
    ...new Set(tokens.flatMap((token) => (token.folder ? [token.folder] : []))),
  ].sort((a, b) => a.localeCompare(b));
  const ordered = [...tokens].sort((a, b) => a.label.localeCompare(b.label));

  function rows(folder: string | null) {
    return ordered
      .filter((token) => (token.folder ?? null) === folder)
      .map((token) => (
        <TableTokenRow
          key={`${token.id}:${token.folder ?? ''}`}
          token={token}
          gm={gm}
          onChange={onChange}
        />
      ));
  }

  return (
    <section className="stack table-token-list" aria-label="Tokens on this scene">
      <h3>Tokens on this scene</h3>
      {gm && (
        <p className="small muted">
          Enter a folder name to create or move a token into it. Leave it blank to unfile the token.
        </p>
      )}
      {!tokens.length && <p className="small muted">No tokens on this scene.</p>}
      {gm && (
        <datalist id="table-token-folders">
          {folders.map((folder) => (
            <option key={folder} value={folder} />
          ))}
        </datalist>
      )}
      {folders.map((folder) => (
        <details key={folder} open>
          <summary>
            {folder}{' '}
            <span className="muted">({ordered.filter((t) => t.folder === folder).length})</span>
          </summary>
          <ul>{rows(folder)}</ul>
        </details>
      ))}
      {ordered.some((token) => !token.folder) && (
        <details open>
          <summary>Unfiled tokens</summary>
          <ul>{rows(null)}</ul>
        </details>
      )}
    </section>
  );
}

function TableTokenRow({
  token,
  gm,
  onChange,
}: {
  token: Token;
  gm: boolean;
  onChange: TokenChange;
}) {
  const [folder, setFolder] = useState(token.folder ?? '');
  const [busy, setBusy] = useState(false);
  async function change(remove: boolean) {
    setBusy(true);
    try {
      await onChange(token, remove, folder.trim() || null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="table-token-row">
      <strong>{token.label}</strong>
      {gm && token.hidden && <small className="muted"> · Hidden</small>}
      {gm && (
        <details>
          <summary>Manage {token.label}</summary>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void change(false);
            }}
          >
            <label>
              Folder for {token.label}
              <input
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                list="table-token-folders"
                maxLength={60}
                disabled={busy}
                placeholder="e.g. Party"
              />
            </label>
            <div className="wrap">
              <button disabled={busy || folder.trim() === (token.folder ?? '')}>Save folder</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(`Remove ${token.label} from this scene? Its sheet will be kept.`)
                  )
                    void change(true);
                }}
              >
                Remove from table
              </button>
            </div>
          </form>
        </details>
      )}
    </li>
  );
}
