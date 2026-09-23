import { Entity } from '@data-client/rest';

import { VisionEndpoint } from './hosts';

export type Level = [price: number, qty: number];

const BOOK_LIMIT = 100;

function parseLevels(levels: unknown): Level[] {
  if (!Array.isArray(levels)) return [];
  const out: Level[] = [];
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 2) continue;
    const price = Number(level[0]);
    const qty = Number(level[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    out.push([price, qty]);
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

  /** merge() argument order follows lastUpdateId, not fetch time. */
  static shouldReorder(
    _existingMeta: { date: number; fetchedAt: number },
    _incomingMeta: { date: number; fetchedAt: number },
    existing: { lastUpdateId: number },
    incoming: { lastUpdateId: number },
  ) {
    return incoming.lastUpdateId < existing.lastUpdateId;
  }

  static merge(
    existing: { symbol: string; lastUpdateId: number; bids: Level[]; asks: Level[] },
    incoming: {
      symbol: string;
      lastUpdateId: number;
      bids: Level[];
      asks: Level[];
      firstUpdateId?: number;
    },
  ) {
    if (incoming.firstUpdateId == null) {
      return {
        symbol: incoming.symbol,
        lastUpdateId: incoming.lastUpdateId,
        bids: incoming.bids,
        asks: incoming.asks,
      };
    }
    if (incoming.firstUpdateId > existing.lastUpdateId + 1) return existing;
    return {
      symbol: existing.symbol,
      lastUpdateId: incoming.lastUpdateId,
      bids: mergeLevels(existing.bids, incoming.bids, true),
      asks: mergeLevels(existing.asks, incoming.asks, false),
    };
  }

  static process(
    input: {
      s?: string;
      lastUpdateId?: number | string;
      bids?: unknown;
      asks?: unknown;
      U?: number | string;
      u?: number | string;
      b?: unknown;
      a?: unknown;
    },
    _parent: unknown,
    _key: string | undefined,
    args: readonly { symbol?: string }[],
  ) {
    const symbol = String(args[0]?.symbol ?? input.s ?? '').toUpperCase();
    const diff = input.u != null && input.lastUpdateId == null;
    const lastUpdateId = Number(diff ? input.u : input.lastUpdateId);
    const firstUpdateId = Number(input.U);
    if (
      !symbol ||
      !Number.isFinite(lastUpdateId) ||
      (diff && !Number.isFinite(firstUpdateId))
    ) {
      throw new Error('Invalid order book payload');
    }
    return {
      symbol,
      lastUpdateId,
      ...(diff ? { firstUpdateId } : null),
      bids: parseLevels(diff ? input.b : input.bids),
      asks: parseLevels(diff ? input.a : input.asks),
    };
  }
}

function mergeLevels(
  levels: readonly Level[],
  updates: readonly Level[],
  descending: boolean,
): Level[] {
  if (!updates.length) return levels as Level[];
  const qtyAt = new Map<number, number>();
  for (const [price, qty] of levels) qtyAt.set(price, qty);
  let changed = false;
  for (const [price, qty] of updates) {
    if (qty === 0) {
      if (qtyAt.delete(price)) changed = true;
    } else if (qtyAt.get(price) !== qty) {
      qtyAt.set(price, qty);
      changed = true;
    }
  }
  if (!changed) return levels as Level[];
  const next: Level[] = Array.from(qtyAt, ([price, qty]) => [price, qty]);
  next.sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]));
  return next;
}

export const getOrderBook = new VisionEndpoint({
  path: '/depth',
  searchParams: {} as { symbol: string },
  schema: OrderBook,
  searchToString(searchParams: Record<string, unknown>) {
    return new URLSearchParams({
      symbol: String(searchParams.symbol ?? ''),
      limit: String(BOOK_LIMIT),
    }).toString();
  },
});
