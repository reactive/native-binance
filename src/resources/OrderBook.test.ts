import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { BOOK_DEPTH, getOrderBook, OrderBook } from './OrderBook';
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
  const levels = (from: number, step: number, count: number) =>
    Array.from({ length: count }, (_, i) => [String(from + i * step), '1']);
  const { result, controller } = mount({
    lastUpdateId: 10,
    bids: levels(1000, -1, 100),
    asks: levels(1001, 1, 100),
  });
  const before = result.current.bids;

  // Diffs past the snapshot fill the side out to BOOK_DEPTH; deeper ones are dropped.
  await setBook(controller, {
    U: 11,
    u: 11,
    b: [['1000.5', '2'], ...levels(900, -1, BOOK_DEPTH)],
    a: [],
  });

  const { bids, asks } = result.current;
  expect(bids).toHaveLength(BOOK_DEPTH);
  expect(bids[0]).toEqual([1000.5, 2]);
  expect(bids[1]).toBe(before[0]);
  expect(bids[BOOK_DEPTH - 1][0]).toBe(1000 - (BOOK_DEPTH - 2));
  expect(asks).toHaveLength(100);
});

it('keeps live levels past the snapshot when nearer ones are removed', async () => {
  const { result, controller } = mount({
    lastUpdateId: 10,
    bids: Array.from({ length: 100 }, (_, i) => [String(1000 - i), '1']),
    asks: [['1001', '1']],
  });

  await setBook(controller, { U: 11, u: 11, b: [['1001', '1']], a: [] });
  await setBook(controller, {
    U: 12,
    u: 12,
    b: Array.from({ length: 100 }, (_, i) => [String(1001 - i), '0']),
    a: [],
  });

  expect(result.current.bids).toEqual([[901, 1]]);
});
