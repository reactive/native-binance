import { CANDLE_LIMIT, INTERVALS, type CandleInterval } from '@/resources/Candle';

import { PLOT_PAD } from './candleLayout';
import { intervalMs, periodEnd, periodStart } from './chartMotion';

/** Critically damped clock reaches p = 0.99 at t = D. */
export const OMEGA_TAU = 6.638;
export const MIN_SCALE = 0.4;
export const TRAVEL_COMMIT_MS = 100;
export const KNOTS = 32;
export const REST_SPEED = 1e6;

/** `null` means the forming month's UTC day count. 1W↔1M is absent: a week can straddle two months. */
const ADJACENT: ReadonlyArray<readonly [CandleInterval, CandleInterval, number | null]> = [
  ['15m', '1h', 4],
  ['1h', '4h', 4],
  ['4h', '1d', 6],
  ['1d', '1w', 7],
  ['1d', '1M', null],
];

export type TravelCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TravelRefusal =
  | 'pair'
  | 'motion'
  | 'rest'
  | 'ready'
  | 'empty'
  | 'flat'
  | 'nest'
  | 'inside'
  | 'edge'
  | 'late';

export type Knot = { p: number; q: number; s: number };

export type Camera = {
  scaleX: number;
  translateX: number;
  scaleY: number;
  translateY: number;
};

export type TravelPlan = {
  from: CandleInterval;
  to: CandleInterval;
  zoomOut: boolean;
  k: number;
  duration: number;
  xStar: number;
  a: number;
  b: number;
  qH: number;
  pH: number;
  pEnd: number;
  knots: Knot[];
  origin: readonly TravelCandle[];
  target: readonly TravelCandle[];
  covered: ReadonlySet<number>;
  centres: ReadonlyMap<number, number>;
  slot: number;
  ratio: number;
  width: number;
  height: number;
  fullyInside: number;
  straddler: number | null;
};

export type TravelInput = {
  from: CandleInterval;
  to: CandleInterval;
  origin: readonly TravelCandle[];
  target: readonly TravelCandle[];
  now: number;
  reduceMotion: boolean;
  atRest: boolean;
  originReady: boolean;
  targetReady: boolean;
  elapsedMs: number;
  width: number;
  height: number;
  ratio: number;
};

export function neighbourIntervals(interval: CandleInterval): CandleInterval[] {
  const index = INTERVALS.findIndex(item => item.value === interval);
  if (index < 0) return [];
  const found: CandleInterval[] = [];
  if (index > 0) found.push(INTERVALS[index - 1].value);
  if (index < INTERVALS.length - 1) found.push(INTERVALS[index + 1].value);
  return found;
}

export function travelPair(
  from: CandleInterval,
  to: CandleInterval,
): { k: number | null; zoomOut: boolean } | null {
  for (const [finer, coarser, k] of ADJACENT) {
    if (from === finer && to === coarser) return { k, zoomOut: true };
    if (from === coarser && to === finer) return { k, zoomOut: false };
  }
  return null;
}

/** Days in the UTC month containing `openTime`. Months stay out of `intervalMs`. */
function monthDays(openTime: number): number {
  const start = periodStart(openTime, '1M');
  return Math.round((periodEnd(start, '1M') - start) / intervalMs('1d'));
}

export function travelDuration(k: number): number {
  return Math.round((200 + 70 * Math.log2(k)) / 10) * 10;
}

export function travelSpring(durationMs: number, toZero: boolean) {
  const omega = (OMEGA_TAU * 1000) / durationMs;
  return {
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * omega,
    overshootClamping: true as const,
    restDisplacementThreshold: toZero ? 0.0001 : 0.01,
    restSpeedThreshold: REST_SPEED,
  };
}

export function springPosition(u: number): number {
  return 1 - (1 + OMEGA_TAU * u) * Math.exp(-OMEGA_TAU * u);
}

export function sineInOut(u: number): number {
  return (1 - Math.cos(Math.PI * u)) / 2;
}

export function handoffQ(k: number, zoomOut: boolean): number {
  const q = Math.log(1 / MIN_SCALE) / Math.log(k);
  return zoomOut ? q : 1 - q;
}

/** u on the sine curve for a q, then the spring position at that u. */
export function progressAtQ(q: number): number {
  const clamped = Math.min(1, Math.max(0, q));
  const u = Math.acos(1 - 2 * clamped) / Math.PI;
  return springPosition(u);
}

