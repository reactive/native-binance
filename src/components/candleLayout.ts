import { CANDLE_LIMIT } from '@/resources/Candle';

const CHROME = 156;
const INTERVAL_ROW = 44;
const READOUT = 40;
const GUTTER = 24;
/** Top bar, price strip, segment, and interval chips. Plot screen y is the top inset plus this. */
const ABOVE_PLOT = 200;
const PLOT_MARGIN = 12;

export type CandleDirection = 'up' | 'down' | 'flat';

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
  wickCss: number;
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
    wickCss: gap / ratio,
  };
}

function snap(value: number, ratio: number): number {
  return Math.round(value * ratio) / ratio;
}

function directionOf(open: number, close: number): CandleDirection {
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
  const inner = height - 16;
  const y = (price: number) => ((maxHigh - price) / span) * inner + 8;
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
