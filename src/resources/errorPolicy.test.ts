import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getCandles } from './Candle';
import { getOrderBook } from './OrderBook';
import { getExchangeInfo } from './Symbol';
import { getTickers } from './Ticker';
import { getTrades } from './Trade';

const reads = [getExchangeInfo, getTickers, getOrderBook, getTrades, getCandles];

it('keeps the last read when a refresh fails, including a 4xx', () => {
  for (const endpoint of reads) {
    expect(endpoint.errorPolicy(new TypeError('Failed to fetch'))).toBe('soft');
    expect(endpoint.errorPolicy({ status: 400 })).toBe('soft');
  }
  expect(getExchangeInfo.dataExpiryLength).toBe(Infinity);
});

it('keeps the book on screen when a later read fails', async () => {
  const { result, controller } = renderDataHook(
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
  const book = result.current;

  await controller.resolve(getOrderBook, {
    args: [{ symbol: 'BTCUSDT' }],
    response: new TypeError('Failed to fetch'),
    fetchedAt: Date.now(),
    error: true,
  });

  expect(result.current).toBe(book);
  expect(result.current.bestBid).toBe(100.5);
});

it('throws when the first read fails and nothing is stored', async () => {
  const { result } = renderDataHook(
    () => useSuspense(getOrderBook, { symbol: 'BTCUSDT' }),
    {
      resolverFixtures: [
        {
          endpoint: getOrderBook,
          args: [{ symbol: 'BTCUSDT' }],
          response: new TypeError('Failed to fetch'),
          error: true,
        },
      ],
    },
  );

  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(result.error).toBeInstanceOf(TypeError);
  expect((result.error as TypeError).message).toBe('Failed to fetch');
});
