import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { nextPlaces, type Places } from './places';
import { getOrderBook, OrderBook } from '@/resources/OrderBook';

const START: Places = { price: 2, size: 2 };

function setBook(
  controller: { set: (...args: any[]) => Promise<void> },
  value: object,
) {
  let promise: Promise<void> | undefined;
  act(() => {
    promise = controller.set(OrderBook, { symbol: 'DOGEUSDT' }, value);
  });
  return promise;
}

it('only widens when nothing is locked', () => {
  const first = nextPlaces(START, [100.1], [1], {});
  expect(first).toBe(START);
  expect(first).toEqual({ price: 2, size: 2 });

  const widened = nextPlaces(first, [0.09947], [1.234], {});
  expect(widened).toEqual({ price: 5, size: 3 });

  const gone = nextPlaces(widened, [0.1], [1], {});
  expect(gone).toBe(widened);
  expect(gone.price).toBe(5);

  const capped = nextPlaces(START, [1.000000001], [1], {});
  expect(capped.price).toBe(8);
});

it('locks price and size independently of the sample', () => {
  const locked = nextPlaces(START, [0.0995, 0.099], [28058], { price: 5, size: 0 });
  expect(locked).toEqual({ price: 5, size: 0 });

  const widened = nextPlaces(START, [0.0995], [28058.12], {});
  expect(widened).toEqual({ price: 4, size: 2 });
  const priceOnly = nextPlaces(widened, [0.0995], [28058.12], { price: 5 });
  expect(priceOnly).toEqual({ price: 5, size: 2 });
  const both = nextPlaces(widened, [0.099], [1], { price: 5, size: 0 });
  expect(both).toEqual({ price: 5, size: 0 });
});

it('keeps five price places after the finer level is dismissed', () => {
  const seen = nextPlaces(START, [0.09947, 0.0995], [], {});
  expect(seen.price).toBe(5);
  const left = nextPlaces(seen, [0.0995], [], {});
  expect(left.price).toBe(5);
  expect(left).toBe(seen);

  const locked = nextPlaces(START, [0.09947, 0.0995], [], { price: 5, size: 0 });
  const lockedLeft = nextPlaces(locked, [0.0995], [], { price: 5, size: 0 });
  expect(lockedLeft.price).toBe(5);
  expect(lockedLeft).toBe(locked);
});

it('returns the same object when nothing changes', () => {
  const once = nextPlaces(START, [1.23], [1.2], { price: 5 });
  const twice = nextPlaces(once, [1.2], [9], { price: 5 });
  expect(twice).toBe(once);
});

it('keeps the DOGE price lock after a depth diff removes the finer level', async () => {
  const { result, controller } = renderDataHook(
    () => useSuspense(getOrderBook, { symbol: 'DOGEUSDT' }),
    {
      initialFixtures: [
        {
          endpoint: getOrderBook,
          args: [{ symbol: 'DOGEUSDT' }],
          response: {
            lastUpdateId: 10,
            bids: [['0.09940', '10']],
            asks: [
              ['0.09947', '1'],
              ['0.09950', '28058'],
            ],
          },
        },
      ],
    },
  );

  const prices = () => [...result.current.asks, ...result.current.bids].map(level => level[0]);
  const sizes = () => [...result.current.asks, ...result.current.bids].map(level => level[1]);
  const lock = { price: 5, size: 0 };
  const seen = nextPlaces(START, prices(), sizes(), lock);
  expect(seen).toEqual({ price: 5, size: 0 });

  await setBook(controller, {
    U: 11,
    u: 11,
    b: [],
    a: [['0.09947', '0']],
  });

  expect(result.current.asks.map(level => level[0])).toEqual([0.0995]);
  const left = nextPlaces(seen, prices(), sizes(), lock);
  expect(left).toEqual({ price: 5, size: 0 });
  expect(left).toBe(seen);
});
