import { expect, it } from 'vitest';
import { diceSelection } from './dice-selection';

it('groups repeated dice clicks and removes a die term at zero', () => {
  let expression = '';
  for (let i = 0; i < 6; i++) expression = diceSelection(expression).change(6, 1);
  expect(expression).toBe('6d6');
  expression = diceSelection(expression).change(8, 1);
  expect(expression).toBe('6d6 + 1d8');
  expect(diceSelection(expression).change(6, -1)).toBe('5d6 + 1d8');
  expect(diceSelection(expression).change(8, -1)).toBe('6d6');
  expect(diceSelection('1d6 + 1d8').change(6, -1)).toBe('1d8');
  expect(diceSelection('1d6 - 3').change(6, -1)).toBe('- 3');
  expect(diceSelection('1d6').change(6, -1)).toBe('');
});

it('updates manually entered dice while preserving modifiers and sheet references', () => {
  const field = '@{d1234567-aaaa-bbbb-cccc-123456789abc}';
  const expression = `5e+3 + d 6 + ${field} - 1d60`;
  const selection = diceSelection(expression);
  expect([...selection.counts]).toEqual([
    [6, 1],
    [60, 1],
  ]);
  expect(selection.change(6, 1)).toBe(`5e+3 + 2d6 + ${field} - 1d60`);
  expect(selection.change(6, -1)).toBe(`5e+3 + ${field} - 1d60`);
});

it('counts but does not rewrite dice in keep, grouped, negative, or multiplied terms', () => {
  const expression = '2d20kh1 + max(2d6, d8) - 1d6 + 2 * +d6';
  const selection = diceSelection(expression);
  expect([...selection.counts]).toEqual([
    [20, 2],
    [6, 4],
    [8, 1],
  ]);
  expect(selection.change(6, -1)).toBe(expression);
  expect(selection.change(20, 1)).toBe(`${expression} + 1d20`);
});

it('does not add dice beyond the roll limits', () => {
  expect(diceSelection('98d6 + 2d20kl1').change(8, 1)).toBe('98d6 + 2d20kl1');
  const expression = '1d6 + ' + '0'.repeat(494);
  expect(diceSelection(expression).change(8, 1)).toBe(expression);
  expect(diceSelection('2d6 +').change(8, 1)).toBe('2d6 +');
});
