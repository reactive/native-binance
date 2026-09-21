import { Entity, RestEndpoint } from '@data-client/rest';

import { BINANCE_REST, binanceGetInit } from './binance';

export type Level = [price: number, qty: number];

const BOOK_LIMIT = 100;

function parseLevel(level: unknown): Level | undefined {
  if (!Array.isArray(level) || level.length < 2) return undefined;
  const price = Number(level[0]);
  const qty = Number(level[1]);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return undefined;
  return [price, qty];
}

function parseLevels(levels: unknown): Level[] {
  if (!Array.isArray(levels)) return [];
  const out: Level[] = [];
  for (const level of levels) {
    const parsed = parseLevel(level);
    if (parsed) out.push(parsed);
  }
  return out;
}

export class OrderBook extends Entity {
  symbol = '';
  lastUpdateId = 0;
  bids: Level[] = [];
  asks: Level[] = [];

  pk(): string {
    return this.symbol;
  }

  static key = 'OrderBook';

  get bestBid(): number {
    return this.bids[0]?.[0] ?? 0;
  }

  get bestAsk(): number {
    return this.asks[0]?.[0] ?? 0;
  }

  get spread(): number {
    return this.bestAsk - this.bestBid;
  }

  get midPrice(): number {
    return (this.bestAsk + this.bestBid) / 2;
  }

  static shouldUpdate(
    _existingMeta: { date: number; fetchedAt: number },
    _incomingMeta: { date: number; fetchedAt: number },
    existing: { lastUpdateId: number },
    incoming: { lastUpdateId: number },
  ) {
    return incoming.lastUpdateId >= existing.lastUpdateId;
  }

  static process(
    input: {
      lastUpdateId?: number | string;
      bids?: unknown;
      asks?: unknown;
    },
    _parent: unknown,
    _key: string | undefined,
    args: readonly { symbol?: string }[],
  ) {
    const symbol = String(args[0]?.symbol ?? '').toUpperCase();
    const lastUpdateId = Number(input.lastUpdateId);
    if (!symbol || !Number.isFinite(lastUpdateId)) {
      throw new Error('Invalid order book payload');
    }
    return {
      symbol,
      lastUpdateId,
      bids: parseLevels(input.bids),
      asks: parseLevels(input.asks),
    };
  }
}

export const getOrderBook = new RestEndpoint({
  urlPrefix: BINANCE_REST,
  path: '/depth',
  searchParams: {} as { symbol: string },
  schema: OrderBook,
  getRequestInit: binanceGetInit,
  searchToString(searchParams: Record<string, unknown>) {
    return new URLSearchParams({
      symbol: String(searchParams.symbol ?? ''),
      limit: String(BOOK_LIMIT),
    }).toString();
  },
});
