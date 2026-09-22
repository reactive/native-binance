import { useQuery } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import { getExchangeInfo, MarketSymbol, placesOf } from './Symbol';

function symbol(
  name: string,
  base: string,
  quote: string,
  filters: object[],
  status = 'TRADING',
) {
  return { symbol: name, status, baseAsset: base, quoteAsset: quote, filters };
}

const exchange = {
  symbols: [
    symbol('BTCUSDT', 'BTC', 'USDT', [
      { filterType: 'PRICE_FILTER', tickSize: '0.01000000', minPrice: '0.01' },
      { filterType: 'LOT_SIZE', stepSize: '0.00001000', minQty: '0.00001' },
      { filterType: 'NOTIONAL', minNotional: '5.00000000' },
    ]),
    symbol('DOGEUSDT', 'DOGE', 'USDT', [
      { filterType: 'PRICE_FILTER', tickSize: '0.00001000' },
      { filterType: 'LOT_SIZE', stepSize: '1.00000000' },
      { filterType: 'NOTIONAL', minNotional: '1.00000000' },
    ]),
    symbol('SHIBUSDT', 'SHIB', 'USDT', [
      { filterType: 'PRICE_FILTER', tickSize: '0.00000001' },
      { filterType: 'LOT_SIZE', stepSize: '1.00' },
      { filterType: 'NOTIONAL', minNotional: '1.00000000' },
    ]),
    symbol('BNBBTC', 'BNB', 'BTC', [
      { filterType: 'PRICE_FILTER', tickSize: '0.00001000' },
      { filterType: 'LOT_SIZE', stepSize: '0.00010000' },
      { filterType: 'MIN_NOTIONAL', minNotional: '0.00010000' },
    ]),
    symbol('NOPRICE', 'NO', 'PRICE', [
      { filterType: 'LOT_SIZE', stepSize: '0.00100000' },
      { filterType: 'NOTIONAL', minNotional: '1.00000000' },
    ]),
  ],
};

const fixtures = [{ endpoint: getExchangeInfo, args: [], response: exchange }];

function useSymbols() {
  return {
    btc: useQuery(MarketSymbol, { symbol: 'BTCUSDT' }),
    doge: useQuery(MarketSymbol, { symbol: 'DOGEUSDT' }),
    shib: useQuery(MarketSymbol, { symbol: 'SHIBUSDT' }),
    bnb: useQuery(MarketSymbol, { symbol: 'BNBBTC' }),
    noPrice: useQuery(MarketSymbol, { symbol: 'NOPRICE' }),
  };
}

it('reads tick, step, and places from the filters schema', () => {
  const { result } = renderDataHook(() => useSymbols(), { initialFixtures: fixtures });

  expect(result.current.btc?.tickSize).toBe('0.01000000');
  expect(result.current.btc?.stepSize).toBe('0.00001000');
  expect(result.current.btc?.minNotional).toBe('5.00000000');
  expect(result.current.btc?.pricePlaces).toBe(2);
  expect(result.current.btc?.sizePlaces).toBe(5);

  expect(result.current.doge?.pricePlaces).toBe(5);
  expect(result.current.doge?.sizePlaces).toBe(0);
  expect(result.current.shib?.pricePlaces).toBe(8);
  expect(result.current.shib?.sizePlaces).toBe(0);
});

it('fills minNotional from MIN_NOTIONAL when NOTIONAL is absent', () => {
  const { result } = renderDataHook(() => useSymbols(), { initialFixtures: fixtures });
  expect(result.current.bnb?.minNotional).toBe('0.00010000');
  expect(result.current.bnb?.pricePlaces).toBe(5);
  expect(result.current.bnb?.sizePlaces).toBe(4);
});

it('leaves price places unset when PRICE_FILTER is missing', () => {
  const { result } = renderDataHook(() => useSymbols(), { initialFixtures: fixtures });
  expect(result.current.noPrice?.pricePlaces).toBeUndefined();
  expect(result.current.noPrice?.tickSize).toBe('');
  expect(result.current.noPrice?.sizePlaces).toBe(3);
});

it('keeps the stored symbol raw', () => {
  const { controller } = renderDataHook(() => useSymbols(), { initialFixtures: fixtures });
  const stored = controller.getState().entities.Symbol?.BTCUSDT as
    | { filters?: { tickSize?: string }[]; ticker?: unknown }
    | undefined;
  if (!stored) throw new Error('missing BTCUSDT');
  expect(Array.isArray(stored.filters)).toBe(true);
  expect('tickSize' in stored).toBe(false);
  expect(stored.filters?.[0]?.tickSize).toBe('0.01000000');
  expect(stored.ticker).toBe('BTCUSDT');
});

it('asks exchange info to skip permission sets', () => {
  expect(getExchangeInfo.url()).toMatch(/\/exchangeInfo\?showPermissionSets=false$/);
});

it('counts tick places without a float', () => {
  expect(placesOf('0.01000000')).toBe(2);
  expect(placesOf('1.00')).toBe(0);
  expect(placesOf('1')).toBe(0);
  expect(placesOf('')).toBeUndefined();
  expect(placesOf('0.000000001')).toBe(8);
});
