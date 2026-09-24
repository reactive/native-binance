import { INTERVALS, type CandleInterval } from '@/resources/Candle';

import { candleLayout } from './candleLayout';
import { intervalMs, periodEnd, periodStart } from './chartMotion';
import {
  cameraSample,
  candleShift,
  compressedBodyRight,
  handoffQ,
  neighbourIntervals,
  planTravel,
  sineInOut,
  springPosition,
  travelDuration,
  travelPair,
  travelSpring,
  type TravelCandle,
  type TravelInput,
  type TravelPlan,
} from './chartTravel';

const WIDTH = 360;
const HEIGHT = 521;
const RATIO = 3.75;
const NOW = Date.parse('2026-09-23T15:04:30.000Z');
const DAY = 24 * 60 * 60_000;

function build(interval: CandleInterval, count = 60, now = NOW): TravelCandle[] {
  const newest = periodStart(now, interval);
  const opens: number[] = [];
  if (interval === '1M') {
    let cursor = newest;
    for (let i = 0; i < count; i += 1) {
      opens.push(cursor);
      const date = new Date(cursor);
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
    }
    opens.reverse();
  } else {
    const step = intervalMs(interval);
    for (let i = count - 1; i >= 0; i -= 1) opens.push(newest - i * step);
  }
  return opens.map((openTime, index) => {
    const close = 100 + (index % 5);
    const open = index % 2 === 0 ? close - 2 : close + 2;
    return {
      openTime,
      open,
      high: Math.max(open, close) + 8,
      low: Math.min(open, close) - 8,
      close,
    };
  });
}

function input(
  from: CandleInterval,
  to: CandleInterval,
  extra: Partial<TravelInput> = {},
): TravelInput {
  return {
    from,
    to,
    origin: build(from),
    target: build(to),
    now: NOW,
    reduceMotion: false,
    atRest: true,
    originReady: true,
    targetReady: true,
    elapsedMs: 0,
    width: WIDTH,
    height: HEIGHT,
    ratio: RATIO,
    ...extra,
  };
}

function assume(from: CandleInterval, to: CandleInterval, extra?: Partial<TravelInput>): TravelPlan {
  const decided = planTravel(input(from, to, extra));
  if (!decided.ok) throw new Error(`${from}->${to} ${decided.reason}`);
  return decided.plan;
}

function oracle(finer: readonly TravelCandle[], coarser: readonly TravelCandle[], interval: CandleInterval, now: number) {
  const start = finer[0].openTime;
  let inside = 0;
  let straddler: number | null = null;
  for (const candle of coarser) {
    const end = periodEnd(candle.openTime, interval);
    if (candle.openTime >= start && end <= now) inside += 1;
    if (candle.openTime < start && end > start) straddler = candle.openTime;
  }
  return { inside, straddler };
}

const PAIRS: ReadonlyArray<readonly [CandleInterval, CandleInterval]> = [
  ['15m', '1h'],
  ['1h', '15m'],
  ['1h', '4h'],
  ['4h', '1h'],
  ['4h', '1d'],
  ['1d', '4h'],
  ['1d', '1w'],
  ['1d', '1M'],
  ['1w', '1d'],
  ['1M', '1d'],
];

it('travels the nesting pairs, including a day and a month', () => {
  const values = INTERVALS.map(item => item.value);
  expect(values.length * (values.length - 1)).toBe(42);
  const traveled: string[] = [];
  for (const from of values) {
    for (const to of values) {
      if (from === to) continue;
      const decided = planTravel(input(from, to));
      if (decided.ok) traveled.push(`${from}->${to}`);
      else if (travelPair(from, to)) throw new Error(`${from}->${to} ${decided.reason}`);
      else expect(decided.reason).toBe('pair');
    }
  }
  expect(traveled).toEqual(PAIRS.map(([from, to]) => `${from}->${to}`));
  expect(travelPair('1m', '1M')).toBeNull();
  expect(travelPair('1M', '1m')).toBeNull();
  expect(travelPair('1w', '1M')).toBeNull();
  expect(neighbourIntervals('1m')).toEqual(['15m']);
  expect(neighbourIntervals('1M')).toEqual(['1w']);
  expect(neighbourIntervals('1w')).toEqual(['1d', '1M']);
});

