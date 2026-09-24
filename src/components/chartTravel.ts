import { INTERVALS, type CandleInterval } from '@/resources/Candle';

import { PLOT_PAD, candleMetrics, type CandlePlacement } from './candleLayout';
import { intervalMs, periodEnd, periodStart } from './chartMotion';

/** Critically damped clock reaches p ≈ 0.99 at t = D. */
export const OMEGA_TAU = 6.638;
export const MIN_SCALE = 0.4;
export const TRAVEL_COMMIT_MS = 100;
export const REST_SPEED = 1e6;
/** Mean Gregorian month. The month axis is 22px per this length, not the forming month. */
export const MEAN_MONTH_DAYS = 30.436875;
const DAY = 24 * 60 * 60_000;
const MEAN_MONTH_MS = MEAN_MONTH_DAYS * DAY;
const FIVE_MIN = 5 * 60_000;

/**
 * µs budgeted for one per-candle animated view update.
 * A 240-node JS graph (the web and Jest clock) measured about 1µs per read.
 * 8µs leaves room for a slower native prop update and still fits the attached peaks in 2ms.
 */
export const UPDATE_US = 8;
export const UPDATE_BUDGET_US = 2000;
const STAGING_LEAD_MS = 150;
const STAGING_LEAD_TIGHT_MS = 80;

export const LADDER = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'] as const;
export type StepId = (typeof LADDER)[number];

export type TravelCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type StoredList = {
  candles: readonly TravelCandle[];
  error?: boolean;
};

export type TravelRefusal = 'motion' | 'rest' | 'ready' | 'empty' | 'flat' | 'edge' | 'late' | 'budget';

export type PriceDomain = { high: number; low: number };

export type OpacityStops = { input: number[]; output: number[] };

export type StepPlan = {
  interval: StepId;
  candles: TravelCandle[];
  covered: ReadonlySet<number>;
  straddler: number | null;
  /** False for the finest step, which squeezes as one layer. */
  split: boolean;
  perCandle: boolean;
  derivedOnly: boolean;
  domain: PriceDomain | null;
  centres: ReadonlyMap<number, number>;
  /** σ at which covered candles are born. */
  birthSigma: number;
  qAlive0: number;
  qAlive1: number;
  forwardThreshold: number;
  reverseThreshold: number;
  mountAt: number;
  input: number[];
  scaleX: number[];
  translateX: number[];
  scaleY: number[];
  translateY: number[];
  shifts: ReadonlyMap<number, number[]>;
  layer: OpacityStops;
  coveredStops: OpacityStops | null;
  readout: OpacityStops;
};

export type TravelPlan = {
  from: CandleInterval;
  to: CandleInterval;
  zoomOut: boolean;
  /** Ratio of the two end periods. A month is the mean Gregorian month. */
  k: number;
  duration: number;
  xStar: number;
  tStar: number;
  v0: number;
  v1: number;
  anchor: number;
  span0: number;
  span1: number;
  slot: number;
  ratio: number;
  width: number;
  height: number;
  inner: number;
  pEnd: number;
  steps: StepPlan[];
  peakViews: number;
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
  /** Closed candles for intermediate steps. 5m is never read from here. */
  stored?: Partial<Record<StepId, StoredList>>;
  /** Skip per-candle tables. Geometry, gates, and steps stay the same. */
  detail?: boolean;
};

type LayoutMap = { A: number; anchorY: number };

type Built = {
  interval: StepId;
  candles: TravelCandle[];
  covered: Set<number>;
  straddler: number | null;
  split: boolean;
  derivedOnly: boolean;
  centres: Map<number, number>;
  layout: LayoutMap;
  domain: PriceDomain | null;
  birthSigma: number;
};

/** Neighbours first, then the rest of the row, nearest first. */
export function rowFetchOrder(interval: CandleInterval): CandleInterval[] {
  const index = INTERVALS.findIndex(item => item.value === interval);
  if (index < 0) return [];
  const order: CandleInterval[] = [];
  const push = (at: number) => {
    if (at >= 0 && at < INTERVALS.length && at !== index) order.push(INTERVALS[at].value);
  };
  push(index - 1);
  push(index + 1);
  for (let distance = 2; distance < INTERVALS.length; distance += 1) {
    push(index - distance);
    push(index + distance);
  }
  return order;
}

