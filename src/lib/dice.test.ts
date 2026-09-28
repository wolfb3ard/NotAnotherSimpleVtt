import { describe, expect, it } from 'vitest';
import { rollDice } from './dice';

const allowed = [3, 6, 7, 8, 20];
const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[i++];
};

describe('dice expressions', () => {
  it('preserves individual dice and applies arithmetic precedence', () => {
    const result = rollDice('2d6 + 1d8 * 2 - 4 / 2', allowed, {}, rolls(2, 5, 3));
    expect(result.total).toBe(11);
    expect(result.dice[0].values).toEqual([2, 5]);
  });
  it('supports parentheses, decimals, negative modifiers, and custom dice', () => {
    expect(rollDice('(d7 + -2) * 2 / 4', allowed, {}, rolls(5)).total).toBe(1.5);
  });
  it('keeps exactly the requested dice even on ties', () => {
    const high = rollDice('4d6kh2', allowed, {}, rolls(5, 5, 5, 1));
    expect(high.total).toBe(10);
    expect(high.dice[0].kept.filter(Boolean)).toHaveLength(2);
    expect(rollDice('2d20kl1', allowed, {}, rolls(18, 3)).total).toBe(3);
  });
  it('snapshots sheet modifiers using stable identifiers', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const fields = { [id]: -4 };
    const result = rollDice(`d6 + @{${id}}`, allowed, fields, rolls(6));
    fields[id] = 100;
    expect(result.total).toBe(2);
    expect(result.modifiers[id]).toBe(-4);
  });
  it.each([
    'd4',
    '0d6',
    '101d6',
    '2d6kh3',
    '2d6kl0',
    '1/0',
    '1 +',
    'Math.random()',
    'd6;alert(1)',
    '1e999',
    '2(3)',
    '((1)',
    '1e12*2',
    '('.repeat(33) + '1' + ')'.repeat(33),
  ])('rejects unsafe or invalid expression %s', (expression) => {
    expect(() => rollDice(expression, allowed)).toThrow();
  });
  it('rejects references not supplied by the authorized sheet', () => {
    expect(() => rollDice('@{550e8400-e29b-41d4-a716-446655440000}', allowed)).toThrow(/missing/);
  });
});
