import { Collection, Entity } from '@data-client/rest';

import { VisionEndpoint } from './hosts';

export const TAPE_LIMIT = 100;

/** One aggregate trade. REST and `@aggTrade` share these keys. `m`: buyer is the maker. */
export class Trade extends Entity {
  s = '';
  a = 0;
  p = 0;
  q = 0;
  T = 0;
  m = false;

  pk(_parent?: unknown, _key?: string, args?: readonly { symbol?: string }[]): string {
    return `${(args?.[0]?.symbol ?? this.s).toUpperCase()}:${this.a}`;
  }

  static key = 'Trade';

  static schema = { p: Number, q: Number };

  get price(): number {
    return this.p;
  }

  get qty(): number {
    return this.q;
  }

  get time(): number {
    return this.T;
  }

  /** The taker bought when the buyer was not the maker. */
  get takerBuy(): boolean {
    return !this.m;
  }
}

function aggIdOf(ref: string): number {
  return Number(ref.slice(ref.lastIndexOf(':') + 1));
}

function newestFirst(existing: readonly string[], incoming: readonly string[]): string[] {
  const ids = [...new Set([...incoming, ...existing])];
  ids.sort((x, y) => aggIdOf(y) - aggIdOf(x));
  return ids.slice(0, TAPE_LIMIT);
}

const tape = new Collection([Trade], {
  argsKey: ({ symbol }: { symbol: string }) => ({ symbol }),
});

/**
 * A newer snapshot unions by aggregate id. Default `fetchedAt` ordering would
 * replace the list and drop stream prints the REST page has not reached.
 * An older snapshot still loses, so a late response cannot rewind the tape.
 */
tape.mergeWithStore = (existingMeta, incomingMeta, existing, incoming) => {
  if (incomingMeta.fetchedAt < existingMeta.fetchedAt) return existing;
  return newestFirst(idsOf(existing), idsOf(incoming));
};

/** Stream writes. `controller.set(newTrades, { symbol }, events)`. */
export const newTrades = tape.addWith(newestFirst);
// `addWith` delegates `mergeWithStore` to `tape`. Sets must union even when their stamp is older.
newTrades.mergeWithStore = (_existingMeta, _incomingMeta, existing, incoming) =>
  newestFirst(idsOf(existing), idsOf(incoming));

function idsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value : [];
}

export const getTrades = new VisionEndpoint({
  path: '/aggTrades',
  searchParams: {} as { symbol: string },
  schema: tape,
  searchToString(searchParams: Record<string, unknown>) {
    return new URLSearchParams({
      symbol: String(searchParams.symbol ?? ''),
      limit: String(TAPE_LIMIT),
    }).toString();
  },
  /** Binance returns oldest first and has no order parameter. */
  process(rows: unknown) {
    return Array.isArray(rows) ? [...rows].reverse() : [];
  },
});