export function ladderSteps(from: CandleInterval, to: CandleInterval): StepId[] {
  const ia = LADDER.indexOf(from);
  const ib = LADDER.indexOf(to);
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  return LADDER.slice(lo, hi + 1);
}

export function periodLength(interval: StepId): number {
  if (interval === '1M') return MEAN_MONTH_MS;
  if (interval === '5m') return FIVE_MIN;
  return intervalMs(interval);
}

export function stepPeriodStart(time: number, interval: StepId): number {
  if (interval === '5m') return Math.floor(time / FIVE_MIN) * FIVE_MIN;
  return periodStart(time, interval);
}

export function stepPeriodEnd(openTime: number, interval: StepId): number {
  if (interval === '5m') return openTime + FIVE_MIN;
  return periodEnd(openTime, interval);
}

export function travelDuration(k: number): number {
  const raw = Math.round((200 + 70 * Math.log2(k)) / 10) * 10;
  return Math.min(900, raw);
}

export function travelSpring(durationMs: number, restDisplacementThreshold: number) {
  const omega = (OMEGA_TAU * 1000) / durationMs;
  return {
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * omega,
    overshootClamping: true as const,
    restDisplacementThreshold,
    restSpeedThreshold: REST_SPEED,
  };
}

export function springPosition(u: number): number {
  return 1 - (1 + OMEGA_TAU * u) * Math.exp(-OMEGA_TAU * u);
}

export function progressAtQ(q: number): number {
  const clamped = Math.min(1, Math.max(0, q));
  const u = Math.acos(1 - 2 * clamped) / Math.PI;
  return springPosition(u);
}

export function timeOfQ(q: number, duration: number): number {
  const clamped = Math.min(1, Math.max(0, q));
  return (duration * Math.acos(1 - 2 * clamped)) / Math.PI;
}

function sortCandles(candles: readonly TravelCandle[]): TravelCandle[] {
  return [...candles].sort((a, b) => a.openTime - b.openTime);
}

function seriesSpan(candles: readonly TravelCandle[]): { high: number; low: number; span: number } {
  let high = candles[0].high;
  let low = candles[0].low;
  for (const candle of candles) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  return { high, low, span: high - low };
}

function aggregate(openTime: number, group: readonly TravelCandle[]): TravelCandle {
  let high = group[0].high;
  let low = group[0].low;
  for (const candle of group) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  return {
    openTime,
    open: group[0].open,
    high,
    low,
    close: group[group.length - 1].close,
  };
}

function usable(stored: StoredList | undefined, straddler: number | null, windowStart: number): boolean {
  if (!stored || stored.error || stored.candles.length === 0) return false;
  let newest = stored.candles[0].openTime;
  for (const candle of stored.candles) if (candle.openTime > newest) newest = candle.openTime;
  return newest >= (straddler ?? windowStart);
}

function deriveCovered(
  finer: readonly TravelCandle[],
  interval: StepId,
): { candles: TravelCandle[]; straddler: number | null } {
  const windowStart = finer[0].openTime;
  const groups = new Map<number, TravelCandle[]>();
  for (const candle of finer) {
    const open = stepPeriodStart(candle.openTime, interval);
    const group = groups.get(open);
    if (group) group.push(candle);
    else groups.set(open, [candle]);
  }
  const candles: TravelCandle[] = [];
  let straddler: number | null = null;
  for (const open of [...groups.keys()].sort((a, b) => a - b)) {
    const end = stepPeriodEnd(open, interval);
    if (open < windowStart && end > windowStart) straddler = open;
    candles.push(aggregate(open, groups.get(open)!));
  }
  return { candles, straddler };
}

