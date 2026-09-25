import { Animated } from 'react-native';

import { INTERVALS, type CandleInterval } from '@/resources/Candle';

import { periodEnd, periodStart } from './chartMotion';
import {
  LADDER,
  MEAN_MONTH_DAYS,
  ladderSteps,
  markCentre,
  markRight,
  periodLength,
  UPDATE_BUDGET_US,
  UPDATE_US,
  planTravel,
  progressAtQ,
  rowFetchOrder,
  springPosition,
  stepPeriodEnd,
  stepPeriodStart,
  stepSigma,
  timeOfQ,
  travelDuration,
  travelSpring,
  type StepId,
  type TravelCandle,
  type TravelInput,
  type TravelPlan,
} from './chartTravel';

const WIDTH = 360;
const HEIGHT = 521;
const RATIO = 3.75;
const NOW = Date.parse('2026-09-23T15:04:30.000Z');
const DAY = 24 * 60 * 60_000;

const PAIRS: ReadonlyArray<readonly [CandleInterval, CandleInterval]> = INTERVALS.flatMap((from, index) =>
  INTERVALS.slice(index + 1).map(to => [from.value, to.value] as const),
);

function build(interval: StepId, count = 60, now = NOW, wave = 1): TravelCandle[] {
  const newest = stepPeriodStart(now, interval);
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
    const step = periodLength(interval);
    for (let i = count - 1; i >= 0; i -= 1) opens.push(newest - i * step);
  }
  return opens.map((openTime, index) => {
    const close = 100 + wave * ((index % 5) + 1);
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

function input(from: CandleInterval, to: CandleInterval, extra: Partial<TravelInput> = {}): TravelInput {
  return {
    from,
    to,
    origin: build(from),
    target: build(to, 60, NOW, 3),
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

function aggregate(group: readonly TravelCandle[], openTime: number): TravelCandle {
  let high = group[0].high;
  let low = group[0].low;
  for (const candle of group) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  return { openTime, open: group[0].open, high, low, close: group[group.length - 1].close };
}

it('travels every ordered pair, including 1W, and keeps 1m distinct from 1M', () => {
  const values = INTERVALS.map(item => item.value);
  expect(values.length * (values.length - 1)).toBe(42);
  expect(values).toContain('1m');
  expect(values).toContain('1M');
  const traveled: string[] = [];
  for (const from of values) {
    for (const to of values) {
      if (from === to) continue;
      const decided = planTravel(input(from, to));
      if (!decided.ok) throw new Error(`${from}->${to} ${decided.reason}`);
      traveled.push(`${from}->${to}`);
      expect(decided.plan.steps.map(step => step.interval)).toEqual(ladderSteps(from, to));
    }
  }
  expect(traveled).toHaveLength(42);
  const month = ladderSteps('1m', '1M');
  expect(month[0]).toBe('1m');
  expect(month[month.length - 1]).toBe('1M');
  expect(month.indexOf('1m')).not.toBe(month.indexOf('1M'));
  expect(assume('1w', '1M').steps.map(step => step.interval)).toEqual(['1w', '1M']);
  expect(assume('1M', '1w').zoomOut).toBe(false);
  expect(rowFetchOrder('1h')).toEqual(['15m', '4h', '1m', '1d', '1w', '1M']);
  expect(rowFetchOrder('1M')).toEqual(['1w', '1d', '4h', '1h', '15m', '1m']);
});

it('keeps weeks on Monday and months on the mean-month axis', () => {
  const monday = Date.parse('2026-12-28T00:00:00.000Z');
  expect(periodStart(Date.parse('2026-12-31T12:00:00.000Z'), '1w')).toBe(monday);
  expect(periodStart(Date.parse('2027-01-01T00:00:00.000Z'), '1w')).toBe(monday);
  expect(periodEnd(monday, '1w')).toBe(Date.parse('2027-01-04T00:00:00.000Z'));
  const feb = Date.parse('2024-02-01T00:00:00.000Z');
  expect(periodEnd(feb, '1M') - feb).toBe(29 * DAY);
  const leap = Date.parse('2024-02-29T12:00:00.000Z');
  const plan = assume('1d', '1M', { now: leap, origin: build('1d', 60, leap), target: build('1M', 60, leap) });
  expect(plan.k).toBeCloseTo(MEAN_MONTH_DAYS, 6);
  expect(plan.duration).toBe(540);
  expect(assume('1w', '1M').k).toBeCloseTo(MEAN_MONTH_DAYS / 7, 6);
  expect(assume('1w', '1M').duration).toBe(350);
  expect(assume('15m', '1h').duration).toBe(340);
  expect(assume('4h', '1d').duration).toBe(380);
  expect(assume('1d', '1w').duration).toBe(400);
  expect(assume('1m', '1M').duration).toBe(900);
  expect(assume('1m', '1d').duration).toBe(900);
});

it('derives covered candles, partial 5m buckets, and a forming straddler', () => {
  const minutes = build('1m');
  const plan = assume('1m', '15m', { origin: minutes });
  const five = plan.steps[1];
  expect(five.interval).toBe('5m');
  expect(five.derivedOnly).toBe(true);
  expect(five.candles.length === 12 || five.candles.length === 13).toBe(true);
  const misaligned = Date.parse('2026-09-23T15:07:30.000Z');
  const shortWindow = build('1m', 60, misaligned);
  const partial = assume('1m', '15m', { now: misaligned, origin: shortWindow, target: build('15m', 60, misaligned) });
  const buckets = partial.steps[1].candles;
  expect(buckets.length).toBe(13);
  const firstBucket = buckets[0].openTime;
  const inside = shortWindow.filter(candle => candle.openTime >= firstBucket && candle.openTime < stepPeriodEnd(firstBucket, '5m'));
  expect(inside.length).toBeLessThan(5);
  expect(buckets[0].open).toBe(inside[0].open);
  expect(buckets[0].close).toBe(inside[inside.length - 1].close);

  const hour = assume('1m', '4h');
  const fifteen = hour.steps.find(step => step.interval === '15m');
  expect(fifteen).toBeDefined();
  const full = fifteen!.candles.find(candle => fifteen!.covered.has(candle.openTime) && candle.openTime !== fifteen!.straddler);
  const group = minutes.filter(
    candle => full && candle.openTime >= full.openTime && candle.openTime < stepPeriodEnd(full.openTime, '15m'),
  );
  if (full && group.length === 15) {
    const expected = aggregate(group, full.openTime);
    expect(full).toEqual(expected);
  }

  const now = Date.parse('2026-09-23T15:40:00.000Z');
  const brief = build('15m', 2, now);
  const forming = assume('15m', '4h', {
    now,
    origin: brief,
    target: build('4h', 1, now),
    stored: { '1h': { candles: build('1h', 1, now) } },
  });
  const mid = forming.steps.find(step => step.interval === '1h')!;
  expect(mid.straddler).not.toBeNull();
  const straddler = mid.candles.find(candle => candle.openTime === mid.straddler)!;
  expect(stepPeriodEnd(straddler.openTime, '1h')).toBeGreaterThan(now);
  const partialGroup = brief.filter(
    candle => stepPeriodEnd(candle.openTime, '15m') > straddler.openTime && candle.openTime < stepPeriodEnd(straddler.openTime, '1h'),
  );
  expect(partialGroup.length).toBeGreaterThan(0);
  expect(straddler.open).toBe(partialGroup[0].open);
  expect(straddler.high).toBe(Math.max(...partialGroup.map(candle => candle.high)));
  const storedOpen = build('1h', 60, now).find(candle => candle.openTime === straddler.openTime)?.open;
  expect(straddler.open).not.toBe(storedOpen);
});

it('uses a stale but usable list and derives a step whose list is too old', () => {
  const now = NOW;
  const minutes = build('1m', 60, now);
  const hours = build('1h', 60, now);
  const withList = assume('1m', '4h', { origin: minutes, stored: { '1h': { candles: hours } } });
  const hour = withList.steps.find(step => step.interval === '1h')!;
  if (!hour.derivedOnly) {
    const outside = hour.candles.filter(candle => !hour.covered.has(candle.openTime));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside[0].open).toBe(hours.find(candle => candle.openTime === outside[0].openTime)?.open);
  }
  const gate = hour.straddler ?? hour.candles.find(candle => hour.covered.has(candle.openTime))?.openTime ?? minutes[0].openTime;
  const stale = hours.filter(candle => candle.openTime < gate);
  const without = assume('1m', '4h', { origin: minutes, stored: { '1h': { candles: stale } } });
  const derived = without.steps.find(step => step.interval === '1h')!;
  expect(derived.derivedOnly).toBe(true);
  expect(derived.candles.every(candle => derived.covered.has(candle.openTime))).toBe(true);
  expect(without.steps.map(step => step.interval)).toEqual(['1m', '5m', '15m', '1h', '4h']);
});

it('matches rest frames, 40% handoffs, slot months, and non-overlapping candles', () => {
  for (const [from, to] of PAIRS) {
    for (const pair of [
      [from, to],
      [to, from],
    ] as const) {
      const plan = assume(pair[0], pair[1]);
      const newestLeft = WIDTH * RATIO - plan.slot;
      expect(plan.xStar).toBeGreaterThanOrEqual(newestLeft - 1e-6);
      expect(plan.xStar).toBeLessThanOrEqual(newestLeft + plan.slot + 1e-6);
      for (const end of [0, 1]) {
        const q = end === 0 ? 0 : 1;
        const interval = end === 0 ? plan.from : plan.to;
        const index = plan.steps.findIndex(step => step.interval === interval);
        const camera = plan.steps[index];
        const at = end === 0 ? 0 : camera.input.length - 1;
        expect(camera.scaleX[at]).toBeCloseTo(1, 6);
        expect(camera.translateX[at]).toBeCloseTo(0, 6);
        expect(camera.scaleY[at]).toBeCloseTo(1, 6);
        expect(camera.translateY[at]).toBeCloseTo(0, 6);
        for (const candle of camera.candles) {
          const shift = camera.shifts.get(candle.openTime)?.[at] ?? 0;
          expect(shift).toBeCloseTo(0, 4);
        }
        for (const other of plan.steps) {
          if (other.interval === interval) continue;
          for (const candle of other.candles) {
            const sigma = stepSigma(plan, plan.steps.indexOf(other), q);
            const drawn = sigma >= 0.4 - 1e-8 && (!other.split || !other.covered.has(candle.openTime) || sigma <= other.birthSigma + 1e-8);
            if (!drawn) continue;
            expect(markRight(plan, plan.steps.indexOf(other), candle.openTime, q)).toBeLessThan(1e-3);
          }
        }
      }
      expect(stepSigma(plan, 0, plan.zoomOut ? plan.steps[0].qAlive1 : plan.steps[0].qAlive0)).toBeCloseTo(0.4, 5);
      for (let index = 1; index < plan.steps.length; index += 1) {
        const step = plan.steps[index];
        const centres = step.candles.map(candle => markCentre(plan, index, candle.openTime, 0.5));
        for (let candle = 1; candle < centres.length; candle += 1) {
          if (stepSigma(plan, index, 0.5) < 1) continue;
          expect(Math.abs(centres[candle] - centres[candle - 1])).toBeGreaterThanOrEqual(plan.slot - 1e-4);
        }
      }
    }
  }
  const month = assume('1w', '1M');
  const months = month.steps[1];
  months.candles.forEach(candle => {
    expect(markCentre(month, 1, candle.openTime, 1)).toBeCloseTo(months.centres.get(candle.openTime) ?? 0, 4);
  });
});

it('keeps a straddling week inside its months and off the week rest chart', () => {
  let worst = 0;
  let refused = 0;
  let shown = 0;
  const start = Date.parse('2020-01-01T00:00:00.000Z');
  const end = Date.parse('2031-12-31T00:00:00.000Z');
  for (let day = start; day <= end; day += DAY) {
    const weeks = build('1w', 60, day);
    const months = build('1M', 60, day);
    const zoomOut = planTravel(input('1w', '1M', { now: day, origin: weeks, target: months, detail: false }));
    const zoomIn = planTravel(input('1M', '1w', { now: day, origin: months, target: weeks, detail: false }));
    if (!zoomOut.ok || !zoomIn.ok) {
      refused += 1;
      continue;
    }
    const plan = zoomOut.plan;
    const week = plan.steps[0];
    const month = plan.steps[1];
    const qH = week.qAlive1;
    if (Math.abs(stepSigma(plan, 0, qH) - 0.4) > 1e-4) refused += 1;
    for (const candle of month.candles) {
      const sigma = stepSigma(plan, 1, 0);
      const drawn =
        sigma >= 0.4 - 1e-8 && (!month.covered.has(candle.openTime) || sigma <= month.birthSigma + 1e-6);
      if (!drawn) continue;
      if (markRight(plan, 1, candle.openTime, 0) >= 0) shown += 1;
    }
    for (const candle of week.candles) {
      const weekEnd = stepPeriodEnd(candle.openTime, '1w');
      const partners = month.candles.filter(
        item => item.openTime < weekEnd && stepPeriodEnd(item.openTime, '1M') > candle.openTime,
      );
      const weekX = markCentre(plan, 0, candle.openTime, qH);
      for (const partner of partners) {
        const distance = Math.abs(weekX - markCentre(plan, 1, partner.openTime, qH));
        if (distance > worst) worst = distance;
      }
    }
  }
  expect(refused).toBe(0);
  expect(shown).toBe(0);
  expect(worst).toBeGreaterThan(16);
  expect(worst).toBeLessThanOrEqual(24.05);
});

function opacityAt(stops: { input: number[]; output: number[] }, progress: number): number {
  const value = new Animated.Value(progress);
  const opacity = value.interpolate({
    inputRange: stops.input,
    outputRange: stops.output,
    extrapolate: 'clamp',
  });
  return (opacity as unknown as { __getValue(): number }).__getValue();
}

it('keeps the destination layer and readout visible when the spring rests', () => {
  for (const [from, to] of [
    ['1w', '1M'],
    ['1M', '1w'],
    ['1m', '1d'],
  ] as const) {
    const plan = assume(from, to);
    const destination = plan.steps.find(step => step.interval === to)!;
    expect(destination.qAlive1).toBe(1);
    for (const progress of [progressAtQ(1), 1]) {
      expect(opacityAt(destination.layer, progress)).toBe(1);
      expect(opacityAt(destination.readout, progress)).toBe(1);
    }
  }
  const zoomIn = assume('1M', '1w');
  const origin = zoomIn.steps.find(step => step.interval === '1M')!;
  expect(origin.qAlive1).toBe(1);
  expect(opacityAt(origin.layer, 1)).toBe(1);
  expect(opacityAt(origin.readout, 1)).toBe(1);
  const dying = assume('1w', '1M').steps.find(step => step.interval === '1w')!;
  expect(dying.qAlive1).toBeLessThan(1);
  expect(opacityAt(dying.layer, 1)).toBe(0);
  expect(opacityAt(dying.readout, 1)).toBe(0);
});

it('uses the sine table, the spring, and early-rest thresholds', () => {
  expect(travelDuration(4)).toBe(340);
  expect(travelDuration(1440)).toBe(900);
  expect(progressAtQ(0)).toBe(0);
  expect(progressAtQ(1)).toBeCloseTo(springPosition(1), 6);
  expect(springPosition(1)).toBeCloseTo(0.99, 2);
  const at340 = travelSpring(340, 0.01);
  expect(at340.stiffness).toBeCloseTo(381, 0);
  expect(at340.restDisplacementThreshold).toBe(0.01);
  const plan = assume('1m', '1M');
  for (const step of plan.steps) {
    expect(step.forwardThreshold).toBeGreaterThanOrEqual(0.01);
    expect(step.reverseThreshold).toBeGreaterThanOrEqual(0.0001);
  }
  const origin = plan.steps[0];
  const target = plan.steps[plan.steps.length - 1];
  expect(origin.reverseThreshold).toBe(0.0001);
  expect(target.forwardThreshold).toBeCloseTo(0.01, 4);
  expect(timeOfQ(origin.qAlive1, plan.duration)).toBeCloseTo(170, 0);
  const week = plan.steps.find(step => step.interval === '1w')!;
  expect(timeOfQ(week.qAlive1, plan.duration)).toBeCloseTo(768, 0);
});

it('falls back when a gate fails', () => {
  expect(planTravel(input('15m', '1h', { targetReady: false })).ok).toBe(false);
  expect(planTravel(input('15m', '1h', { originReady: false })).ok).toBe(false);
  expect(planTravel(input('1w', '1M', { reduceMotion: true })).ok).toBe(false);
  expect(planTravel(input('1m', '1d', { atRest: false })).ok).toBe(false);
  expect(planTravel(input('4h', '1w', { elapsedMs: 101 })).ok).toBe(false);
  expect(planTravel(input('1h', '1M', { origin: [] })).ok).toBe(false);
  const flat = build('15m').map(candle => ({ ...candle, open: 1, high: 1, low: 1, close: 1 }));
  const flatPlan = planTravel(input('15m', '1h', { origin: flat }));
  expect(flatPlan.ok).toBe(false);
  if (!flatPlan.ok) expect(flatPlan.reason).toBe('flat');
  const short = build('15m').slice(-6);
  const edge = planTravel(input('15m', '1h', { origin: short }));
  expect(edge.ok).toBe(false);
  if (!edge.ok) expect(edge.reason).toBe('edge');
});

it('keeps every pair inside the measured per-update budget', () => {
  const clock = new Animated.Value(0);
  const count = 240;
  const nodes = Array.from({ length: count }, () => {
    const shift = clock.interpolate({ inputRange: [0, 1], outputRange: [0, 40] });
    return Animated.subtract(shift, Animated.modulo(shift, 1)) as unknown as { __getValue(): number };
  });
  for (let frame = 0; frame < 4; frame += 1) {
    clock.setValue(frame / 10);
    for (const node of nodes) node.__getValue();
  }
  let sink = 0;
  const frames = 20;
  const started = performance.now();
  for (let frame = 0; frame < frames; frame += 1) {
    clock.setValue((frame + 1) / (frames + 1));
    for (const node of nodes) sink += node.__getValue();
  }
  const perUpdateUs = ((performance.now() - started) * 1000) / (frames * count);
  expect(sink).not.toBe(0);
  expect(perUpdateUs).toBeLessThan(UPDATE_US);
  for (const from of INTERVALS.map(item => item.value)) {
    for (const to of INTERVALS.map(item => item.value)) {
      if (from === to) continue;
      const decided = planTravel(input(from, to));
      if (!decided.ok) throw new Error(`${from}->${to} ${decided.reason}`);
      expect(decided.plan.peakViews * perUpdateUs).toBeLessThanOrEqual(UPDATE_BUDGET_US);
      expect(decided.plan.peakViews * UPDATE_US).toBeLessThanOrEqual(UPDATE_BUDGET_US);
    }
  }
});

it('updates only the candles on screen when stored lists are full', () => {
  const stored: TravelInput['stored'] = {};
  for (const interval of LADDER) {
    if (interval === '5m') continue;
    stored[interval] = { candles: build(interval) };
  }
  let worst = 0;
  let worstPair = '';
  for (const from of INTERVALS.map(item => item.value)) {
    for (const to of INTERVALS.map(item => item.value)) {
      if (from === to) continue;
      const decided = planTravel(input(from, to, { stored }));
      if (!decided.ok) {
        if (decided.reason !== 'edge') throw new Error(`${from}->${to} ${decided.reason}`);
        continue;
      }
      if (decided.plan.peakViews > worst) {
        worst = decided.plan.peakViews;
        worstPair = `${from}->${to}`;
      }
      expect(decided.plan.peakViews * UPDATE_US).toBeLessThanOrEqual(UPDATE_BUDGET_US);
      const target = decided.plan.steps.find(step => step.interval === to);
      expect(target?.qAlive1).toBe(1);
      if (target?.perCandle) {
        const shown = new Set(target.waves.flatMap(wave => [...wave.openTimes]));
        expect(shown.size).toBe(target.candles.length);
        expect(target.waves.some(wave => wave.until >= decided.plan.duration - 1)).toBe(true);
      }
    }
  }
  expect(worst).toBeLessThanOrEqual(128);
  expect(worstPair).not.toBe('');
  for (const [from, to] of [
    ['1m', '1d'],
    ['1d', '1m'],
    ['1m', '1M'],
    ['1M', '1m'],
    ['1w', '1M'],
    ['15m', '1h'],
  ] as const) {
    const decided = planTravel(input(from, to, { stored }));
    if (!decided.ok) throw new Error(`${from}->${to} ${decided.reason}`);
    expect(decided.plan.peakViews).toBeLessThanOrEqual(128);
  }
});

it('lists every ladder step once', () => {
  expect(LADDER).toEqual(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']);
  expect(PAIRS).toHaveLength(21);
});
