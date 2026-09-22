import { Entity, RestEndpoint } from '@data-client/rest';

import { BINANCE_REST, binanceGetInit } from './hosts';

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

type TickerInput = {
  symbol?: string;
  s?: string;
  e?: string;
  lastPrice?: unknown;
  openPrice?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
  volume?: unknown;
  quoteVolume?: unknown;
  closeTime?: unknown;
  c?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  v?: unknown;
  q?: unknown;
  E?: unknown;
};

function isMini(input: TickerInput): boolean {
  return input.e === '24hrMiniTicker' || (input.c != null && input.lastPrice == null);
}

/** 24h ticker. Percent is `(last − open) / open`. An older event time does not replace `last`. */
export class Ticker extends Entity {
  symbol = '';
  last = 0;
  open = 0;
  high = 0;
  low = 0;
  volume = 0;
  quoteVolume = 0;
  eventTime = 0;

  pk(): string {
    return this.symbol;
  }

  static key = 'Ticker';

  get percent(): number {
    if (!this.open) return 0;
    return (this.last - this.open) / this.open;
  }

  static shouldUpdate(
    _existingMeta: { date: number; fetchedAt: number },
    _incomingMeta: { date: number; fetchedAt: number },
    existing: { eventTime: number },
    incoming: { eventTime: number },
  ) {
    return incoming.eventTime >= existing.eventTime;
  }

  static process(input: TickerInput) {
    if (!input || typeof input !== 'object') throw new Error('Invalid ticker');
    const mini = isMini(input);
    const symbol = String(mini ? input.s : input.symbol ?? '').toUpperCase();
    if (!symbol) throw new Error('Invalid ticker');
    if (mini) {
      return {
        symbol,
        last: num(input.c),
        open: num(input.o),
        high: num(input.h),
        low: num(input.l),
        volume: num(input.v),
        quoteVolume: num(input.q),
        eventTime: num(input.E),
      };
    }
    return {
      symbol,
      last: num(input.lastPrice),
      open: num(input.openPrice),
      high: num(input.highPrice),
      low: num(input.lowPrice),
      volume: num(input.volume),
      quoteVolume: num(input.quoteVolume),
      eventTime: num(input.closeTime),
    };
  }
}

export const getTickers = new RestEndpoint({
  urlPrefix: BINANCE_REST,
  path: '/ticker/24hr',
  schema: [Ticker],
  getRequestInit: binanceGetInit,
});
