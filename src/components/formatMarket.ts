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

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `HH:mm:ss` in the phone's zone. Uses local date fields so Hermes `Intl` is not required. */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

const VOLUME_TIERS = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
] as const;

/** Compact quote volume so high, low, and volume share one 360px line. */
export function formatQuoteVolume(value: number): string {
  const abs = Math.abs(value);
  for (const [size, unit] of VOLUME_TIERS) {
    if (abs < size) continue;
    const scaled = value / size;
    const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)}${unit}`;
  }
  return formatLast(value, '0.01');
}