it('keeps weeks on Monday and months on the calendar', () => {
  const monday = Date.parse('2026-12-28T00:00:00.000Z');
  const next = Date.parse('2027-01-04T00:00:00.000Z');
  expect(periodStart(Date.parse('2026-12-31T12:00:00.000Z'), '1w')).toBe(monday);
  expect(periodStart(Date.parse('2027-01-01T00:00:00.000Z'), '1w')).toBe(monday);
  expect(periodStart(monday, '1w')).toBe(monday);
  expect(periodStart(Date.parse('2026-12-27T23:00:00.000Z'), '1w')).toBe(
    Date.parse('2026-12-21T00:00:00.000Z'),
  );
  expect(periodEnd(monday, '1w')).toBe(next);
  const feb = Date.parse('2024-02-01T00:00:00.000Z');
  expect(periodEnd(feb, '1M')).toBe(Date.parse('2024-03-01T00:00:00.000Z'));
  expect(periodEnd(feb, '1M') - feb).toBe(29 * DAY);
  expect(periodEnd(Date.parse('2024-03-01T00:00:00.000Z'), '1M') - Date.parse('2024-03-01T00:00:00.000Z')).toBe(
    31 * DAY,
  );
  expect(periodStart(Date.parse('2024-02-29T12:00:00.000Z'), '1M')).toBe(feb);
  const year = Date.parse('2027-01-01T12:00:00.000Z');
  expect(assume('1d', '1w', { now: year, origin: build('1d', 60, year), target: build('1w', 60, year) }).k).toBe(
    7,
  );
  const september = assume('1d', '1M');
  expect(september.k).toBe(30);
  expect(september.duration).toBe(travelDuration(30));
  expect(assume('1M', '1d').k).toBe(30);
  const leap = Date.parse('2024-02-29T12:00:00.000Z');
  expect(assume('1d', '1M', { now: leap, origin: build('1d', 60, leap), target: build('1M', 60, leap) }).k).toBe(
    29,
  );
  const march = Date.parse('2026-03-15T12:00:00.000Z');
  expect(assume('1M', '1d', { now: march, origin: build('1M', 60, march), target: build('1d', 60, march) }).k).toBe(
    31,
  );
});

it('classifies the fully-inside set and the straddler', () => {
  for (const [from, to] of PAIRS) {
    const plan = assume(from, to);
    const finer = plan.zoomOut ? plan.origin : plan.target;
    const coarser = plan.zoomOut ? plan.target : plan.origin;
    const coarserInterval = plan.zoomOut ? plan.to : plan.from;
    const expected = oracle(finer, coarser, coarserInterval, NOW);
    expect(plan.fullyInside).toBe(expected.inside);
    expect(plan.straddler).toBe(expected.straddler);
    const dayMonth = (from === '1d' && to === '1M') || (from === '1M' && to === '1d');
    expect(plan.fullyInside).toBeGreaterThanOrEqual(dayMonth ? 1 : 4);
  }
  expect(assume('1d', '1M').fullyInside).toBe(1);
  const zoomOut = assume('15m', '1h');
  expect(zoomOut.fullyInside).toBe(14);
  expect(zoomOut.straddler).toBe(Date.parse('2026-09-23T00:00:00.000Z'));
});

it('matches rest rectangles at both ends and the 40% handoff', () => {
  for (const [from, to] of PAIRS) {
    const plan = assume(from, to);
    const finerRole = 'finer' as const;
    const ends: Array<{ q: number; role: 'finer' | 'coarser'; candles: readonly TravelCandle[] }> = plan.zoomOut ?
      [
        { q: 0, role: 'finer', candles: plan.origin },
        { q: 1, role: 'coarser', candles: plan.target },
      ]
    : [
        { q: 0, role: 'coarser', candles: plan.origin },
        { q: 1, role: 'finer', candles: plan.target },
      ];
    for (const end of ends) {
      const camera = cameraSample(plan, end.q, end.role);
      expect(camera.scaleX).toBeCloseTo(1, 6);
      expect(camera.translateX).toBeCloseTo(0, 6);
      expect(camera.scaleY).toBeCloseTo(1, 6);
      expect(camera.translateY).toBeCloseTo(0, 6);
      const placed = candleLayout(end.candles, { width: WIDTH, height: HEIGHT, ratio: RATIO });
      placed.forEach((mark, index) => {
        const centre = plan.centres.get(end.candles[index].openTime);
        const shift = end.role === 'coarser' && centre != null ? candleShift(plan, centre, end.q) / RATIO : 0;
        const x = WIDTH / 2 + (mark.x + shift - WIDTH / 2) * camera.scaleX + camera.translateX;
        const y = HEIGHT / 2 + (mark.bodyTop - HEIGHT / 2) * camera.scaleY + camera.translateY;
        const wick = HEIGHT / 2 + (mark.wickTop - HEIGHT / 2) * camera.scaleY + camera.translateY;
        expect(x).toBeCloseTo(mark.x, 6);
        expect(y).toBeCloseTo(mark.bodyTop, 6);
        expect(wick).toBeCloseTo(mark.wickTop, 6);
        expect(mark.bodyHeight * camera.scaleY).toBeCloseTo(mark.bodyHeight, 6);
        expect(shift).toBeCloseTo(0, 6);
      });
    }
    expect(cameraSample(plan, plan.qH, finerRole).scaleX).toBeCloseTo(0.4, 6);
    const coarser = plan.zoomOut ? plan.target : plan.origin;
    for (const candle of coarser) {
      if (plan.covered.has(candle.openTime)) continue;
      const centre = plan.centres.get(candle.openTime);
      expect(centre).toBeDefined();
      expect(compressedBodyRight(centre ?? 0, plan.xStar, plan.k, plan.slot)).toBeLessThan(0);
    }
    const visible = (p: number) => (plan.zoomOut ? p <= plan.pH + 1e-9 : p >= plan.pH - 1e-9);
    let minScale = 1;
    for (let i = 0; i < plan.knots.length - 1; i += 1) {
      const left = plan.knots[i];
      const right = plan.knots[i + 1];
      const steps = 8;
      for (let step = 0; step <= steps; step += 1) {
        const p = left.p + ((right.p - left.p) * step) / steps;
        if (!visible(p)) continue;
        const span = right.p - left.p;
        const t = span === 0 ? 0 : (p - left.p) / span;
        const scale = left.s + (right.s - left.s) * t;
        if (scale < minScale) minScale = scale;
      }
    }
    expect(minScale).toBeGreaterThanOrEqual(0.4 - 1e-9);
  }
});