function buildIntermediate(
  interval: StepId,
  finer: readonly TravelCandle[],
  stored: StoredList | undefined,
  now: number,
  forceDerived: boolean,
): { candles: TravelCandle[]; covered: Set<number>; straddler: number | null; derivedOnly: boolean } {
  const windowStart = finer[0].openTime;
  const derived = deriveCovered(finer, interval);
  const derivedOnly = forceDerived || interval === '5m' || !usable(stored, derived.straddler, windowStart);
  if (derivedOnly) {
    return {
      candles: derived.candles,
      covered: new Set(derived.candles.map(candle => candle.openTime)),
      straddler: derived.straddler,
      derivedOnly: true,
    };
  }
  const storedByTime = new Map<number, TravelCandle>();
  for (const candle of stored!.candles) storedByTime.set(candle.openTime, candle);
  const merged = new Map<number, TravelCandle>();
  for (const candle of stored!.candles) {
    if (stepPeriodEnd(candle.openTime, interval) <= windowStart) merged.set(candle.openTime, candle);
  }
  for (const candle of derived.candles) {
    const end = stepPeriodEnd(candle.openTime, interval);
    const closedStraddler = candle.openTime === derived.straddler && end <= now;
    const storedCandle = closedStraddler ? storedByTime.get(candle.openTime) : undefined;
    merged.set(candle.openTime, storedCandle ?? candle);
  }
  const candles = [...merged.values()].sort((a, b) => a.openTime - b.openTime);
  const covered = new Set<number>();
  for (const candle of candles) {
    if (stepPeriodEnd(candle.openTime, interval) > windowStart) covered.add(candle.openTime);
  }
  return { candles, covered, straddler: derived.straddler, derivedOnly: false };
}

function classify(
  candles: readonly TravelCandle[],
  finer: readonly TravelCandle[] | null,
  interval: StepId,
): { covered: Set<number>; straddler: number | null; split: boolean } {
  if (!finer) return { covered: new Set(), straddler: null, split: false };
  const windowStart = finer[0].openTime;
  const covered = new Set<number>();
  let straddler: number | null = null;
  for (const candle of candles) {
    const end = stepPeriodEnd(candle.openTime, interval);
    if (candle.openTime < windowStart && end > windowStart) straddler = candle.openTime;
    if (end > windowStart) covered.add(candle.openTime);
  }
  return { covered, straddler, split: true };
}

function centresOf(candles: readonly TravelCandle[], width: number, ratio: number, slot: number): Map<number, number> {
  const leading = width * ratio - candles.length * slot;
  const centres = new Map<number, number>();
  candles.forEach((candle, index) => {
    centres.set(candle.openTime, leading + index * slot + slot / 2);
  });
  return centres;
}

function furthestIntermediates(steps: readonly StepId[]): Set<StepId> {
  let best = 0;
  const distance = steps.map((_, index) => Math.min(index, steps.length - 1 - index));
  for (const value of distance) if (value > best) best = value;
  const found = new Set<StepId>();
  if (best === 0) return found;
  steps.forEach((interval, index) => {
    if (distance[index] === best) found.add(interval);
  });
  return found;
}

type CameraBase = {
  xStar: number;
  tStar: number;
  v0: number;
  v1: number;
  logV0: number;
  logV1: number;
  anchor: number;
  span0: number;
  span1: number;
  yAnchor0: number;
  yAnchor1: number;
  slot: number;
  ratio: number;
  width: number;
  height: number;
  inner: number;
};

function velocity(base: CameraBase, q: number): number {
  if (q <= 0) return base.v0;
  if (q >= 1) return base.v1;
  return Math.exp((1 - q) * base.logV0 + q * base.logV1);
}

function sigmaOf(base: CameraBase, stepV: number, q: number): number {
  return velocity(base, q) / stepV;
}

function qAtSigma(base: CameraBase, stepV: number, sigma: number): number {
  return (Math.log(sigma * stepV) - base.logV0) / (base.logV1 - base.logV0);
}

function priceY(base: CameraBase, q: number, price: number): number {
  const span = base.span0 ** (1 - q) * base.span1 ** q;
  const yAnchor = (1 - q) * base.yAnchor0 + q * base.yAnchor1;
  return yAnchor + (price - base.anchor) * (-base.inner / span);
}

