import { Entity } from '@data-client/rest';

import { VisionEndpoint } from './hosts';

type TickerInput = {
  symbol?: string;
  s?: string;
  e?: string;
  lastPrice?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  volume?: string;
  quoteVolume?: string;
  closeTime?: number;
  c?: string;
  o?: string;
  h?: string;
  l?: string;
  v?: string;
  q?: string;
  E?: number;
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

  static schema = {
    last: Number,
    open: Number,
    high: Number,
    low: Number,
    volume: Number,
    quoteVolume: Number,
  };

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

  /** A snapshot can resolve after a newer socket write and still carry the later close. */
  static shouldReorder(
    _existingMeta: { date: number; fetchedAt: number },
    _incomingMeta: { date: number; fetchedAt: number },
    existing: { eventTime: number },
    incoming: { eventTime: number },
  ) {
    return incoming.eventTime < existing.eventTime;
  }

  static process(input: TickerInput) {
    if (!input || typeof input !== 'object') throw new Error('Invalid ticker');
    const mini = isMini(input);
    const symbol = String(mini ? input.s : input.symbol ?? '').toUpperCase();
    if (!symbol) throw new Error('Invalid ticker');
    return {
      symbol,
      last: mini ? input.c : input.lastPrice,
      open: mini ? input.o : input.openPrice,
      high: mini ? input.h : input.highPrice,
      low: mini ? input.l : input.lowPrice,
      volume: mini ? input.v : input.volume,
      quoteVolume: mini ? input.q : input.quoteVolume,
      eventTime: mini ? input.E ?? 0 : input.closeTime ?? 0,
    };
  }
}

export const getTickers = new VisionEndpoint({
  path: '/ticker/24hr',
  schema: [Ticker],
});
