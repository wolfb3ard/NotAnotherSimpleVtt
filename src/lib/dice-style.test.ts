import { expect, it } from 'vitest';
import { defaultDiceStyle, diceStyleSchema } from './dice-style';

it('accepts default colors and bounded material settings', () => {
  expect(diceStyleSchema.parse(defaultDiceStyle)).toEqual(defaultDiceStyle);
  expect(diceStyleSchema.safeParse({ ...defaultDiceStyle, opacity: 1.1 }).success).toBe(false);
  expect(diceStyleSchema.safeParse({ ...defaultDiceStyle, faceColor: 'red' }).success).toBe(false);
  expect(diceStyleSchema.safeParse({ ...defaultDiceStyle, unknown: 'value' }).success).toBe(false);
});