function monthCentre(base: CameraBase, stepV: number, slotCentre: number, openTime: number, q: number): number {
  const sigma = sigmaOf(base, stepV, q);
  const end = periodEnd(openTime, '1M');
  const tMid = (openTime + end) / 2;
  const speed = velocity(base, q);
  const xTrue = base.xStar + (tMid - base.tStar) * speed;
  const xRest = base.xStar + (tMid - base.tStar) * stepV;
  const correction = slotCentre - xRest;
  return xTrue + correction / sigma;
}

function screenCentre(base: CameraBase, built: Built, openTime: number, q: number): number {
  const slotCentre = built.centres.get(openTime) ?? 0;
  const stepV = base.slot / periodLength(built.interval);
  const sigma = sigmaOf(base, stepV, q);
  if (built.interval === '1M' && sigma >= 1) return monthCentre(base, stepV, slotCentre, openTime, q);
  return base.xStar + (slotCentre - base.xStar) * sigma;
}

function bodyRight(base: CameraBase, built: Built, openTime: number, q: number): number {
  const slotCentre = built.centres.get(openTime) ?? 0;
  const stepV = base.slot / periodLength(built.interval);
  const sigma = sigmaOf(base, stepV, q);
  if (sigma <= 1) {
    const restRight = slotCentre + base.slot / 2;
    return base.xStar + (restRight - base.xStar) * sigma;
  }
  return screenCentre(base, built, openTime, q) + base.slot / 2;
}

function bodyLeft(base: CameraBase, built: Built, openTime: number, q: number): number {
  const slotCentre = built.centres.get(openTime) ?? 0;
  const stepV = base.slot / periodLength(built.interval);
  const sigma = sigmaOf(base, stepV, q);
  if (sigma <= 1) {
    const restLeft = slotCentre - base.slot / 2;
    return base.xStar + (restLeft - base.xStar) * sigma;
  }
  return screenCentre(base, built, openTime, q) - base.slot / 2;
}

function isDrawn(built: Built, openTime: number, sigma: number): boolean {
  if (sigma < MIN_SCALE - 1e-8) return false;
  if (!built.split) return true;
  if (built.covered.has(openTime)) return sigma <= built.birthSigma + 1e-8;
  return true;
}

function aliveRange(base: CameraBase, stepV: number): { q0: number; q1: number } {
  const s0 = sigmaOf(base, stepV, 0);
  const s1 = sigmaOf(base, stepV, 1);
  const q40 = qAtSigma(base, stepV, MIN_SCALE);
  if (s1 >= s0) {
    const start = s0 >= MIN_SCALE - 1e-8 ? 0 : Math.min(1, Math.max(0, q40));
    return { q0: start, q1: 1 };
  }
  const end = s1 >= MIN_SCALE - 1e-8 ? 1 : Math.min(1, Math.max(0, q40));
  return { q0: 0, q1: end };
}

function onScreen(base: CameraBase, built: Built, openTime: number, q: number): boolean {
  const stepV = base.slot / periodLength(built.interval);
  if (!isDrawn(built, openTime, sigmaOf(base, stepV, q))) return false;
  const right = bodyRight(base, built, openTime, q);
  const left = bodyLeft(base, built, openTime, q);
  const plot = base.width * base.ratio;
  return right >= 0 && left <= plot;
}

function firstVisibleQ(base: CameraBase, built: Built, alive: { q0: number; q1: number }): number {
  const samples = 128;
  for (let i = 0; i <= samples; i += 1) {
    const q = alive.q0 + ((alive.q1 - alive.q0) * i) / samples;
    for (const candle of built.candles) {
      if (onScreen(base, built, candle.openTime, q)) return q;
    }
  }
  return alive.q1;
}

function othersOffScreen(base: CameraBase, built: Built[], from: StepId, to: StepId): boolean {
  for (const q of [0, 1]) {
    const active = q === 0 ? from : to;
    for (const step of built) {
      if (step.interval === active) continue;
      for (const candle of step.candles) {
        const stepV = base.slot / periodLength(step.interval);
        if (!isDrawn(step, candle.openTime, sigmaOf(base, stepV, q))) continue;
        if (!(bodyRight(base, step, candle.openTime, q) < 1e-4)) return false;
      }
    }
  }
  return true;
}

