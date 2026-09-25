import { candleIndexAt, candleLayout, candleMetrics, plotDeviceShift, plotSize } from './candleLayout';

it('sizes the plot from the window and the safe insets', () => {
  expect(plotSize(384, 832, 47, 24)).toEqual({ width: 360, height: 521 });
});

it('snaps candle slots onto device pixels and right-aligns the series', () => {
  const cases = [
    { ratio: 3.75, slot: 22, body: 18, gap: 4 },
    { ratio: 3, slot: 18, body: 15, gap: 3 },
    { ratio: 1, slot: 6, body: 5, gap: 1 },
  ];
  for (const item of cases) {
    const metrics = candleMetrics(360, item.ratio);
    expect(metrics).toMatchObject({ slot: item.slot, body: item.body, gap: item.gap, wick: item.gap });
    const candles = Array.from({ length: 60 }, (_, index) => ({
      open: 100,
      high: 110 + (index % 5),
      low: 90,
      close: 101 + (index % 7),
    }));
    const layout = candleLayout(candles, { width: 360, height: 521, ratio: item.ratio });
    expect(layout).toHaveLength(60);
    expect(layout[59].x + metrics.bodyCss).toBeCloseTo(360, 5);
    expect(layout[59].x).toBeGreaterThan(layout[0].x);
  }
});

it('shifts the device layer onto the pixel grid at ratio 3.75', () => {
  expect(plotDeviceShift(47, 0, 3.75)).toEqual({ x: 0, y: 0.25 });
  expect(plotDeviceShift(47, 0, 3)).toEqual({ x: 0, y: 0 });
  expect(plotDeviceShift(48, 0, 3.75)).toEqual({ x: 0, y: 0 });
});

it('keeps the series inside the 20px bands', () => {
  const layout = candleLayout([{ open: 1, high: 10, low: 0, close: 2 }], {
    width: 360,
    height: 521,
    ratio: 3.75,
  });
  expect(layout[0].wickTop).toBeCloseTo(20, 5);
  const bottom = layout[0].wickTop + layout[0].wickHeight;
  expect(bottom).toBeGreaterThan(500);
  expect(bottom).toBeLessThanOrEqual(501.2);
});

it('keeps a flat series and a doji visible', () => {
  const flat = candleLayout([{ open: 50, high: 50, low: 50, close: 50 }], {
    width: 360,
    height: 521,
    ratio: 3.75,
  });
  expect(flat[0].direction).toBe('flat');
  expect(flat[0].bodyHeight).toBeGreaterThan(0);
  expect(flat[0].wickHeight).toBeGreaterThan(0);
  expect(flat[0].bodyTop).toBeGreaterThan(0);
  expect(flat[0].bodyTop + flat[0].bodyHeight).toBeLessThan(521);

  const doji = candleLayout([{ open: 40, high: 80, low: 20, close: 40 }], {
    width: 360,
    height: 521,
    ratio: 1,
  });
  expect(doji[0].direction).toBe('flat');
  expect(doji[0].bodyHeight).toBeGreaterThanOrEqual(1);
  expect(doji[0].wickHeight).toBeGreaterThan(doji[0].bodyHeight);

  const mixed = candleLayout(
    [
      { open: 1, high: 4, low: 0, close: 3 },
      { open: 3, high: 4, low: 0, close: 1 },
    ],
    { width: 360, height: 100, ratio: 1 },
  );
  expect(mixed.map(item => item.direction)).toEqual(['up', 'down']);
});

it('maps a plot x onto the right-aligned candle', () => {
  expect(candleIndexAt(0, 60, 360, 3.75)).toBe(0);
  expect(candleIndexAt(66.933, 60, 360, 3.75)).toBe(10);
  expect(candleIndexAt(360, 60, 360, 3.75)).toBe(59);
  expect(candleIndexAt(0, 1, 360, 3.75)).toBe(0);
  expect(candleIndexAt(-1, 60, 360, 3.75)).toBeNull();
  expect(candleIndexAt(361, 60, 360, 3.75)).toBeNull();
  expect(candleIndexAt(10, 0, 360, 3.75)).toBeNull();
});
