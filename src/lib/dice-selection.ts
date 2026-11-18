const plainDie = /^(\d*)d(\d+)$/i;
const anyDie = /^(\d*)d(\d+)(?:k[hl]\d+)?$/i;
const tokens =
  /@\{[^}]*\}|(?:\d\s*)*d\s*\d(?:\s*\d)*(?:\s*k\s*[hl]\s*\d(?:\s*\d)*)?\b|(?:\d+(?:\.\d+)?|\.\d+)(?:\s*e\s*[+-]?\s*\d+)?|\S/gi;

/** Edit plain, positive top-level dice terms without rewriting the rest of the expression. */
export function diceSelection(expression: string) {
  const counts = new Map<number, number>();
  const terms: { start: number; end: number; amount: number; sides: number }[] = [];
  let total = 0;
  let depth = 0;
  let start = 0;
  let previous = '';

  function collect(end: number) {
    const part = expression.slice(start, end).replace(/\s+/g, '');
    const match = plainDie.exec(start === 0 ? part : part.replace(/^\+/, ''));
    if (!match) return;
    const amount = Number(match[1] || 1);
    if (amount > 0) terms.push({ start, end, amount, sides: Number(match[2]) });
  }

  for (const { 0: token, index } of expression.matchAll(tokens)) {
    if (token === '(') depth++;
    if (token === ')') depth--;
    if (
      depth === 0 &&
      (token === '+' || token === '-') &&
      previous &&
      !'+-*/(,'.includes(previous)
    ) {
      collect(index);
      start = index;
    }
    const match = anyDie.exec(token.replace(/\s+/g, ''));
    if (match) {
      const amount = Number(match[1] || 1);
      const sides = Number(match[2]);
      counts.set(sides, (counts.get(sides) ?? 0) + amount);
      total += amount;
    }
    previous = token;
  }
  if (depth === 0) collect(expression.length);

  function change(sides: number, delta: 1 | -1): string {
    if (delta === 1 && (total >= 100 || depth !== 0 || (previous && '+-*/,'.includes(previous))))
      return expression;
    const term = terms.find((term) => term.sides === sides);
    if (!term) {
      if (delta === -1) return expression;
      const input = expression.trimEnd();
      const next = input ? `${input} + 1d${sides}` : `1d${sides}`;
      return next.length <= 500 ? next : expression;
    }
    const before = expression.slice(0, term.start).trimEnd();
    const after = expression.slice(term.end);
    const amount = term.amount + delta;
    if (amount === 0) {
      if (before) return `${before}${after ? ` ${after}` : ''}`;
      return after.startsWith('+') ? after.slice(1).trimStart() : after;
    }
    const die = `${amount}d${sides}`;
    const next = `${before ? `${before} + ` : ''}${die}${after ? ` ${after}` : ''}`;
    return delta === -1 || next.length <= 500 ? next : expression;
  }

  return { counts, change };
}
