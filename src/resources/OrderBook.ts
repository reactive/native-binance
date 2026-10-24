import { Entity } from '@data-client/rest';

import { VisionEndpoint } from './hosts';

export type Level = [price: number, qty: number];

const BOOK_LIMIT = 100;
/**
 * Levels kept per side. Diffs only carry changed levels, so a dropped level that is still live
 * never comes back; ten snapshots deep leaves room for price to walk before the book thins out.
 */
export const BOOK_DEPTH = BOOK_LIMIT * 10;

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

/**
 * Applies a diff and keeps the `BOOK_DEPTH` levels nearest the spread. The diff stream covers the
 * whole book, so without a bound every level it ever touched would pile up and be re-sorted.
 * Unchanged levels keep their tuples, so a diff allocates only what it changed.
 */
function mergeLevels(
  levels: readonly Level[],
  updates: readonly Level[],
  descending: boolean,
): Level[] {
  if (!updates.length) return levels as Level[];
  // A full side ignores new levels past its deepest one, so a diff out there keeps the same array.
  const deepest = levels.length >= BOOK_DEPTH ? levels[BOOK_DEPTH - 1][0] : undefined;
  const pastDeepest = (price: number) =>
    deepest !== undefined && (descending ? price < deepest : price > deepest);
  const byPrice = new Map<number, Level>();
  for (const level of levels) byPrice.set(level[0], level);
  let changed = false;
  for (const update of updates) {
    const [price, qty] = update;
    if (qty === 0) {
      if (byPrice.delete(price)) changed = true;
    } else if (byPrice.get(price)?.[1] !== qty && !pastDeepest(price)) {
      byPrice.set(price, update);
      changed = true;
    }
  }
  if (!changed) return levels as Level[];
  const next = Array.from(byPrice.values());
  next.sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]));
  if (next.length > BOOK_DEPTH) next.length = BOOK_DEPTH;
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