it('uses the sine table, the spring, and the durations', () => {
  expect(travelDuration(4)).toBe(340);
  expect(travelDuration(6)).toBe(380);
  expect(travelDuration(7)).toBe(400);
  expect(travelDuration(30)).toBe(540);
  expect(travelDuration(31)).toBe(550);
  expect(handoffQ(4, true)).toBeCloseTo(0.661, 3);
  expect(handoffQ(4, false)).toBeCloseTo(0.339, 3);
  expect(sineInOut(0)).toBe(0);
  expect(sineInOut(1)).toBeCloseTo(1, 12);
  expect(springPosition(0)).toBe(0);
  expect(springPosition(1)).toBeCloseTo(0.99, 2);
  const at340 = travelSpring(340, false);
  expect(at340.stiffness).toBeCloseTo(381, 0);
  expect(at340.damping).toBeCloseTo(39, 0);
  expect(at340.restDisplacementThreshold).toBe(0.01);
  expect(travelSpring(340, true).restDisplacementThreshold).toBe(0.0001);
  const plan = assume('15m', '1h');
  expect(plan.knots).toHaveLength(33);
  for (let i = 1; i < plan.knots.length; i += 1) {
    expect(plan.knots[i].p).toBeGreaterThan(plan.knots[i - 1].p);
    expect(plan.knots[i].q).toBeCloseTo(sineInOut(i / 32), 12);
  }
});

it('falls back when a gate fails', () => {
  expect(planTravel(input('15m', '1h', { targetReady: false })).ok).toBe(false);
  expect(planTravel(input('15m', '1h', { originReady: false })).ok).toBe(false);
  expect(planTravel(input('15m', '1h', { reduceMotion: true })).ok).toBe(false);
  expect(planTravel(input('15m', '1h', { atRest: false })).ok).toBe(false);
  expect(planTravel(input('15m', '1h', { elapsedMs: 101 })).ok).toBe(false);
  expect(planTravel(input('15m', '1h', { origin: [] })).ok).toBe(false);
  const flat = build('15m').map(candle => ({ ...candle, open: 1, high: 1, low: 1, close: 1 }));
  expect(planTravel(input('15m', '1h', { origin: flat })).ok).toBe(false);
  const short = build('15m').slice(-8);
  const inside = planTravel(input('15m', '1h', { origin: short }));
  expect(inside.ok).toBe(false);
  if (!inside.ok) expect(inside.reason).toBe('inside');
  const edgeOrigin = build('15m').slice(40);
  const edge = planTravel(input('15m', '1h', { origin: edgeOrigin }));
  expect(edge.ok).toBe(false);
  if (!edge.ok) expect(edge.reason).toBe('edge');
  expect(planTravel(input('1m', '15m')).ok).toBe(false);
  expect(planTravel(input('1w', '1M')).ok).toBe(false);
  expect(planTravel(input('15m', '4h')).ok).toBe(false);
});
