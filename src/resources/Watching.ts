import { Collection, Endpoint, Entity } from '@data-client/rest';

import { readWatched, writeWatched } from './watchStorage';

/** A symbol this phone is watching. Not a `MarketSymbol`: rehydrate must not invent blank markets. */
export class WatchedSymbol extends Entity {
  symbol = '';

  pk(): string {
    return this.symbol;
  }

  static key = 'Watch';
}

/** One list per device. `argsKey` ignores args, so the markets query and both endpoints share it. */
export const WatchList = new Collection([WatchedSymbol], {
  argsKey: () => ({}),
});

/** Rehydrate from this phone, not from Binance. */
export const getWatching = new Endpoint(
  () => {
    const rows = readWatched().map(symbol => ({ symbol }));
    // A microtask during the first render of a lazy route is dropped: React warns
    // that the store updated a component that has not mounted, and the star stays
    // on its fallback. A timer settles after that commit.
    return new Promise<typeof rows>(resolve => {
      setTimeout(() => resolve(rows), 0);
    });
  },
  { name: 'getWatching', schema: WatchList, dataExpiryLength: Infinity },
);

/**
 * Takes the desired state, not a toggle, so a double tap sends the same value twice.
 * The read, edit, and write finish before the promise, so two calls cannot interleave.
 */
export const setWatched = new Endpoint(
  ({ symbol, watched }: { symbol: string; watched: boolean }) => {
    const current = readWatched();
    const next =
      watched ?
        current.includes(symbol) ? current
        : [...current, symbol]
      : current.filter(id => id !== symbol);
    writeWatched(next);
    return Promise.resolve(next.map(id => ({ symbol: id })));
  },
  { name: 'setWatched', schema: WatchList, sideEffect: true },
);
