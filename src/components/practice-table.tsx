'use client';
import { useState } from 'react';
import type { Role } from '@/lib/types';

// Deliberately accepts no campaign data or command writer.
export function PracticeTable({ role }: { role: Role }) {
  const [step, setStep] = useState(-1);
  const [roll, setRoll] = useState(0);
  const gm = role === 'gm';
  const steps = gm
    ? ['Place a goblin', 'Reveal the clearing', 'Start encounter']
    : ['Find my character', 'Open Rowan’s sheet', 'Roll Perception'];
  return (
    <section className="card stack" aria-label="Tutorials">
      <h3>Tutorials</h3>
      <p>
        Practice as {gm ? 'a GM' : 'a player'} on a private sample table. Nothing here affects your
        game.
      </p>
      {step < 0 ? (
        <button onClick={() => setStep(0)}>Start practice</button>
      ) : (
        <>
          <div className="card stack" aria-live="polite">
            <strong>Practice scene · Forest clearing</strong>
            {gm ? (
              <p>
                {step > 0 ? 'Goblin placed' : 'Empty clearing'} ·{' '}
                {step > 1 ? 'Visible to players' : 'Covered by fog'}
                {step === 3 && ' · Round 1: Goblin’s turn'}
              </p>
            ) : (
              <p>
                {step === 0
                  ? 'Your character is elsewhere on the map.'
                  : step === 1
                    ? 'Map centered on Rowan.'
                    : 'Rowan · Scout · Perception +3'}
                {step === 3 && ` · d20 (${roll}) + 3 = ${roll + 3}`}
              </p>
            )}
            {step < 3 ? (
              <button
                onClick={() => {
                  if (!gm && step === 2) setRoll(1 + Math.floor(Math.random() * 20));
                  setStep(step + 1);
                }}
              >
                {steps[step]}
              </button>
            ) : (
              <>
                <strong>Practice complete</strong>
                <button onClick={() => setStep(0)}>Replay tutorial</button>
              </>
            )}
          </div>
          <button onClick={() => setStep(-1)}>Leave practice</button>
        </>
      )}
    </section>
  );
}
