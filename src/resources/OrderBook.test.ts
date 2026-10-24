import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { getOrderBook, OrderBook } from './OrderBook';
import { actWrite } from './testSupport';

function mount(response: object) {
  return renderDataHook(() => useSuspense(getOrderBook, { symbol: 'BTCUSDT' }), {
    initialFixtures: [
      {
        endpoint: getOrderBook,
        args: [{ symbol: 'BTCUSDT' }],
        response,
      },
    ],
  });
}

function setBook(
  controller: { set: (...args: any[]) => Promise<void> },
  value: object,
) {
  return actWrite(() => controller.set(OrderBook, { symbol: 'BTCUSDT' }, value));
}

const snapshot = {
  lastUpdateId: 10,
  bids: [
    ['100.5', '1'],
    ['100', '4'],
  ],
  asks: [
    ['101.25', '2'],
    ['102', '5'],
  ],
};

it('normalizes a depth snapshot into the book', () => {
  const { result } = mount({
    lastUpdateId: 10,
    bids: [['100.5', '1']],
    asks: [['101.25', '2']],
  });

  expect(result.current.symbol).toBe('BTCUSDT');
  expect(result.current.bestBid).toBe(100.5);
  expect(result.current.bestAsk).toBe(101.25);
  expect(result.current.bids).toHaveLength(1);
  expect(result.current.asks).toHaveLength(1);
});

it('merges a depth diff and ignores stale or gapped updates', async () => {
  const { result, controller } = mount(snapshot);

  await setBook(controller, { U: 8, u: 9, b: [['1', '1']], a: [] });
  expect(result.current.lastUpdateId).toBe(10);
  expect(result.current.bestBid).toBe(100.5);

  await setBook(controller, { U: 12, u: 13, b: [['100.5', '9']], a: [] });
  expect(result.current.lastUpdateId).toBe(10);
  expect(result.current.bids[0]).toEqual([100.5, 1]);

  await setBook(controller, {
    U: 11,
    u: 12,
    b: [
      ['100.5', '0'],
      ['100.25', '3'],
    ],
    a: [['101.25', '4']],
  });
  expect(result.current.lastUpdateId).toBe(12);
  expect(result.current.bestBid).toBe(100.25);
  expect(result.current.bestAsk).toBe(101.25);
  expect(result.current.bids).toEqual([
    [100.25, 3],
    [100, 4],
  ]);
  expect(result.current.asks).toEqual([
    [101.25, 4],
    [102, 5],
  ]);

  await setBook(controller, {
    lastUpdateId: 20,
    bids: [['90', '1']],
    asks: [['91', '1']],
  });
  expect(result.current.lastUpdateId).toBe(20);
  expect(result.current.bids).toEqual([[90, 1]]);
  expect(result.current.asks).toEqual([[91, 1]]);
});

it('keeps the levels nearest the spread and reuses unchanged ones', async () => {
  const levels = (from: number, step: number) =>
    Array.from({ length: 100 }, (_, i) => [String(from + i * step), '1']);
  const { result, controller } = mount({
    lastUpdateId: 10,
    bids: levels(1000, -1),
    asks: levels(1001, 1),
  });
  const before = result.current.bids;

  await setBook(controller, {
    U: 11,
    u: 11,
    b: [
      ['1000.5', '2'],
      ['500', '3'],
    ],
    a: [['5000', '3']],
  });

  const { bids, asks } = result.current;
  expect(bids).toHaveLength(100);
  expect(bids[0]).toEqual([1000.5, 2]);
  expect(bids[1]).toBe(before[0]);
  expect(bids[99][0]).toBe(902);
  expect(asks).toHaveLength(100);
  expect(asks[99][0]).toBe(1100);
});
