import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { CANDLE_LIMIT, getCandles, upsertCandle } from './Candle';
import { actWrite } from './testSupport';

function row(openTime: number, close: string, trades = 10): unknown[] {
  return [openTime, '100', '110', '90', close, '5', openTime + 900_000, '500', trades, '1', '1', '0'];
}

function kline(openTime: number, close: string, trades: number) {
  return { t: openTime, o: '100', h: '110', l: '90', c: close, v: '5', n: trades };
}

const three = [row(1_000, '101.5', 4), row(2_000, '102', 6), row(3_000, '103.25', 10)];

const btc15 = { symbol: 'BTCUSDT', interval: '15m' as const };

function mount(response: unknown = three, args: { symbol: string; interval: '15m' | '1h' } = btc15) {
  return renderDataHook(() => useSuspense(getCandles, args), {
    initialFixtures: [{ endpoint: getCandles, args: [args], response }],
  });
}

function setCandle(
  controller: { set: (...args: any[]) => Promise<void> },
  args: { symbol: string; interval: '15m' | '1h' },
  value: object,
) {
  return actWrite(() => controller.set(upsertCandle, args, [value]));
}

it('normalizes kline tuples into candles, oldest first', () => {
  const { result } = mount();

  expect(result.current.map(candle => candle.openTime)).toEqual([1_000, 2_000, 3_000]);
  expect(result.current[0].close).toBe(101.5);
});

it('merges a forming candle in place and keeps the other entities', async () => {
  const { result, controller } = mount();
  const first = result.current[0];
  const second = result.current[1];

  await setCandle(controller, btc15, kline(3_000, '109.5', 12));

  expect(result.current).toHaveLength(3);
  expect(result.current[2].close).toBe(109.5);
  expect(result.current[2].trades).toBe(12);
  expect(result.current[0]).toBe(first);
  expect(result.current[1]).toBe(second);
});

it('appends a new open time and drops the oldest past the limit', async () => {
  const { result, controller } = mount();

  await setCandle(controller, btc15, kline(4_000, '104', 1));
  expect(result.current).toHaveLength(4);
  expect(result.current[3].openTime).toBe(4_000);
  expect(result.current[3].close).toBe(104);

  const full = Array.from({ length: CANDLE_LIMIT }, (_, i) => row((i + 1) * 1_000, '1', 1));
  const capped = mount(full);
  await setCandle(capped.controller, btc15, kline((CANDLE_LIMIT + 1) * 1_000, '2', 1));
  expect(capped.result.current).toHaveLength(CANDLE_LIMIT);
  expect(capped.result.current[0].openTime).toBe(2_000);
  expect(capped.result.current[CANDLE_LIMIT - 1].openTime).toBe((CANDLE_LIMIT + 1) * 1_000);
});

it('keeps the stored candle when an older trade count arrives', async () => {
  const { result, controller } = mount();

  await setCandle(controller, btc15, kline(3_000, '1', 3));
  expect(result.current[2].close).toBe(103.25);
  expect(result.current[2].trades).toBe(10);
});

it('does not write a candle into another interval or symbol', async () => {
  const { result, controller } = renderDataHook(
    () => ({
      m15: useSuspense(getCandles, { symbol: 'BTCUSDT', interval: '15m' as const }),
      h1: useSuspense(getCandles, { symbol: 'BTCUSDT', interval: '1h' as const }),
      eth: useSuspense(getCandles, { symbol: 'ETHUSDT', interval: '15m' as const }),
    }),
    {
      initialFixtures: [
        { endpoint: getCandles, args: [{ symbol: 'BTCUSDT', interval: '15m' }], response: three },
        {
          endpoint: getCandles,
          args: [{ symbol: 'BTCUSDT', interval: '1h' }],
          response: [row(9_000, '50', 2)],
        },
        {
          endpoint: getCandles,
          args: [{ symbol: 'ETHUSDT', interval: '15m' }],
          response: [row(9_000, '20', 2)],
        },
      ],
    },
  );
  const m15 = result.current.m15;
  const eth = result.current.eth;

  await setCandle(controller, { symbol: 'BTCUSDT', interval: '1h' }, kline(9_000, '77', 8));
  expect(result.current.m15).toBe(m15);
  expect(result.current.m15[2].close).toBe(103.25);
  expect(result.current.h1[0].close).toBe(77);

  await setCandle(controller, { symbol: 'ETHUSDT', interval: '15m' }, kline(10_000, '3', 1));
  expect(result.current.m15).toBe(m15);
  expect(result.current.eth).not.toBe(eth);
  expect(result.current.eth.map(candle => candle.openTime)).toEqual([9_000, 10_000]);
});

it('requests sixty klines without putting limit in the cache key', () => {
  expect(getCandles.url({ symbol: 'BTCUSDT', interval: '15m' })).toBe(
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=60',
  );
});
