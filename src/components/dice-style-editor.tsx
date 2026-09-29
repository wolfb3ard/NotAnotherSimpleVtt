'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { saveDiceStyle } from '@/app/actions';
import { diceStyleSchema } from '@/lib/dice-style';
import type { DiceStyle } from '@/lib/types';
const DicePreview = dynamic(() => import('./dice-overlay').then((m) => m.DicePreview), {
  ssr: false,
});

export function DiceStyleEditor({
  initial,
  onSaved,
}: {
  initial: DiceStyle;
  onSaved: () => Promise<void>;
}) {
  const [style, setStyle] = useState<DiceStyle>(initial);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  function change<K extends keyof DiceStyle>(key: K, value: DiceStyle[K]) {
    setStyle((s) => ({ ...s, [key]: value }));
  }
  async function save() {
    setSaving(true);
    setStatus('');
    try {
      const result = await saveDiceStyle(diceStyleSchema.parse(style));
      if (result.error) setStatus(result.error);
      else {
        setStatus('Dice appearance saved.');
        await onSaved();
      }
    } catch {
      setStatus('Unable to save appearance. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="stack dice-style-editor">
      <span className="eyebrow">MAKE IT YOURS</span>
      <h2>Your dice</h2>
      <div className="dice-style-preview">
        <DicePreview style={style} />
        <span>Live d20 preview</span>
      </div>
      {(
        [
          ['faceColor', 'Face color'],
          ['numberColor', 'Number color'],
          ['outlineColor', 'Number outline'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input type="color" value={style[key]} onChange={(e) => change(key, e.target.value)} />
        </label>
      ))}
      {(
        [
          ['opacity', 'Transparency / opacity'],
          ['glossiness', 'Glossiness'],
          ['shimmer', 'Shimmer'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}: {Math.round(style[key] * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={style[key]}
            onChange={(e) => change(key, Number(e.target.value))}
          />
        </label>
      ))}
      <button className="primary" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save my dice'}
      </button>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
