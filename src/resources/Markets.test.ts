import { useQuery } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getMarketNames, getMarkets } from './Markets';
import { getExchangeInfo, MarketSymbol } from './Symbol';
import { getTickers, Ticker } from './Ticker';
import { readMiniTickers } from './TickerStream';

const btcFilters = [
  { filterType: 'PRICE_FILTER', tickSize: '0.01000000', minPrice: '0.01' },
  { filterType: 'LOT_SIZE', stepSize: '0.00001000', minQty: '0.00001' },
  { filterType: 'NOTIONAL', minNotional: '5.00000000' },
];

function symbol(
  name: string,
  base: string,
  quote: string,
  status = 'TRADING',
  filters: object[] = btcFilters,
) {
  return {
    symbol: name,
    status,
    baseAsset: base,
    quoteAsset: quote,
    filters,
  };
}

function ticker(name: string, last: string, open: string, quoteVolume: string, closeTime: number) {
  return {
    symbol: name,
    lastPrice: last,
    openPrice: open,
    highPrice: last,
    lowPrice: open,
    volume: '1',
    quoteVolume,
    closeTime,
  };
}

const exchange = {
  symbols: [
    symbol('BTCUSDT', 'BTC', 'USDT'),
    symbol('ETHUSDT', 'ETH', 'USDT'),
    symbol('ADAUSDT', 'ADA', 'USDT'),
    symbol('SOLUSDT', 'SOL', 'USDT', 'HALT'),
    symbol('BTCUSDC', 'BTC', 'USDC'),
    symbol('BNBBTC', 'BNB', 'BTC', 'BREAK', [
      { filterType: 'PRICE_FILTER', tickSize: '0.00000100' },
      { filterType: 'LOT_SIZE', stepSize: '0.00100000' },
      { filterType: 'MIN_NOTIONAL', minNotional: '0.00010000' },
    ]),
  ],
};

const tickers = [
  ticker('BTCUSDT', '101', '100', '50', 1_000),
  ticker('ETHUSDT', '110', '100', '20', 1_000),
  ticker('ADAUSDT', '90', '100', '5', 1_000),
  ticker('SOLUSDT', '9', '10', '999', 1_000),
  ticker('BTCUSDC', '101', '100', '80', 1_000),
];

function useLists() {
  return {
    volume: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const }),
    change: useQuery(getMarkets, { quote: 'USDT', sort: 'change' as const }),
    name: useQuery(getMarkets, { quote: 'USDT', sort: 'name' as const }),
    usdc: useQuery(getMarkets, { quote: 'USDC', sort: 'volume' as const }),
    names: useQuery(getMarketNames, { quote: 'USDT' }),
    btc: useQuery(MarketSymbol, { symbol: 'BTCUSDT' }),
    bnb: useQuery(MarketSymbol, { symbol: 'BNBBTC' }),
    btcTicker: useQuery(Ticker, { symbol: 'BTCUSDT' }),
  };
}

const fixtures = [
  { endpoint: getExchangeInfo, args: [], response: exchange },
  { endpoint: getTickers, args: [], response: tickers },
];

it('flattens exchange-info filters onto the symbol', () => {
  const { result } = renderDataHook(() => useLists(), { initialFixtures: fixtures });
  expect(result.current.btc?.tickSize).toBe('0.01000000');
  expect(result.current.btc?.stepSize).toBe('0.00001000');
  expect(result.current.btc?.minNotional).toBe('5.00000000');
  expect(result.current.bnb?.minNotional).toBe('0.00010000');
  expect(result.current.bnb?.tickSize).toBe('0.00000100');
});

it('lists trading quotes by volume, change, and name', () => {
  const { result } = renderDataHook(() => useLists(), { initialFixtures: fixtures });
  const ids = (rows: { symbol: { symbol: string } }[] | undefined) =>
    rows?.map(row => row.symbol.symbol);

  expect(ids(result.current.volume)).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  expect(ids(result.current.change)).toEqual(['ETHUSDT', 'BTCUSDT', 'ADAUSDT']);
  expect(ids(result.current.name)).toEqual(['ADAUSDT', 'BTCUSDT', 'ETHUSDT']);
  expect(ids(result.current.usdc)).toEqual(['BTCUSDC']);
  expect(result.current.btcTicker?.percent).toBeCloseTo(0.01);
});

it('shows symbol names before any ticker exists', () => {
  const { result } = renderDataHook(() => useLists(), {
    initialFixtures: [{ endpoint: getExchangeInfo, args: [], response: exchange }],
  });
  expect(result.current.volume).toBeUndefined();
  expect(result.current.names?.map(row => row.symbol.symbol)).toEqual([
    'BTCUSDT',
    'ETHUSDT',
    'ADAUSDT',
  ]);
  expect(result.current.names?.every(row => row.ticker == null)).toBe(true);
});

function setTicker(
  controller: { set: (...args: any[]) => Promise<void> },
  value: object,
) {
  let promise: Promise<void> | undefined;
  act(() => {
    promise = controller.set(Ticker, { symbol: 'BTCUSDT' }, value);
  });
  return promise;
}

it('keeps a newer last price when an older ticker arrives', async () => {
  const { result, controller } = renderDataHook(() => useQuery(Ticker, { symbol: 'BTCUSDT' }), {
    initialFixtures: [
      {
        endpoint: getTickers,
        args: [],
        response: [ticker('BTCUSDT', '101', '100', '50', 1_000)],
      },
    ],
  });

  await setTicker(controller, {
    e: '24hrMiniTicker',
    E: 2_000,
    s: 'BTCUSDT',
    c: '120',
    o: '100',
    h: '121',
    l: '99',
    v: '3',
    q: '60',
  });
  expect(result.current?.last).toBe(120);
  expect(result.current?.quoteVolume).toBe(60);

  await setTicker(controller, ticker('BTCUSDT', '1', '1', '1', 500));
  expect(result.current?.last).toBe(120);
  expect(result.current?.eventTime).toBe(2_000);
});

it('reads a mini-ticker array', () => {
  const raw = JSON.stringify([
    { e: '24hrMiniTicker', E: 1, s: 'BTCUSDT', c: '1', o: '1', h: '1', l: '1', v: '1', q: '1' },
  ]);
  expect(readMiniTickers(raw)).toHaveLength(1);
  expect(readMiniTickers({ data: [{ s: 'ETHUSDT' }] })).toEqual([{ s: 'ETHUSDT' }]);
  expect(readMiniTickers('nope')).toBeUndefined();
  expect(readMiniTickers({ result: null })).toBeUndefined();
});
