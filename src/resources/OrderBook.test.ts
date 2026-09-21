import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { getOrderBook } from './OrderBook';

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
