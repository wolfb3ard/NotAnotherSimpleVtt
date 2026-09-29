import type { Roll, RollCue } from './types';

export type DieVisual = { sides: number; value: number; kept: boolean; masked: boolean };
export type Presentation = {
  id: string;
  private: boolean;
  masked: boolean;
  dice: DieVisual[];
  total?: number;
  authorId?: string;
  overflow: number;
};

export function presentCue(cue: RollCue, rolls: Roll[]): Presentation | null {
  const roll = rolls.find((r) => r.id === cue.roll_id);
  if (!roll) {
    if (!cue.private) return null; // A public roll must arrive before we announce it.
    return {
      id: cue.roll_id,
      private: true,
      masked: true,
      dice: [{ sides: 6, value: 1, kept: true, masked: true }],
      overflow: 0,
    };
  }
  const dice = roll.result.dice.flatMap((d) =>
    d.values.map((value, i) => ({
      sides: d.sides,
      value,
      kept: d.kept[i],
      masked: ![4, 6, 8, 10, 12, 20].includes(d.sides),
    })),
  );
  // Show only an upper bound of real dice to protect rendering performance.
  return {
    id: cue.roll_id,
    private: cue.private,
    masked: false,
    dice: dice.slice(0, 8),
    overflow: Math.max(0, dice.length - 8),
    total: roll.result.total,
    authorId: roll.author_id,
  };
}
