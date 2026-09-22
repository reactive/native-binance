function groupThousands(integer: string): string {
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `toFixed(places)` with thousands grouping. */
export function formatPrice(value: number, places: number): string {
  const fixed = value.toFixed(places);
  const dot = fixed.indexOf('.');
  if (dot === -1) return groupThousands(fixed);
  return groupThousands(fixed.slice(0, dot)) + fixed.slice(dot);
}

/** `toFixed(places)` with no grouping, matching the ladder's size column. */
export function formatSize(value: number, places: number): string {
  return value.toFixed(places);
}

/** Decimal places of a number, after 12-digit float cleanup. Capped at 8. */
export function decimalsOf(value: number): number {
  // 12 significant digits drops binary float noise (86412.38999999 -> 86412.39).
  const text = String(Number(value.toPrecision(12)));
  const dot = text.indexOf('.');
  const exp = text.indexOf('e-');
  if (exp !== -1) {
    const fraction = dot === -1 ? 0 : exp - dot - 1;
    return Math.min(8, Number(text.slice(exp + 2)) + fraction);
  }
  if (dot === -1) return 0;
  return Math.min(8, text.length - dot - 1);
}

/** Trim a decimal string for display. Never converts through a float. */
export function trimDecimal(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
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
  return formatPrice(value, 2);
}