function windowStops(from: number, until: number): OpacityStops {
  const start = Math.min(from, until);
  const end = Math.max(from, until);
  if (start <= 1e-9 && end >= 1 - 1e-6) return { input: [0, 1], output: [1, 1] };
  if (start <= 1e-9) return { input: [0, end, end, 1], output: [1, 1, 0, 0] };
  if (end >= 1 - 1e-6) return { input: [0, start, start, 1], output: [0, 0, 1, 1] };
  return { input: [0, start, start, end, end, 1], output: [0, 0, 1, 1, 0, 0] };
}

function knotQs(k: number, extras: readonly number[]): number[] {
  const lnK = Math.log(k);
  const dq = Math.min(1 / 32, lnK > 0 ? 0.1 / lnK : 1 / 32);
  const n = Math.max(1, Math.ceil(1 / dq));
  const list: number[] = [];
  for (let j = 0; j <= n; j += 1) list.push(j / n);
  for (const extra of extras) {
    if (extra > 0 && extra < 1) list.push(extra);
  }
  list.sort((a, b) => a - b);
  const out = [list[0]];
  for (const q of list) {
    if (q - out[out.length - 1] > 1e-6) out.push(q);
  }
  if (out[out.length - 1] !== 1) out.push(1);
  return out;
}

function yScale(
  base: CameraBase,
  layout: LayoutMap,
  q: number,
): { scaleY: number; translateY: number } {
  const span = base.span0 ** (1 - q) * base.span1 ** q;
  const yAnchor = (1 - q) * base.yAnchor0 + q * base.yAnchor1;
  const scaleY = -base.inner / span / layout.A;
  const beta = yAnchor - scaleY * layout.anchorY;
  return { scaleY, translateY: beta - (base.height / 2) * (1 - scaleY) };
}

function candleTranslate(base: CameraBase, built: Built, openTime: number, q: number): number {
  const stepV = base.slot / periodLength(built.interval);
  const sigma = sigmaOf(base, stepV, q);
  if (sigma <= 1) return 0;
  const slotCentre = built.centres.get(openTime) ?? 0;
  return screenCentre(base, built, openTime, q) - slotCentre;
}

function peakViews(steps: readonly StepPlan[], duration: number): number {
  const events: { t: number; delta: number }[] = [];
  for (const step of steps) {
    if (!step.perCandle) continue;
    const t1 = timeOfQ(step.qAlive1, duration);
    if (t1 <= step.mountAt) continue;
    events.push({ t: step.mountAt, delta: step.candles.length });
    events.push({ t: t1, delta: -step.candles.length });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    if (current > peak) peak = current;
  }
  return peak;
}

function layoutFor(
  base: CameraBase,
  interval: StepId,
  end: 'origin' | 'target' | 'mid',
): { layout: LayoutMap; domain: PriceDomain | null } {
  if (end === 'origin') {
    return {
      layout: { A: -base.inner / base.span0, anchorY: base.yAnchor0 },
      domain: null,
    };
  }
  if (end === 'target') {
    const y1 = priceY(base, 1, base.anchor);
    return {
      layout: { A: -base.inner / base.span1, anchorY: y1 },
      domain: null,
    };
  }
  const stepV = base.slot / periodLength(interval);
  const qS = Math.min(1, Math.max(0, qAtSigma(base, stepV, 1)));
  const span = base.span0 ** (1 - qS) * base.span1 ** qS;
  const yAnchor = (1 - qS) * base.yAnchor0 + qS * base.yAnchor1;
  const A = -base.inner / span;
  const high = base.anchor + (PLOT_PAD - yAnchor) / A;
  const low = base.anchor + (base.height - PLOT_PAD - yAnchor) / A;
  return { layout: { A, anchorY: yAnchor }, domain: { high, low } };
}

