import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getTrades, newTrades, TAPE_LIMIT } from './Trade';

function agg(
  a: number,
  p: string,
  q = '0.00200000',
  m = false,
  T = 1_700_000_000_000 + a,
) {
  return { a, p, q, T, m };
}

/** Fixtures store the processed response. Endpoint `process` runs in fetch, not in `resolve`. */
function snapshot(symbol: string, rows: readonly object[]) {
  return {
    endpoint: getTrades,
    args: [{ symbol }],
    response: getTrades.process(rows, { symbol }),
  };
}

function setTrades(
  controller: { set: (...args: any[]) => Promise<void> },
  symbol: string,
  value: object | object[],
) {
  let promise: Promise<void> | undefined;
  act(() => {
    promise = controller.set(newTrades, { symbol }, value);
  });
  return promise;
}

function resolveTrades(
  controller: { resolve: (...args: any[]) => Promise<void> },
  symbol: string,
  response: unknown,
  fetchedAt: number,
) {
  let promise: Promise<void> | undefined;
  act(() => {
    promise = controller.resolve(getTrades, {
      args: [{ symbol }],
      response,
      fetchedAt,
    });
  });
  return promise;
}

it('stores an aggregate snapshot newest first', () => {
  const wire = [agg(1, '100.10', '1', false), agg(2, '100.20', '2', true)];
  expect(getTrades.process(wire, { symbol: 'BTCUSDT' }).map(row => row.a)).toEqual([2, 1]);

  const { result } = renderDataHook(
    () => useSuspense(getTrades, { symbol: 'BTCUSDT' }),
    { initialFixtures: [snapshot('BTCUSDT', wire)] },
  );

  expect(result.current.map(trade => trade.a)).toEqual([2, 1]);
  expect(result.current[0].price).toBe(100.2);
  expect(result.current[0].qty).toBe(2);
  expect(typeof result.current[0].price).toBe('number');
  expect(typeof result.current[0].qty).toBe('number');
  expect(result.current[0].takerBuy).toBe(false);
  expect(result.current[1].takerBuy).toBe(true);
});

it('inserts a newer print at the head and sorts an older one', async () => {
  const { result, controller } = renderDataHook(
    () => useSuspense(getTrades, { symbol: 'BTCUSDT' }),
    { initialFixtures: [snapshot('BTCUSDT', [agg(10, '1'), agg(12, '3')])] },
  );

  await setTrades(controller, 'BTCUSDT', agg(13, '4'));
  expect(result.current.map(trade => trade.a)).toEqual([13, 12, 10]);

  await setTrades(controller, 'BTCUSDT', agg(13, '9'));
  expect(result.current).toHaveLength(3);
  expect(result.current.filter(trade => trade.a === 13)).toHaveLength(1);

  await setTrades(controller, 'BTCUSDT', agg(11, '2'));
  expect(result.current.map(trade => trade.a)).toEqual([13, 12, 11, 10]);
});

it('keeps the newest 100 prints', async () => {
  const wire = Array.from({ length: TAPE_LIMIT }, (_, index) => agg(index + 1, '1'));
  const { result, controller } = renderDataHook(
    () => useSuspense(getTrades, { symbol: 'BTCUSDT' }),
    { initialFixtures: [snapshot('BTCUSDT', wire)] },
  );

  await setTrades(
    controller,
    'BTCUSDT',
    [101, 102, 103, 104, 105].map(id => agg(id, String(id))),
  );

  expect(result.current).toHaveLength(TAPE_LIMIT);
  expect(result.current.slice(0, 5).map(trade => trade.a)).toEqual([105, 104, 103, 102, 101]);
  expect(result.current.at(-1)?.a).toBe(6);
  expect(result.current.some(trade => trade.a <= 5)).toBe(false);
});

it('keeps the same aggregate id on two symbols apart', () => {
  const { result } = renderDataHook(
    () => ({
      btc: useSuspense(getTrades, { symbol: 'BTCUSDT' }),
      eth: useSuspense(getTrades, { symbol: 'ETHUSDT' }),
    }),
    {
      initialFixtures: [
        snapshot('BTCUSDT', [agg(1, '100')]),
        snapshot('ETHUSDT', [agg(1, '200')]),
      ],
    },
  );

  expect(result.current.btc[0].price).toBe(100);
  expect(result.current.eth[0].price).toBe(200);
  expect(result.current.btc[0].a).toBe(1);
  expect(result.current.eth[0].a).toBe(1);
});

it('stores an empty snapshot as an empty tape', () => {
  const { result } = renderDataHook(
    () => useSuspense(getTrades, { symbol: 'BTCUSDT' }),
    { initialFixtures: [snapshot('BTCUSDT', [])] },
  );
  expect(result.current).toEqual([]);
});

it('keeps the stream list when an older snapshot resolves', async () => {
  const { result, controller } = renderDataHook(
    () => useSuspense(getTrades, { symbol: 'BTCUSDT' }),
    { initialFixtures: [snapshot('BTCUSDT', [agg(10, '10'), agg(11, '11')])] },
  );

  await setTrades(controller, 'BTCUSDT', agg(12, '12'));
  const afterStream = result.current.map(trade => trade.a);
  expect(afterStream).toEqual([12, 11, 10]);

  await resolveTrades(controller, 'BTCUSDT', [agg(1, '1')], 1);

  expect(result.current.map(trade => trade.a)).toEqual(afterStream);
});
