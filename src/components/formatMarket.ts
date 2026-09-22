function groupThousands(integer: string): string {
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Decimal places of a Binance tick/step string (`"0.01000000"` → 2). */
export function placesOf(step: string): number {
  const dot = step.indexOf('.');
  if (dot === -1) return 0;
  const digits = step.slice(dot + 1).replace(/0+$/, '');
  return Math.min(8, digits.length);
}

export function formatLast(value: number, tickSize: string): string {
  const fixed = value.toFixed(placesOf(tickSize));
  const dot = fixed.indexOf('.');
  if (dot === -1) return groupThousands(fixed);
  return groupThousands(fixed.slice(0, dot)) + fixed.slice(dot);
}

export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