export function finerScale(q: number, k: number, zoomOut: boolean): number {
  if (q <= 0) return zoomOut ? 1 : 1 / k;
  if (q >= 1) return zoomOut ? 1 / k : 1;
  return zoomOut ? k ** -q : k ** (q - 1);
}

function ascending(candles: readonly TravelCandle[]): boolean {
  for (let i = 1; i < candles.length; i += 1) {
    if (candles[i].openTime <= candles[i - 1].openTime) return false;
  }
  return true;
}

function seriesSpan(candles: readonly TravelCandle[]): number {
  let high = candles[0].high;
  let low = candles[0].low;
  for (const candle of candles) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  return high - low;
}

/** y = A * price + B, in CSS px. Matches `candleLayout`. */
function priceLine(candles: readonly TravelCandle[], height: number): { A: number; B: number } | null {
  const span = seriesSpan(candles);
  const inner = height - PLOT_PAD * 2;
  if (!(span > 0) || !(inner > 0)) return null;
  let high = candles[0].high;
  for (const candle of candles) if (candle.high > high) high = candle.high;
  return { A: -inner / span, B: (high / span) * inner + PLOT_PAD };
}

function nests(
  finer: readonly TravelCandle[],
  coarser: readonly TravelCandle[],
  finerInterval: CandleInterval,
  coarserInterval: CandleInterval,
): boolean {
  for (const candle of finer) {
    const end = periodEnd(candle.openTime, finerInterval);
    let hits = 0;
    for (const parent of coarser) {
      const parentEnd = periodEnd(parent.openTime, coarserInterval);
      if (parent.openTime <= candle.openTime && end <= parentEnd) hits += 1;
    }
    if (hits !== 1) return false;
  }
  return true;
}

export function compressedBodyRight(centre: number, xStar: number, k: number, slot: number): number {
  return xStar + (centre - xStar) * k + slot / 2;
}

function yOf(q: number, a: number, b: number, height: number, layer: 'old' | 'new'): {
  scaleY: number;
  translateY: number;
} {
  if (layer === 'old') {
    const scaleY = 1 + q * (a - 1);
    return { scaleY, translateY: q * b - (height / 2) * (1 - scaleY) };
  }
  const scaleY = (1 - q) / a + q;
  return { scaleY, translateY: -((1 - q) * b) / a - (height / 2) * (1 - scaleY) };
}

export function cameraSample(plan: TravelPlan, q: number, role: 'finer' | 'coarser'): Camera {
  const s = finerScale(q, plan.k, plan.zoomOut);
  const finerIsOld = plan.zoomOut;
  const layer = role === 'finer' ? (finerIsOld ? 'old' : 'new') : finerIsOld ? 'new' : 'old';
  const y = yOf(q, plan.a, plan.b, plan.height, layer);
  if (role === 'coarser') return { scaleX: 1, translateX: 0, scaleY: y.scaleY, translateY: y.translateY };
  return {
    scaleX: s,
    translateX: (plan.xStar / plan.ratio - plan.width / 2) * (1 - s),
    scaleY: y.scaleY,
    translateY: y.translateY,
  };
}

/** Coarser candle translate, device px, before the UI-thread floor. 0 at that series' rest. */
export function candleShift(plan: TravelPlan, centre: number, q: number): number {
  const atRest = (plan.zoomOut && q >= 1) || (!plan.zoomOut && q <= 0);
  if (atRest) return 0;
  const s = finerScale(q, plan.k, plan.zoomOut);
  return (centre - plan.xStar) * (plan.k * s - 1);
}

