import { parseLevels, type Level } from './OrderBook';

/** One Binance `@depth` diff. `U`/`u` are the first and last update ids in the event. */
export type DepthUpdate = {
  U: number;
  u: number;
  b: unknown;
  a: unknown;
};

export type BookLevels = {
  lastUpdateId: number;
  bids: Level[];
  asks: Level[];
};

/**
 * Apply diff events onto a local book.
 *
 * Binance: drop events with `u` <= snapshot `lastUpdateId`. The first applied
 * event must overlap that id (`U` <= lastUpdateId + 1). A later event with
 * `U` > previous `u` + 1 is a gap and must wait for a fresh snapshot.
 */
export function applyDepthEvents(
  book: BookLevels,
  events: readonly DepthUpdate[],
): { book: BookLevels; rest: DepthUpdate[]; gap: boolean } {
  const sorted =
    events.length > 1 ? [...events].sort((a, b) => a.U - b.U) : [...events];
  let last = book.lastUpdateId;
  let bids = book.bids;
  let asks = book.asks;

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    if (!Number.isFinite(event.U) || !Number.isFinite(event.u)) continue;
    if (event.u <= last) continue;
    if (event.U > last + 1) {
      return {
        book: { lastUpdateId: last, bids, asks },
        rest: sorted.slice(i),
        gap: true,
      };
    }
    const bidUpdates = parseLevels(event.b);
    const askUpdates = parseLevels(event.a);
    if (bidUpdates.length) bids = applySide(bids, bidUpdates, true);
    if (askUpdates.length) asks = applySide(asks, askUpdates, false);
    last = event.u;
  }

  return { book: { lastUpdateId: last, bids, asks }, rest: [], gap: false };
}

function applySide(
  levels: readonly Level[],
  updates: readonly Level[],
  descending: boolean,
): Level[] {
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
