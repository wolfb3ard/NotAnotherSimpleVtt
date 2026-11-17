'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Role } from '@/lib/types';

const tiles = [
  'Pines',
  'Trail',
  'Brook',
  'Boulders',
  'Clearing',
  'Camp',
  'Hill',
  'Bridge',
  'Grove',
];
const rowan = 5;

// This sandbox accepts no campaign data, storage, or command writer.
function PracticeScene({ role, onClose }: { role: Role; onClose: () => void }) {
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const token = useRef<HTMLButtonElement>(null);
  const [tool, setTool] = useState<'place' | 'reveal'>();
  const [goblin, setGoblin] = useState<number>();
  const [revealed, setRevealed] = useState<number[]>([]);
  const [located, setLocated] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [rolled, setRolled] = useState<number>();
  const [encounter, setEncounter] = useState(false);
  const gm = role === 'gm';
  const ready = goblin !== undefined && revealed.includes(goblin);
  const done = gm ? encounter : rolled !== undefined;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (located) token.current?.focus();
  }, [located]);
  function replay() {
    setTool(undefined);
    setGoblin(undefined);
    setRevealed([]);
    setLocated(false);
    setSheet(false);
    setRolled(undefined);
    setEncounter(false);
    heading.current?.focus();
  }
  function chooseTile(index: number) {
    if (tool === 'place') setGoblin(index);
    if (tool === 'reveal')
      setRevealed((current) => (current.includes(index) ? current : [...current, index]));
    setTool(undefined);
  }
  const instruction = gm
    ? encounter
      ? 'Round 1 · Goblin’s turn.'
      : tool === 'place'
        ? 'Choose a square to place the goblin.'
        : tool === 'reveal'
          ? 'Choose the goblin’s square to reveal it to players.'
          : ready
            ? 'The goblin is visible. Start the encounter.'
            : goblin !== undefined
              ? 'The goblin is hidden. Choose Reveal fog in Scene tools.'
              : 'Open Scene tools and choose Place goblin.'
    : sheet
      ? 'Roll Perception from Rowan’s practice sheet.'
      : located
        ? 'Select Rowan on the map to open the practice sheet.'
        : 'Use Find my character to locate Rowan on the map.';
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      className="practice-dialog"
      onClose={onClose}
      onCancel={(event) => {
        if (!tool) return;
        event.preventDefault();
        setTool(undefined);
      }}
    >
      <div className="stack">
        <h3 ref={heading} tabIndex={-1} id={title}>
          Practice scene · Forest clearing
        </h3>
        <p className="small muted">
          Private sandbox. No rolls, tokens, or encounters are saved to your campaign.
        </p>
        <p role="status">{instruction}</p>
        {gm ? (
          <details>
            <summary>Scene tools</summary>
            <div className="wrap">
              <button
                disabled={encounter}
                aria-pressed={tool === 'place'}
                onClick={() => setTool('place')}
              >
                Place goblin
              </button>
              <button
                disabled={goblin === undefined || encounter}
                aria-pressed={tool === 'reveal'}
                onClick={() => setTool('reveal')}
              >
                Reveal fog
              </button>
              {tool && <button onClick={() => setTool(undefined)}>Cancel map tool</button>}
            </div>
          </details>
        ) : (
          <button
            onClick={() => {
              if (located) token.current?.focus();
              else setLocated(true);
            }}
          >
            Find my character
          </button>
        )}
        <div className="practice-map" role="group" aria-label="Forest map">
          {tiles.map((tile, index) => {
            const foggy = gm && !revealed.includes(index);
            const hasGoblin = goblin === index;
            const label = `${tile}${hasGoblin ? ' · Goblin' : ''}${foggy ? ' · Fog' : ''}`;
            return gm ? (
              <button
                key={tile}
                type="button"
                className="practice-tile"
                data-fog={foggy}
                disabled={!tool}
                onClick={() => chooseTile(index)}
              >
                {label}
              </button>
            ) : index === rowan && located ? (
              <button
                key={tile}
                ref={token}
                type="button"
                className="practice-tile practice-token"
                onClick={() => setSheet(true)}
                aria-label="Open Rowan’s sheet"
              >
                ◆ Rowan
              </button>
            ) : (
              <div key={tile} className="practice-tile">
                {tile}
              </div>
            );
          })}
        </div>
        {gm ? (
          <button disabled={!ready || encounter || !!tool} onClick={() => setEncounter(true)}>
            Start encounter
          </button>
        ) : (
          sheet && (
            <section className="dnd-box stack" aria-label="Rowan’s practice sheet">
              <h4>Rowan · Scout</h4>
              <p>Perception helps you spot hidden details. Roll a d20 and add Rowan’s +3 bonus.</p>
              <button onClick={() => setRolled(1 + Math.floor(Math.random() * 20))}>
                Roll Perception
              </button>
              {rolled !== undefined && (
                <p role="status">
                  d20 ({rolled}) + 3 = {rolled + 3}
                </p>
              )}
            </section>
          )
        )}
        {done && (
          <div className="wrap">
            <strong>Practice complete</strong>
            <button onClick={replay}>Replay tutorial</button>
          </div>
        )}
        <button onClick={() => dialog.current?.close()}>Leave practice</button>
      </div>
    </dialog>
  );
}

export function PracticeTable({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card stack" aria-label="Tutorials">
      <h3>Tutorials</h3>
      <p>Practice as {role === 'gm' ? 'a GM' : 'a player'} on a private sample table.</p>
      <button onClick={() => setOpen(true)}>Start practice</button>
      {open && <PracticeScene role={role} onClose={() => setOpen(false)} />}
    </section>
  );
}
