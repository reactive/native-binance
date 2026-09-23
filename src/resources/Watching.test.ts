import { useQuery, useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getMarkets } from './Markets';
import { getExchangeInfo } from './Symbol';
import { memoryStorage, actWrite } from './testSupport';
import { getTickers } from './Ticker';
import { getWatching, setWatched, WatchedSymbol } from './Watching';
import { readWatched } from './watchStorage';

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: memoryStorage(),
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

const btcFilters = [
  { filterType: 'PRICE_FILTER', tickSize: '0.01000000', minPrice: '0.01' },
  { filterType: 'LOT_SIZE', stepSize: '0.00001000', minQty: '0.00001' },
  { filterType: 'NOTIONAL', minNotional: '5.00000000' },
];

function symbol(name: string, base: string, quote: string, status = 'TRADING') {
  return { symbol: name, status, baseAsset: base, quoteAsset: quote, filters: btcFilters };
}

function ticker(name: string, last: string, open: string, quoteVolume: string) {
  return {
    symbol: name,
    lastPrice: last,
    openPrice: open,
    highPrice: last,
    lowPrice: open,
    volume: '1',
    quoteVolume,
    closeTime: 1_000,
  };
}

const exchange = {
  symbols: [
    symbol('BTCUSDT', 'BTC', 'USDT'),
    symbol('ETHUSDT', 'ETH', 'USDT'),
    symbol('ADAUSDT', 'ADA', 'USDT'),
    symbol('ETHBTC', 'ETH', 'BTC'),
    symbol('BNBBTC', 'BNB', 'BTC', 'BREAK'),
    symbol('SOLUSDT', 'SOL', 'USDT', 'HALT'),
  ],
};

const tickers = [
  ticker('BTCUSDT', '101', '100', '50'),
  ticker('ETHUSDT', '110', '100', '20'),
  ticker('ADAUSDT', '90', '100', '5'),
  ticker('ETHBTC', '0.05', '0.04', '3'),
  ticker('SOLUSDT', '9', '10', '999'),
];

const fixtures = [
  { endpoint: getExchangeInfo, args: [], response: exchange },
  { endpoint: getTickers, args: [], response: tickers },
];

function ids(rows: { symbol: string }[] | undefined) {
  return rows?.map(row => row.symbol);
}

function fetchWatched(
  controller: {
    fetch: (
      endpoint: typeof setWatched,
      body: { symbol: string; watched: boolean },
    ) => Promise<unknown>;
  },
  symbol: string,
  watched: boolean,
) {
  const promise = actWrite(() => controller.fetch(setWatched, { symbol, watched }));
  return promise.then(async value => {
    // The fetch promise resolves before the store commit. One more turn lets the hook paint.
    await act(async () => {
      await Promise.resolve();
    });
    return value;
  });
}

/** `useSuspense(getWatching)` resolves on a microtask after the first render. */
async function paint() {
  await act(async () => {
    await Promise.resolve();
  });
}

function seed(ids: string[]) {
  localStorage.setItem('watching.v1', JSON.stringify(ids));
}

it('rehydrates one WatchedSymbol from storage', async () => {
  seed(['ETHUSDT']);
  const { result } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toBeInstanceOf(WatchedSymbol);
  expect(result.current[0]?.symbol).toBe('ETHUSDT');
});