function assemble(
  input: TravelInput,
  origin: TravelCandle[],
  target: TravelCandle[],
  ids: readonly StepId[],
  leadMs: number,
  derive: ReadonlySet<StepId>,
): { ok: true; plan: TravelPlan } | { ok: false; reason: 'edge' } {
  const zoomOut = ids[0] === input.from;
  const finerEnd = zoomOut ? origin : target;
  const coarserEnd = zoomOut ? target : origin;
  const lists = new Map<StepId, TravelCandle[]>();
  lists.set(ids[0], finerEnd);
  lists.set(ids[ids.length - 1], coarserEnd);

  const spanOrigin = seriesSpan(origin);
  const spanTarget = seriesSpan(target);
  const slot = candleMetrics(input.width, input.ratio).slot;
  const newestLeft = input.width * input.ratio - slot;
  const v0 = slot / periodLength(input.from);
  const v1 = slot / periodLength(input.to);
  const t0 = origin[origin.length - 1].openTime;
  const t1 = target[target.length - 1].openTime;
  const tStar = (t0 * v0 - t1 * v1) / (v0 - v1);
  const xStar = newestLeft + (tStar - t0) * v0;
  const inner = input.height - PLOT_PAD * 2;
  const anchor = origin[origin.length - 1].close;
  const yOf = (high: number, span: number, price: number) => ((high - price) / span) * inner + PLOT_PAD;
  const base: CameraBase = {
    xStar,
    tStar,
    v0,
    v1,
    logV0: Math.log(v0),
    logV1: Math.log(v1),
    anchor,
    span0: spanOrigin.span,
    span1: spanTarget.span,
    yAnchor0: yOf(spanOrigin.high, spanOrigin.span, anchor),
    yAnchor1: yOf(spanTarget.high, spanTarget.span, anchor),
    slot,
    ratio: input.ratio,
    width: input.width,
    height: input.height,
    inner,
  };

  const built: Built[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const interval = ids[index];
    const finest = index === 0;
    const coarsest = index === ids.length - 1;
    let candles: TravelCandle[];
    let covered: Set<number>;
    let straddler: number | null;
    let split: boolean;
    let derivedOnly = false;
    if (finest || coarsest) {
      candles = lists.get(interval)!;
      const finer = finest ? null : built[index - 1].candles;
      const classified = classify(candles, finer, interval);
      covered = classified.covered;
      straddler = classified.straddler;
      split = classified.split;
    } else {
      const finer = built[index - 1].candles;
      const made = buildIntermediate(interval, finer, input.stored?.[interval], input.now, derive.has(interval));
      candles = made.candles;
      covered = made.covered;
      straddler = made.straddler;
      split = true;
      derivedOnly = made.derivedOnly;
      lists.set(interval, candles);
    }
    const end = interval === input.from ? 'origin' : interval === input.to ? 'target' : 'mid';
    const mapped = layoutFor(base, interval, end);
    const previous = index === 0 ? periodLength(interval) : periodLength(ids[index - 1]);
    built.push({
      interval,
      candles,
      covered,
      straddler,
      split,
      derivedOnly,
      centres: centresOf(candles, input.width, input.ratio, slot),
      layout: mapped.layout,
      domain: mapped.domain,
      birthSigma: finest ? Number.POSITIVE_INFINITY : MIN_SCALE * (periodLength(interval) / previous),
    });
  }

  if (!othersOffScreen(base, built, input.from, input.to)) return { ok: false, reason: 'edge' };

  const k = periodLength(ids[ids.length - 1]) / periodLength(ids[0]);
  const duration = travelDuration(k);
  const ranges = built.map(step => aliveRange(base, slot / periodLength(step.interval)));
  const detail = input.detail !== false;
  const extras = detail ? ranges.flatMap(range => [range.q0, range.q1]) : [];
  if (detail) for (const step of built) {
    if (!step.split) continue;
    const qB = qAtSigma(base, slot / periodLength(step.interval), step.birthSigma);
    if (qB > 0 && qB < 1) extras.push(qB);
    const q1 = qAtSigma(base, slot / periodLength(step.interval), 1);
    if (q1 > 0 && q1 < 1) extras.push(q1);
  }
  const qs = knotQs(k, extras);
  const ps = qs.map(q => progressAtQ(q));

  const steps: StepPlan[] = built.map((step, index) => {
    const alive = ranges[index];
    const qFirst = !detail || step.interval === input.from ? alive.q0 : firstVisibleQ(base, step, alive);
    const pFirst = progressAtQ(qFirst);
    const pLast = progressAtQ(alive.q1);
    const stepV = slot / periodLength(step.interval);
    const inputRange: number[] = [];
    const scaleX: number[] = [];
    const translateX: number[] = [];
    const scaleY: number[] = [];
    const translateY: number[] = [];
    const kept: number[] = [];
    for (let knot = 0; knot < qs.length; knot += 1) {
      const q = qs[knot];
      if (q < alive.q0 - 1e-8 || q > alive.q1 + 1e-8) continue;
      const sigma = sigmaOf(base, stepV, q);
      const scale = Math.min(sigma, 1);
      const y = yScale(base, step.layout, q);
      const p = ps[knot];
      if (inputRange.length > 0 && p <= inputRange[inputRange.length - 1]) continue;
      inputRange.push(p);
      kept.push(knot);
      scaleX.push(scale);
      translateX.push((base.xStar / base.ratio - base.width / 2) * (1 - scale));
      scaleY.push(y.scaleY);
      translateY.push(y.translateY);
    }
    const shifts = new Map<number, number[]>();
    if (detail && index > 0) {
      for (const candle of step.candles) {
        shifts.set(
          candle.openTime,
          kept.map(knot => candleTranslate(base, step, candle.openTime, qs[knot])),
        );
      }
    }
    const layer = windowStops(progressAtQ(alive.q0), pLast);
    let coveredStops: OpacityStops | null = null;
    let readoutFrom = progressAtQ(alive.q0);
    if (step.split) {
      const qB = Math.min(1, Math.max(0, qAtSigma(base, stepV, step.birthSigma)));
      const increasing = sigmaOf(base, stepV, 1) >= sigmaOf(base, stepV, 0);
      const c0 = increasing ? alive.q0 : Math.max(alive.q0, qB);
      const c1 = increasing ? Math.min(alive.q1, qB) : alive.q1;
      readoutFrom = progressAtQ(c0);
      coveredStops = c0 <= c1 + 1e-8 ? windowStops(progressAtQ(c0), progressAtQ(c1)) : { input: [0, 1], output: [0, 0] };
    }
    return {
      interval: step.interval,
      candles: step.candles,
      covered: step.covered,
      straddler: step.straddler,
      split: step.split,
      perCandle: index > 0,
      derivedOnly: step.derivedOnly,
      domain: step.domain,
      centres: step.centres,
      birthSigma: step.birthSigma,
      qAlive0: alive.q0,
      qAlive1: alive.q1,
      forwardThreshold: Math.max(1 - pLast, 0.01),
      reverseThreshold: Math.max(pFirst, 0.0001),
      mountAt: Math.max(0, timeOfQ(qFirst, duration) - leadMs),
      input: inputRange,
      scaleX,
      translateX,
      scaleY,
      translateY,
      shifts,
      layer,
      coveredStops,
      readout: windowStops(readoutFrom, pLast),
    };
  });

  const plan: TravelPlan = {
    from: input.from,
    to: input.to,
    zoomOut,
    k,
    duration,
    xStar,
    tStar,
    v0,
    v1,
    anchor,
    span0: spanOrigin.span,
    span1: spanTarget.span,
    slot,
    ratio: input.ratio,
    width: input.width,
    height: input.height,
    inner,
    pEnd: springPosition(1),
    steps,
    peakViews: 0,
  };
  plan.peakViews = peakViews(steps, duration);
  return { ok: true, plan };
}

