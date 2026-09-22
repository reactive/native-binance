import { Entity, RestEndpoint } from '@data-client/rest';

import { BINANCE_REST, binanceGetInit } from './hosts';

type Filter = {
  filterType?: string;
  tickSize?: string;
  stepSize?: string;
  minNotional?: string;
};

function filterField(filters: unknown, type: string, field: keyof Filter): string {
  if (!Array.isArray(filters)) return '';
  for (const item of filters) {
    if (!item || typeof item !== 'object') continue;
    const filter = item as Filter;
    if (filter.filterType !== type) continue;
    const value = filter[field];
    if (value != null && value !== '') return String(value);
  }
  return '';
}

/** Spot symbol from `GET /exchangeInfo`. Filters are flattened so screens never walk them. */
export class MarketSymbol extends Entity {
  symbol = '';
  status = '';
  baseAsset = '';
  quoteAsset = '';
  tickSize = '';
  stepSize = '';
  minNotional = '';

  pk(): string {
    return this.symbol;
  }

  static key = 'Symbol';

  static process(input: {
    symbol?: string;
    status?: string;
    baseAsset?: string;
    quoteAsset?: string;
    filters?: unknown;
  }) {
    const symbol = String(input.symbol ?? '').toUpperCase();
    if (!symbol) throw new Error('Invalid symbol');
    return {
      symbol,
      status: String(input.status ?? ''),
      baseAsset: String(input.baseAsset ?? ''),
      quoteAsset: String(input.quoteAsset ?? ''),
      tickSize: filterField(input.filters, 'PRICE_FILTER', 'tickSize'),
      stepSize: filterField(input.filters, 'LOT_SIZE', 'stepSize'),
      minNotional:
        filterField(input.filters, 'NOTIONAL', 'minNotional') ||
        filterField(input.filters, 'MIN_NOTIONAL', 'minNotional'),
    };
  }
}

export const getExchangeInfo = new RestEndpoint({
  urlPrefix: BINANCE_REST,
  path: '/exchangeInfo',
  schema: { symbols: [MarketSymbol] },
  getRequestInit: binanceGetInit,
  process(response: { symbols?: unknown }) {
    const symbols = Array.isArray(response?.symbols) ? response.symbols : [];
    return {
      symbols: symbols.filter(
        item =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as { symbol?: unknown }).symbol === 'string',
      ),
    };
  },
});
