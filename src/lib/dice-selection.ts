/** Die types in the editable expression, excluding sheet-field references. */
export function selectedDiceSides(expression: string): Set<number> {
  const input = expression
    .replace(/@\{[^}]*\}/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return new Set(
    Array.from(input.matchAll(/\b\d*d(\d+)(?:k[hl]\d+)?\b/g), (match) => Number(match[1])),
  );
}
