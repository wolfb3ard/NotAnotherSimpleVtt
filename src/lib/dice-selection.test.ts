import { expect, it } from 'vitest';
import { selectedDiceSides } from './dice-selection';

it('selects single dice, mixed dice and keep-highest/lowest rolls', () => {
  expect([...selectedDiceSides('1d20')]).toEqual([20]);
  expect([...selectedDiceSides('(2D6 + d8) + 1d6 - 3')]).toEqual([6, 8]);
  expect([...selectedDiceSides('2d20kh1')]).toEqual([20]);
  expect([...selectedDiceSides('2d20kl1')]).toEqual([20]);
  expect([...selectedDiceSides('2 d 6 + 3')]).toEqual([6]);
});

it('does not confuse larger dice, plain numbers or sheet IDs with selected dice', () => {
  expect([...selectedDiceSides('1d60 + 6')]).toEqual([60]);
  expect([...selectedDiceSides('@{d1234567-aaaa-bbbb-cccc-123456789abc} + 3')]).toEqual([]);
  expect([...selectedDiceSides('')]).toEqual([]);
});
