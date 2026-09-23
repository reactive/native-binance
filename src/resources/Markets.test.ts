import { useQuery } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { getMarkets } from './Markets';
import { getExchangeInfo } from './Symbol';
import { actWrite } from './testSupport';
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

function ids(rows: { symbol: string }[] | undefined) {
  return rows?.map(row => row.symbol);
}

function useLists() {
  return {
    volume: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const }),
    change: useQuery(getMarkets, { quote: 'USDT', sort: 'change' as const }),
    name: useQuery(getMarkets, { quote: 'USDT', sort: 'name' as const }),
    usdc: useQuery(getMarkets, { quote: 'USDC', sort: 'volume' as const }),
    btcTicker: useQuery(Ticker, { symbol: 'BTCUSDT' }),
  };
}

const fixtures = [
  { endpoint: getExchangeInfo, args: [], response: exchange },
  { endpoint: getTickers, args: [], response: tickers },
];

it('lists trading quotes by volume, change, and name', () => {
  const { result } = renderDataHook(() => useLists(), { initialFixtures: fixtures });

  expect(ids(result.current.volume)).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  expect(ids(result.current.change)).toEqual(['ETHUSDT', 'BTCUSDT', 'ADAUSDT']);
  expect(ids(result.current.name)).toEqual(['ADAUSDT', 'BTCUSDT', 'ETHUSDT']);
  expect(ids(result.current.usdc)).toEqual(['BTCUSDC']);
  expect(result.current.volume?.[0]?.ticker?.quoteVolume).toBe(50);
  expect(result.current.btcTicker?.percent).toBeCloseTo(0.01);
});

it('shows symbol names before any ticker exists', () => {
  const { result } = renderDataHook(() => useLists(), {
    initialFixtures: [{ endpoint: getExchangeInfo, args: [], response: exchange }],
  });
  expect(ids(result.current.volume)).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  expect(result.current.volume?.every(row => row.ticker == null)).toBe(true);
});

it('sorts on the joined ticker once it is written', async () => {
  const { result, controller } = renderDataHook(
    () => useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const }),
    { initialFixtures: [{ endpoint: getExchangeInfo, args: [], response: exchange }] },
  );
  expect(ids(result.current)).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  expect(result.current?.[0]?.ticker).toBeUndefined();

  await setTicker(controller, ticker('ADAUSDT', '1', '1', '90', 1));
  expect(ids(result.current)?.[0]).toBe('ADAUSDT');
  expect(result.current?.[0]?.ticker?.quoteVolume).toBe(90);
  expect(result.current?.[1]?.ticker).toBeUndefined();
});

function setTicker(
  controller: { set: (...args: any[]) => Promise<void> },
  value: object,
) {
  return actWrite(() => controller.set(Ticker, { symbol: 'BTCUSDT' }, value));
}

it('filters on this phone and keeps a halted symbol out of the default list', () => {
  const searched = {
    symbols: [
      ...exchange.symbols,
      symbol('ETHFIUSDT', 'ETHFI', 'USDT'),
      symbol('ETHBTC', 'ETH', 'BTC'),
      symbol('LUNAUSDT', 'LUNA', 'USDT', 'BREAK'),
    ],
  };
  const searchedTickers = [
    ...tickers,
    ticker('ETHFIUSDT', '2', '2', '1', 1_000),
    ticker('ETHBTC', '0.05', '0.04', '3', 1_000),
  ];
  const { result } = renderDataHook(
    () => ({
      eth: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const, q: 'eth' }),
      ethUpper: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const, q: ' ETH ' }),
      ethName: useQuery(getMarkets, { quote: 'USDT', sort: 'name' as const, q: 'eth' }),
      ethChange: useQuery(getMarkets, { quote: 'USDT', sort: 'change' as const, q: 'eth' }),
      symbolMatch: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const, q: 'tcus' }),
      sol: useQuery(getMarkets, { quote: 'USDT', sort: 'name' as const, q: 'sol' }),
      luna: useQuery(getMarkets, { quote: 'USDT', q: 'luna' }),
      none: useQuery(getMarkets, { quote: 'USDT', q: 'zzzz' }),
      cleared: useQuery(getMarkets, { quote: 'USDT', sort: 'volume' as const, q: '' }),
      usdc: useQuery(getMarkets, { quote: 'USDC', sort: 'volume' as const, q: 'eth' }),
    }),
    {
      initialFixtures: [
        { endpoint: getExchangeInfo, args: [], response: searched },
        { endpoint: getTickers, args: [], response: searchedTickers },
      ],
    },
  );

  expect(ids(result.current.eth)).toEqual(['ETHUSDT', 'ETHFIUSDT']);
  expect(ids(result.current.ethUpper)).toEqual(['ETHUSDT', 'ETHFIUSDT']);
  expect(ids(result.current.ethName)).toEqual(['ETHUSDT', 'ETHFIUSDT']);
  expect(ids(result.current.ethChange)).toEqual(['ETHUSDT', 'ETHFIUSDT']);
  expect(ids(result.current.symbolMatch)).toEqual(['BTCUSDT']);
  expect(ids(result.current.sol)).toEqual(['SOLUSDT']);
  expect(result.current.sol?.[0]?.status).toBe('HALT');
  expect(result.current.luna?.[0]?.status).toBe('BREAK');
  expect(ids(result.current.none)).toEqual([]);
  expect(ids(result.current.cleared)).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'ETHFIUSDT']);
  expect(ids(result.current.cleared)).not.toContain('SOLUSDT');
  expect(ids(result.current.cleared)).not.toContain('LUNAUSDT');
  expect(ids(result.current.usdc)).toEqual([]);
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
