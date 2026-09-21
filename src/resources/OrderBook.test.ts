import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { applyDepthEvents } from './depthDiff';
import { getOrderBook, OrderBook } from './OrderBook';

const snapshot = {
  lastUpdateId: 10,
  bids: [
    [100.5, 1],
    [100, 4],
  ] as [number, number][],
  asks: [
    [101.25, 2],
    [102, 5],
  ] as [number, number][],
};

it('drops stale depth events and reports a gap', () => {
  const stale = applyDepthEvents(snapshot, [
    { U: 8, u: 9, b: [['1', '1']], a: [] },
  ]);
  expect(stale.gap).toBe(false);
  expect(stale.book.lastUpdateId).toBe(10);
  expect(stale.book.bids).toBe(snapshot.bids);

  const gap = applyDepthEvents(snapshot, [
    { U: 12, u: 13, b: [['100.5', '9']], a: [] },
  ]);
  expect(gap.gap).toBe(true);
  expect(gap.rest).toHaveLength(1);
  expect(gap.book.bids).toBe(snapshot.bids);
});

it('normalizes a depth snapshot into the book', () => {
  const { result } = renderDataHook(
    () => useSuspense(getOrderBook, { symbol: 'BTCUSDT' }),
    {
      initialFixtures: [
        {
          endpoint: getOrderBook,
          args: [{ symbol: 'BTCUSDT' }],
          response: {
            lastUpdateId: 10,
            bids: [['100.5', '1']],
            asks: [['101.25', '2']],
          },
        },
      ],
    },
  );

  expect(result.current.symbol).toBe('BTCUSDT');
  expect(result.current.bestBid).toBe(100.5);
  expect(result.current.bestAsk).toBe(101.25);
  expect(result.current.bids).toHaveLength(1);
  expect(result.current.asks).toHaveLength(1);
});

it('applies a depth diff onto the cached book', async () => {
  const { result, controller } = renderDataHook(
    () => useSuspense(getOrderBook, { symbol: 'BTCUSDT' }),
    {
      initialFixtures: [
        {
          endpoint: getOrderBook,
          args: [{ symbol: 'BTCUSDT' }],
          response: {
            lastUpdateId: 10,
            bids: [
              ['100.5', '1'],
              ['100', '4'],
            ],
            asks: [
              ['101.25', '2'],
              ['102', '5'],
            ],
          },
        },
      ],
    },
  );

  const next = applyDepthEvents(
    {
      lastUpdateId: result.current.lastUpdateId,
      bids: result.current.bids,
      asks: result.current.asks,
    },
    [
      {
        U: 11,
        u: 12,
        b: [
          ['100.5', '0'],
          ['100.25', '3'],
        ],
        a: [['101.25', '4']],
      },
    ],
  );

  expect(next.gap).toBe(false);
  await controller.set(OrderBook, { symbol: 'BTCUSDT' }, next.book);

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
});
