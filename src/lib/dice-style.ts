import { z } from 'zod';
import type { DiceStyle } from './types';

export const defaultDiceStyle: DiceStyle = {
  faceColor: '#487b73',
  numberColor: '#fff6db',
  outlineColor: '#182b2c',
  opacity: 1,
  glossiness: 0.5,
  shimmer: 0.25,
};
export const diceStyleSchema = z.strictObject({
  faceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  numberColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  opacity: z.number().min(0).max(1),
  glossiness: z.number().min(0).max(1),
  shimmer: z.number().min(0).max(1),
});