export function planTravel(
  input: TravelInput,
): { ok: true; plan: TravelPlan } | { ok: false; reason: TravelRefusal } {
  if (input.reduceMotion) return { ok: false, reason: 'motion' };
  if (!input.atRest) return { ok: false, reason: 'rest' };
  if (!input.originReady || !input.targetReady) return { ok: false, reason: 'ready' };
  if (input.elapsedMs > TRAVEL_COMMIT_MS) return { ok: false, reason: 'late' };
  const origin = sortCandles(input.origin);
  const target = sortCandles(input.target);
  if (origin.length === 0 || target.length === 0) return { ok: false, reason: 'empty' };
  if (!(seriesSpan(origin).span > 0) || !(seriesSpan(target).span > 0)) return { ok: false, reason: 'flat' };
  if (!(input.width > 0) || !(input.height > PLOT_PAD * 2) || !(input.ratio > 0)) {
    return { ok: false, reason: 'flat' };
  }

  const ids = ladderSteps(input.from, input.to);
  const full = assemble(input, origin, target, ids, STAGING_LEAD_MS, new Set());
  if (!full.ok) return full;
  if (full.plan.peakViews * UPDATE_US <= UPDATE_BUDGET_US) return full;

  const staged = assemble(input, origin, target, ids, STAGING_LEAD_TIGHT_MS, new Set());
  if (!staged.ok) return staged;
  if (staged.plan.peakViews * UPDATE_US <= UPDATE_BUDGET_US) return staged;

  const light = assemble(input, origin, target, ids, STAGING_LEAD_TIGHT_MS, furthestIntermediates(ids));
  if (!light.ok) return light;
  if (light.plan.peakViews * UPDATE_US <= UPDATE_BUDGET_US) return light;
  return { ok: false, reason: 'budget' };
}

