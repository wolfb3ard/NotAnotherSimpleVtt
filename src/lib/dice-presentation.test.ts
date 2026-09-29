import { expect, it } from 'vitest';
import { presentCue } from './dice-presentation';
import type { Roll, RollCue } from './types';

const cue: RollCue = { roll_id: 'roll-id', private: true, created_at: new Date().toISOString() };
const roll = {
  id: 'roll-id',
  author_id: 'player-id',
  result: {
    total: 7,
    dice: [{ sides: 7, values: [7], kept: [true], total: 7 }],
    resolvedExpression: '1d7',
    modifiers: {},
  },
} as Roll;
it('private unauthorized cue contains no dice type, count, identity, or result', () => {
  expect(presentCue(cue, [])).toEqual({
    id: 'roll-id',
    private: true,
    masked: true,
    dice: [{ sides: 6, value: 1, kept: true, masked: true }],
    overflow: 0,
  });
});
it('authorized nonstandard dice retain actual result but render question faces', () => {
  expect(presentCue(cue, [roll])).toMatchObject({
    total: 7,
    authorId: 'player-id',
    dice: [{ sides: 7, value: 7, masked: true }],
  });
});
it('never animates a public roll without its authorized result', () => {
  expect(presentCue({ ...cue, private: false }, [])).toBeNull();
});
