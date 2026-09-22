import { Entity, RestEndpoint } from '@data-client/rest';

import { BINANCE_REST, binanceGetInit, keepLastRead } from './hosts';
import { Ticker } from './Ticker';

export type InstrumentFilters = {
  readonly tickSize: string;
  readonly stepSize: string;
  readonly minNotional: string;
  readonly pricePlaces: number | undefined;
  readonly sizePlaces: number | undefined;
};

type RawFilter = {
  filterType?: string;
  tickSize?: string;
  stepSize?: string;
  minNotional?: string;
};

/** Decimal places of a Binance tick/step string ('0.01000000' → 2, '1.00' → 0). */
export function placesOf(step: string): number | undefined {
  if (step === '') return undefined;
  const dot = step.indexOf('.');
  if (dot === -1) return 0;
  const fraction = step.slice(dot + 1).replace(/0+$/, '');
  return Math.min(8, fraction.length);
}

function filterField(
  filters: readonly unknown[],
  type: string,
  field: keyof RawFilter,
): string {
  for (const item of filters) {
    if (!item || typeof item !== 'object') continue;
    const filter = item as RawFilter;
    if (filter.filterType !== type) continue;
    const value = filter[field];
    if (value != null && value !== '') return String(value);
  }
  return '';
}

const EMPTY_FILTERS: InstrumentFilters = {
  tickSize: '',
  stepSize: '',
  minNotional: '',
  pricePlaces: undefined,
  sizePlaces: undefined,
};

/** Raw exchange-info `filters` array → the read shape. A plain function, so normalize stores the array. */
export function instrumentFilters(raw: unknown): InstrumentFilters {
  if (!Array.isArray(raw)) return EMPTY_FILTERS;
  const tickSize = filterField(raw, 'PRICE_FILTER', 'tickSize');
  const stepSize = filterField(raw, 'LOT_SIZE', 'stepSize');
  const minNotional =
    filterField(raw, 'NOTIONAL', 'minNotional') ||
    filterField(raw, 'MIN_NOTIONAL', 'minNotional');
  return {
    tickSize,
    stepSize,
    minNotional,
    pricePlaces: placesOf(tickSize),
    sizePlaces: placesOf(stepSize),
  };
}

/** Spot symbol from `GET /exchangeInfo`. Filter rules are read off `static schema`, not `process`. */
export class MarketSymbol extends Entity {
  symbol = '';
  status = '';
  baseAsset = '';
  quoteAsset = '';
  filters: InstrumentFilters = EMPTY_FILTERS;
  ticker: Ticker | undefined = undefined;

  pk(): string {
    return this.symbol;
  }

  static key = 'Symbol';

  static schema = {
    filters: instrumentFilters,
    ticker: Ticker,
  };

  /** Copy the symbol id onto `ticker` so a later ticker write joins here. */
  static process(input: { symbol?: string }) {
    const symbol = String(input.symbol ?? '').toUpperCase();
    if (!symbol) throw new Error('Invalid symbol');
    return { ...input, symbol, ticker: symbol };
  }

  get tickSize(): string {
    return this.filters.tickSize;
  }

  get stepSize(): string {
    return this.filters.stepSize;
  }

  get minNotional(): string {
    return this.filters.minNotional;
  }

  get pricePlaces(): number | undefined {
    return this.filters.pricePlaces;
  }

  get sizePlaces(): number | undefined {
    return this.filters.sizePlaces;
  }
}

export const getExchangeInfo = new RestEndpoint({
  urlPrefix: BINANCE_REST,
  path: '/exchangeInfo',
  schema: { symbols: [MarketSymbol] },
  getRequestInit: binanceGetInit,
  errorPolicy: keepLastRead,
  dataExpiryLength: Infinity,
  url() {
    return `${RestEndpoint.prototype.url.call(this)}?showPermissionSets=false`;
  },
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