export function labelStops(plan: TravelPlan): OpacityStops {
  const at = plan.pEnd;
  return { input: [0, at, at, 1], output: [0, 0, 1, 1] };
}

function snap(value: number, ratio: number): number {
  return Math.round(value * ratio) / ratio;
}

function directionOf(open: number, close: number): CandlePlacement['direction'] {
  if (close > open) return 'up';
  if (close < open) return 'down';
  return 'flat';
}

/** Rest-width placement in a fixed price domain. End steps keep `candleLayout`. */
export function placeCandles(
  candles: readonly TravelCandle[],
  size: { width: number; height: number; ratio: number },
  domain: PriceDomain,
): CandlePlacement[] {
  const { width, height, ratio } = size;
  if (width <= 0 || height <= 0 || ratio <= 0 || candles.length === 0) return [];
  const { slot, gap } = candleMetrics(width, ratio);
  const leading = width * ratio - candles.length * slot;
  const span = domain.high - domain.low;
  const inner = height - PLOT_PAD * 2;
  if (!(span > 0) || !(inner > 0)) return [];
  const y = (price: number) => ((domain.high - price) / span) * inner + PLOT_PAD;
  return candles.map((candle, index) => {
    const x = (leading + index * slot + gap) / ratio;
    const direction = directionOf(candle.open, candle.close);
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

/** Analytic σ of a step. 1 at that step's own rest scale. */
export function stepSigma(plan: TravelPlan, stepIndex: number, q: number): number {
  const step = plan.steps[stepIndex];
  const stepV = plan.slot / periodLength(step.interval);
  const speed = q <= 0 ? plan.v0 : q >= 1 ? plan.v1 : Math.exp((1 - q) * Math.log(plan.v0) + q * Math.log(plan.v1));
  return speed / stepV;
}

export function markCentre(plan: TravelPlan, index: number, openTime: number, q: number): number {
  const step = plan.steps[index];
  const slotCentre = step.centres.get(openTime);
  if (slotCentre == null) return 0;
  const sigma = stepSigma(plan, index, q);
  if (step.interval !== '1M' || sigma < 1) return plan.xStar + (slotCentre - plan.xStar) * sigma;
  const base: CameraBase = {
    xStar: plan.xStar,
    tStar: plan.tStar,
    v0: plan.v0,
    v1: plan.v1,
    logV0: Math.log(plan.v0),
    logV1: Math.log(plan.v1),
    anchor: 0,
    span0: 1,
    span1: 1,
    yAnchor0: 0,
    yAnchor1: 0,
    slot: plan.slot,
    ratio: 1,
    width: 0,
    height: 0,
    inner: 0,
  };
  return monthCentre(base, plan.slot / periodLength('1M'), slotCentre, openTime, q);
}

export function markRight(plan: TravelPlan, index: number, openTime: number, q: number): number {
  const sigma = stepSigma(plan, index, q);
  if (sigma <= 1) {
    const centre = plan.steps[index].centres.get(openTime) ?? 0;
    const restRight = centre + plan.slot / 2;
    return plan.xStar + (restRight - plan.xStar) * sigma;
  }
  return markCentre(plan, index, openTime, q) + plan.slot / 2;
}