export function planTravel(input: TravelInput): { ok: true; plan: TravelPlan } | { ok: false; reason: TravelRefusal } {
  const pair = travelPair(input.from, input.to);
  if (!pair) return { ok: false, reason: 'pair' };
  if (input.reduceMotion) return { ok: false, reason: 'motion' };
  if (!input.atRest) return { ok: false, reason: 'rest' };
  if (!input.originReady || !input.targetReady) return { ok: false, reason: 'ready' };
  if (input.elapsedMs > TRAVEL_COMMIT_MS) return { ok: false, reason: 'late' };
  const { origin, target } = input;
  if (origin.length === 0 || target.length === 0) return { ok: false, reason: 'empty' };
  if (!(seriesSpan(origin) > 0) || !(seriesSpan(target) > 0)) return { ok: false, reason: 'flat' };

  const zoomOut = pair.zoomOut;
  const finerInterval = zoomOut ? input.from : input.to;
  const coarserInterval = zoomOut ? input.to : input.from;
  const finer = zoomOut ? origin : target;
  const coarser = zoomOut ? target : origin;
  if (!ascending(finer) || !ascending(coarser)) return { ok: false, reason: 'nest' };
  if (!nests(finer, coarser, finerInterval, coarserInterval)) return { ok: false, reason: 'nest' };

  const windowStart = finer[0].openTime;
  const covered = new Set<number>();
  let fullyInside = 0;
  let straddler: number | null = null;
  const outsideCentres: number[] = [];
  const slot = Math.floor((input.width * input.ratio) / CANDLE_LIMIT);
  const leading = input.width * input.ratio - coarser.length * slot;
  const centres = new Map<number, number>();
  for (let index = 0; index < coarser.length; index += 1) {
    const candle = coarser[index];
    const centre = leading + index * slot + slot / 2;
    centres.set(candle.openTime, centre);
    const end = periodEnd(candle.openTime, coarserInterval);
    if (end <= windowStart) {
      outsideCentres.push(centre);
      continue;
    }
    covered.add(candle.openTime);
    if (candle.openTime >= windowStart && end <= input.now) fullyInside += 1;
    else if (candle.openTime < windowStart && end > windowStart) straddler = candle.openTime;
  }
  // Sixty days cover one complete month, not four. Other pairs still need four.
  if (fullyInside < (pair.k == null ? 1 : 4)) return { ok: false, reason: 'inside' };

  if (finerInterval === '1M') return { ok: false, reason: 'pair' };
  const k = pair.k ?? monthDays(finer[finer.length - 1].openTime);
  const newestLeft = input.width * input.ratio - slot;
  const tFiner = finer[finer.length - 1].openTime;
  const tCoarser = coarser[coarser.length - 1].openTime;
  const xStar = newestLeft + (slot * (tFiner - tCoarser)) / (intervalMs(finerInterval) * (k - 1));
  for (const centre of outsideCentres) {
    if (!(compressedBodyRight(centre, xStar, k, slot) < 0)) return { ok: false, reason: 'edge' };
  }

  const oldLine = priceLine(origin, input.height);
  const newLine = priceLine(target, input.height);
  if (!oldLine || !newLine) return { ok: false, reason: 'flat' };
  const a = newLine.A / oldLine.A;
  const b = newLine.B - a * oldLine.B;

  const knots: Knot[] = [];
  for (let j = 0; j <= KNOTS; j += 1) {
    const u = j / KNOTS;
    const q = sineInOut(u);
    knots.push({ p: springPosition(u), q, s: finerScale(q, k, zoomOut) });
  }

  return {
    ok: true,
    plan: {
      from: input.from,
      to: input.to,
      zoomOut,
      k,
      duration: travelDuration(k),
      xStar,
      a,
      b,
      qH: handoffQ(k, zoomOut),
      pH: progressAtQ(handoffQ(k, zoomOut)),
      pEnd: springPosition(1),
      knots,
      origin,
      target,
      covered,
      centres,
      slot,
      ratio: input.ratio,
      width: input.width,
      height: input.height,
      fullyInside,
      straddler,
    },
  };
}

export type CameraTable = {
  input: number[];
  scaleX: number[];
  translateX: number[];
  scaleY: number[];
  translateY: number[];
};

export function cameraTable(plan: TravelPlan, role: 'finer' | 'coarser'): CameraTable {
  const table: CameraTable = { input: [], scaleX: [], translateX: [], scaleY: [], translateY: [] };
  for (const knot of plan.knots) {
    const sample = cameraSample(plan, knot.q, role);
    table.input.push(knot.p);
    table.scaleX.push(sample.scaleX);
    table.translateX.push(sample.translateX);
    table.scaleY.push(sample.scaleY);
    table.translateY.push(sample.translateY);
  }
  return table;
}

export function shiftTable(plan: TravelPlan, centre: number): number[] {
  return plan.knots.map(knot => candleShift(plan, centre, knot.q));
}
