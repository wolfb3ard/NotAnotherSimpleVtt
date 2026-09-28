import { randomInt } from 'node:crypto';
import type { RollResult } from './types';

/** Grammar: arithmetic, NdS[khN|klN], and @{stable-field-uuid}. */
export function rollDice(
  expression: string,
  allowedSides: number[],
  fields: Record<string, number> = {},
  random: (sides: number) => number = (sides) => randomInt(1, sides + 1),
): RollResult {
  if (!expression.trim() || expression.length > 500)
    throw new Error('Use an expression between 1 and 500 characters.');
  const modifiers: Record<string, number> = {};
  const resolvedExpression = expression.replace(/@\{([a-f0-9-]{36})\}/gi, (_, id: string) => {
    const value = fields[id];
    if (!Number.isFinite(value)) throw new Error('A referenced numeric sheet field is missing.');
    modifiers[id] = value;
    return `(${value})`;
  });
  const input = resolvedExpression.replace(/\s+/g, '').toLowerCase();
  const result: RollResult = { total: 0, dice: [], resolvedExpression, modifiers };
  let index = 0;
  let count = 0;
  let depth = 0;
  const check = (n: number) => {
    if (!Number.isFinite(n) || Math.abs(n) > 1e12)
      throw new Error('Result exceeds the supported range.');
    return n;
  };
  function atom(): number {
    if (++depth > 32) throw new Error('Expression is too deeply nested.');
    try {
      const sign = input[index];
      if (sign === '+' || sign === '-') {
        index++;
        return check((sign === '-' ? -1 : 1) * atom());
      }
      if (input[index] === '(') {
        index++;
        const n = sum();
        if (input[index++] !== ')') throw new Error('Missing closing parenthesis.');
        return n;
      }
      const dice = /^(\d*)d(\d+)(?:k([hl])(\d+))?/.exec(input.slice(index));
      if (dice) {
        index += dice[0].length;
        const amount = Number(dice[1] || '1');
        const sides = Number(dice[2]);
        const keep = dice[4] ? Number(dice[4]) : amount;
        count += amount;
        if (!Number.isSafeInteger(amount) || amount < 1 || count > 100)
          throw new Error('Roll between 1 and 100 dice.');
        if (
          !Number.isSafeInteger(sides) ||
          sides < 2 ||
          sides > 1000000 ||
          !allowedSides.includes(sides)
        )
          throw new Error(`d${sides} is not enabled for this game.`);
        if (keep < 1 || keep > amount)
          throw new Error('Keep count must be between one and the dice count.');
        const values = Array.from({ length: amount }, () => random(sides));
        if (values.some((v) => !Number.isInteger(v) || v < 1 || v > sides))
          throw new Error('Invalid random result.');
        const ranked = values
          .map((v, i) => ({ v, i }))
          .sort((a, b) => (dice[3] === 'l' ? a.v - b.v : b.v - a.v));
        const indices = new Set(ranked.slice(0, keep).map((v) => v.i));
        const kept = values.map((_, i) => indices.has(i));
        const total = values.reduce((a, v, i) => a + (kept[i] ? v : 0), 0);
        result.dice.push({ sides, values, kept, total });
        return total;
      }
      const number = /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/.exec(input.slice(index));
      if (!number) throw new Error(`Expected a number or die at position ${index + 1}.`);
      index += number[0].length;
      return check(Number(number[0]));
    } finally {
      depth--;
    }
  }
  function product(): number {
    let n = atom();
    while (input[index] === '*' || input[index] === '/') {
      const op = input[index++];
      const right = atom();
      if (op === '/' && right === 0) throw new Error('Cannot divide by zero.');
      n = check(op === '*' ? n * right : n / right);
    }
    return n;
  }
  function sum(): number {
    let n = product();
    while (input[index] === '+' || input[index] === '-') {
      const op = input[index++];
      const right = product();
      n = check(op === '+' ? n + right : n - right);
    }
    return n;
  }
  result.total = sum();
  if (index !== input.length) throw new Error(`Unexpected input at position ${index + 1}.`);
  return result;
}
