import { Collection, Entity, RestEndpoint } from '@data-client/rest';

import { BINANCE_REST, binanceGetInit, keepLastRead } from './hosts';

export const INTERVALS = [
  { label: '1m', value: '1m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1D', value: '1d' },
] as const;

export type CandleInterval = (typeof INTERVALS)[number]['value'];

export const CANDLE_LIMIT = 60;

const INTERVAL_VALUES: ReadonlySet<string> = new Set(INTERVALS.map(item => item.value));

export function isCandleInterval(value: string): value is CandleInterval {
  return INTERVAL_VALUES.has(value);
}

type CandleArgs = { symbol?: string; interval?: string };

/** One kline. `pk` includes the interval so 15m and 1h candles that open together stay distinct. */
export class Candle extends Entity {
  symbol = '';
  interval = '';
  openTime = 0;
  open = 0;
  high = 0;
  low = 0;
  close = 0;
  volume = 0;
  trades = 0;

  pk(): string {
    return `${this.symbol}:${this.interval}:${this.openTime}`;
  }

  static key = 'Candle';

  static schema = {
    open: Number,
    high: Number,
    low: Number,
    close: Number,
    volume: Number,
  };

  /** A forming candle's trade count only grows. An older `/klines` row must not replace a newer push. */
  static shouldUpdate(
    _existingMeta: { date: number; fetchedAt: number },
    _incomingMeta: { date: number; fetchedAt: number },
    existing: { trades: number },
    incoming: { trades: number },
  ) {
    return incoming.trades >= existing.trades;
  }

  static process(input: unknown, _parent: unknown, _key: string | undefined, args: any[]) {
    const arg = args?.[0] as CandleArgs | undefined;
    const symbol = String(arg?.symbol ?? '');
    const interval = String(arg?.interval ?? '');
    if (Array.isArray(input)) {
      return {
        symbol,
        interval,
        openTime: input[0],
        open: input[1],
        high: input[2],
        low: input[3],
        close: input[4],
        volume: input[5],
        trades: input[8],
      };
    }
    const candle = (input ?? {}) as {
      t?: number;
      o?: string;
      h?: string;
      l?: string;
      c?: string;
      v?: string;
      n?: number;
    };
    return {
      symbol,
      interval,
      openTime: candle.t,
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      volume: candle.v,
      trades: candle.n,
    };
  }
}

export const CandleList = new Collection([Candle], {
  argsKey: ({ symbol, interval }: { symbol: string; interval: CandleInterval }) => ({
    symbol,
    interval,
  }),
});

/** Same open time merges the entity in place; a new open time appends. Keeps the newest CANDLE_LIMIT. */
export const upsertCandle = CandleList.addWith((existing: string[], incoming: string[]) => {
  const added = incoming.filter(id => !existing.includes(id));
  if (added.length === 0) return existing;
  return [...existing, ...added].slice(-CANDLE_LIMIT);
});

export const getCandles = new RestEndpoint({
  urlPrefix: BINANCE_REST,
  path: '/klines',
  searchParams: {} as { symbol: string; interval: CandleInterval },
  schema: CandleList,
  getRequestInit: binanceGetInit,
  errorPolicy: keepLastRead,
  searchToString(params: Record<string, unknown>) {
    return new URLSearchParams({
      symbol: String(params.symbol ?? ''),
      interval: String(params.interval ?? ''),
      limit: String(CANDLE_LIMIT),
    }).toString();
  },
});
