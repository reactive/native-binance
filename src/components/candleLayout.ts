import { CANDLE_LIMIT } from '@/resources/Candle';

const CHROME = 156;
export const INTERVAL_ROW = 44;
export const READOUT = 40;
export const PLOT_MARGIN = 12;
/** Series high and low sit in these bands. Candles use the height between them. */
export const PLOT_PAD = 20;
const GUTTER = PLOT_MARGIN * 2;
/** Top bar, price strip, segment, and interval chips. */
const ABOVE_PLOT = CHROME + INTERVAL_ROW;

export type CandleDirection = 'up' | 'down' | 'flat';

/** Spoken direction. Color is never the only signal. */
export const DIRECTION_WORD: Record<CandleDirection, 'Up' | 'Down' | 'Flat'> = {
  up: 'Up',
  down: 'Down',
  flat: 'Flat',
};

export type CandlePlacement = {
  x: number;
  bodyTop: number;
  bodyHeight: number;
  wickTop: number;
  wickHeight: number;
  direction: CandleDirection;
};

export type CandleMetrics = {
  /** Device pixels. */
  slot: number;
  gap: number;
  body: number;
  wick: number;
  bodyCss: number;
};

type CandlePoint = {
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Plot size inside the symbol body. `(384, 832, 47, 24)` is 360 × 521. */
export function plotSize(
  windowWidth: number,
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
): { width: number; height: number } {
  return {
    width: windowWidth - GUTTER,
    height: windowHeight - insetTop - insetBottom - CHROME - INTERVAL_ROW - READOUT,
  };
}

/**
 * Fractional device pixels of the plot's screen origin.
 * At 3.75 the fixture origin is 0.25px below a device row, which antialiases every horizontal edge.
 * The plot shifts its device-pixel layer up by this amount before scaling back to CSS px.
 */
export function plotDeviceShift(
  insetTop: number,
  insetLeft: number,
  ratio: number,
): { x: number; y: number } {
  const frac = (css: number) => {
    const whole = css * ratio;
    const part = whole - Math.floor(whole);
    if (part < 1e-4 || 1 - part < 1e-4) return 0;
    return part;
  };
  return { x: frac(insetLeft + PLOT_MARGIN), y: frac(insetTop + ABOVE_PLOT) };
}

/**
 * Candle under a plot-local CSS x. Right-aligned like `candleLayout`.
 * The empty lead-in snaps to the first candle; past the last snaps to the last.
 */
export function candleIndexAt(
  x: number,
  count: number,
  width: number,
  ratio: number,
): number | null {
  if (!(count > 0) || !(width > 0) || !(ratio > 0)) return null;
  if (!(x >= 0) || x > width) return null;
  const { slot } = candleMetrics(width, ratio);
  if (!(slot > 0)) return null;
  const leading = width * ratio - count * slot;
  const index = Math.floor((x * ratio - leading) / slot);
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export function candleMetrics(width: number, ratio: number): CandleMetrics {
  const slot = Math.floor((width * ratio) / CANDLE_LIMIT);
  const gap = Math.round(ratio);
  const body = slot - gap;
  return {
    slot,
    gap,
    body,
    wick: gap,
    bodyCss: body / ratio,
  };
}

function snap(value: number, ratio: number): number {
  return Math.round(value * ratio) / ratio;
}

export function directionOf(open: number, close: number): CandleDirection {
  if (close > open) return 'up';
  if (close < open) return 'down';
  return 'flat';
}

/** Right-aligned candle geometry. Lengths are CSS px that land on device pixels at `ratio`. */
export function candleLayout(
  candles: readonly CandlePoint[],
  size: { width: number; height: number; ratio: number },
): CandlePlacement[] {
  const { width, height, ratio } = size;
  if (width <= 0 || height <= 0 || ratio <= 0 || candles.length === 0) return [];

  const { slot, gap } = candleMetrics(width, ratio);
  const leading = width * ratio - candles.length * slot;
  let maxHigh = candles[0].high;
  let minLow = candles[0].low;
  for (const candle of candles) {
    if (candle.high > maxHigh) maxHigh = candle.high;
    if (candle.low < minLow) minLow = candle.low;
  }
  const span = maxHigh - minLow;
  const inner = height - PLOT_PAD * 2;
  if (inner <= 0) return [];
  const y = (price: number) => ((maxHigh - price) / span) * inner + PLOT_PAD;
  const flat = span === 0;
  const thickness = snap(1, ratio);
  const flatTop = snap((height - thickness) / 2, ratio);

  return candles.map((candle, index) => {
    const x = (leading + index * slot + gap) / ratio;
    const direction = directionOf(candle.open, candle.close);
    if (flat) {
      return {
        x,
        bodyTop: flatTop,
        bodyHeight: thickness,
        wickTop: flatTop,
        wickHeight: thickness,
        direction,
      };
    }

    const rawWickTop = y(candle.high);
    const rawWickHeight = Math.max(y(candle.low) - rawWickTop, 1);
    const rawBodyTop = y(Math.max(candle.open, candle.close));
    const rawBodyHeight = y(Math.min(candle.open, candle.close)) - rawBodyTop;
    const bodyHeight = snap(Math.max(rawBodyHeight, 1), ratio);
    const bodyTop =
      rawBodyHeight < 1 ? snap(rawBodyTop + rawBodyHeight / 2 - bodyHeight / 2, ratio)
      : snap(rawBodyTop, ratio);

    return {
      x,
      bodyTop,
      bodyHeight,
      wickTop: snap(rawWickTop, ratio),
      wickHeight: snap(rawWickHeight, ratio),
      direction,
    };
  });
}