it('keeps storage and the watching query in agreement, without duplicate ids', async () => {
  seed(['ETHUSDT']);
  const { result, controller } = renderDataHook(() => {
    const list = useSuspense(getWatching);
    const rows = useQuery(getMarkets, { watching: true, quote: 'BTC', sort: 'name' as const });
    return { list, rows };
  }, { initialFixtures: fixtures });
  await paint();

  expect(ids(result.current.list)).toEqual(['ETHUSDT']);
  expect(ids(result.current.rows)).toEqual(['ETHUSDT']);

  await fetchWatched(controller, 'BTCUSDT', true);
  expect(readWatched()).toEqual(['ETHUSDT', 'BTCUSDT']);
  expect(ids(result.current.rows)).toEqual(['BTCUSDT', 'ETHUSDT']);

  await fetchWatched(controller, 'BTCUSDT', true);
  expect(readWatched()).toEqual(['ETHUSDT', 'BTCUSDT']);
  expect(ids(result.current.rows)).toEqual(['BTCUSDT', 'ETHUSDT']);
  expect(new Set(readWatched()).size).toBe(readWatched().length);

  await fetchWatched(controller, 'ETHUSDT', false);
  expect(readWatched()).toEqual(['BTCUSDT']);
  expect(ids(result.current.list)).toEqual(['BTCUSDT']);
  expect(ids(result.current.rows)).toEqual(['BTCUSDT']);
});

it('applies true then false issued without awaiting between them', async () => {
  const { result, controller } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  let add: Promise<unknown> | undefined;
  let remove: Promise<unknown> | undefined;
  act(() => {
    add = controller.fetch(setWatched, { symbol: 'ETHUSDT', watched: true });
    remove = controller.fetch(setWatched, { symbol: 'ETHUSDT', watched: false });
  });
  await add;
  await remove;
  await paint();
  expect(readWatched()).toEqual([]);
  expect(result.current).toEqual([]);
});

it('leaves the store unchanged when the write throws', async () => {
  seed(['ETHUSDT']);
  const { result, controller } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(ids(result.current)).toEqual(['ETHUSDT']);
  localStorage.setItem = () => {
    throw new Error('disk full');
  };
  expect(() => {
    act(() => {
      controller.fetch(setWatched, { symbol: 'BTCUSDT', watched: true });
    });
  }).toThrow(/disk full/);
  expect(readWatched()).toEqual(['ETHUSDT']);
  expect(ids(result.current)).toEqual(['ETHUSDT']);
});

it('reads the list back from storage in a fresh store', async () => {
  const first = renderDataHook(() => useSuspense(getWatching));
  await paint();
  await fetchWatched(first.controller, 'ETHUSDT', true);
  expect(ids(first.result.current)).toEqual(['ETHUSDT']);
  first.unmount();

  const second = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(ids(second.result.current)).toEqual(['ETHUSDT']);
  expect(second.result.current[0]).toBeInstanceOf(WatchedSymbol);
});

it('lists watched symbols of any quote and status, and ignores quote', async () => {
  seed(['ETHBTC', 'BNBBTC', 'GONEUSDT', 'SOLUSDT', 'ETHUSDT']);
  const { result } = renderDataHook(
    () => ({
      volume: useQuery(getMarkets, { watching: true, quote: 'USDT', sort: 'volume' as const }),
      name: useQuery(getMarkets, { watching: true, quote: 'BTC', sort: 'name' as const }),
      eth: useQuery(getMarkets, { watching: true, quote: 'USDT', sort: 'volume' as const, q: 'eth' }),
      plain: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const }),
      list: useSuspense(getWatching),
    }),
    { initialFixtures: fixtures },
  );
  await paint();

  expect(ids(result.current.list)).toEqual(['ETHBTC', 'BNBBTC', 'GONEUSDT', 'SOLUSDT', 'ETHUSDT']);
  expect(ids(result.current.volume)).toEqual(['SOLUSDT', 'ETHUSDT', 'ETHBTC', 'BNBBTC']);
  expect(result.current.volume?.find(row => row.symbol === 'BNBBTC')?.status).toBe('BREAK');
  expect(result.current.volume?.find(row => row.symbol === 'SOLUSDT')?.status).toBe('HALT');
  expect(ids(result.current.volume)).not.toContain('GONEUSDT');
  expect(ids(result.current.name)).toEqual(['BNBBTC', 'ETHBTC', 'ETHUSDT', 'SOLUSDT']);
  expect(ids(result.current.eth)).toEqual(['ETHUSDT', 'ETHBTC']);
  expect(ids(result.current.plain)).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
});
