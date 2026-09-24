import { All, Query } from '@data-client/rest';

import { MarketSymbol } from './Symbol';
import { Ticker } from './Ticker';
import { WatchList } from './Watching';

export type MarketSort = 'volume' | 'change' | 'name';

export type MarketArgs = {
  quote?: string;
  /** Case-insensitive match against base, quote, or the concatenated symbol. */
  q?: string;
  sort?: MarketSort;
  /** When true, list the device watch set. Any other value keeps the trading list. */
  watching?: boolean;
};

function readArgs(arg: MarketArgs | undefined): { quote: string; sort: MarketSort; q: string } {
  return {
    quote: arg?.quote ?? 'USDT',
    sort: arg?.sort ?? 'volume',
    q: arg?.q?.trim().toLowerCase() ?? '',
  };
}

function matchesQuery(symbol: MarketSymbol, q: string): boolean {
  if (!q) return true;
  // The id is base + quote, so one includes covers base, quote, and the pair.
  return symbol.symbol.toLowerCase().includes(q);
}

function changeOf(ticker: Ticker | undefined): number {
  return ticker ? ticker.percent : Number.NEGATIVE_INFINITY;
}

function volumeOf(ticker: Ticker | undefined): number {
  return ticker ? ticker.quoteVolume : Number.NEGATIVE_INFINITY;
}

function compareMarket(a: MarketSymbol, b: MarketSymbol, sort: MarketSort): number {
  if (sort === 'name') {
    const byBase = a.baseAsset.localeCompare(b.baseAsset);
    if (byBase !== 0) return byBase;
    return a.quoteAsset.localeCompare(b.quoteAsset);
  }
  if (sort === 'change') return changeOf(b.ticker) - changeOf(a.ticker);
  return volumeOf(b.ticker) - volumeOf(a.ticker);
}

function watched(
  symbols: readonly MarketSymbol[],
  watching: readonly { symbol: string }[],
  arg: MarketArgs | undefined,
): MarketSymbol[] {
  const { sort, q } = readArgs(arg);
  const ids = new Set<string>();
  for (const item of watching) ids.add(item.symbol);
  const rows: MarketSymbol[] = [];
  for (const symbol of symbols) {
    if (!ids.has(symbol.symbol) || !matchesQuery(symbol, q)) continue;
    rows.push(symbol);
  }
  rows.sort((a, b) => compareMarket(a, b, sort));
  return rows;
}

function trading(symbols: readonly MarketSymbol[], arg: MarketArgs | undefined): MarketSymbol[] {
  const { quote, sort, q } = readArgs(arg);
  const rows: MarketSymbol[] = [];
  for (const symbol of symbols) {
    if (symbol.quoteAsset !== quote || !matchesQuery(symbol, q)) continue;
    // Halted and paused symbols stay out of the default list. A search that hits one includes it.
    if (!q && symbol.status !== 'TRADING') continue;
    rows.push(symbol);
  }
  rows.sort((a, b) => compareMarket(a, b, sort));
  return rows;
}

/** Quote chips on Markets, in order. Search ranks pairs in these quotes first. */
export const MARKET_QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH'] as const;

/** Letters and digits only, so `eth/usdt` and `ETH USDT` both find `ETHUSDT`. */
export function searchKey(q: string | undefined): string {
  return (q ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function rankOf(symbol: MarketSymbol, q: string): number {
  const id = symbol.symbol.toLowerCase();
  if (id === q) return 0;
  if (symbol.baseAsset.toLowerCase().startsWith(q)) return 1;
  if (id.startsWith(q)) return 2;
  return 3;
}

function quoteRank(symbol: MarketSymbol): number {
  const index = (MARKET_QUOTES as readonly string[]).indexOf(symbol.quoteAsset);
  return index === -1 ? MARKET_QUOTES.length : index;
}

/**
 * Every quote, halted symbols included. An exact pair leads, then base-asset prefixes,
 * then a symbol prefix, then any other match. Within each, trading before halted, then
 * quote chip order, then quote volume. Volume only compares within one quote, since
 * `25.6B BIDR` is not larger than `1.84B USDT`. An empty query matches nothing.
 */
export const findSymbols = new Query(
  new All(MarketSymbol),
  (symbols: MarketSymbol[], arg?: { q?: string }) => {
    const q = searchKey(arg?.q);
    if (!q) return [];
    const hits: { symbol: MarketSymbol; rank: number }[] = [];
    for (const symbol of symbols) {
      if (!symbol.symbol.toLowerCase().includes(q)) continue;
      hits.push({ symbol, rank: rankOf(symbol, q) });
    }
    hits.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const halted = Number(a.symbol.status !== 'TRADING') - Number(b.symbol.status !== 'TRADING');
      if (halted !== 0) return halted;
      const quote = quoteRank(a.symbol) - quoteRank(b.symbol);
      if (quote !== 0) return quote;
      if (a.symbol.quoteAsset !== b.symbol.quoteAsset) {
        return a.symbol.quoteAsset.localeCompare(b.symbol.quoteAsset);
      }
      const va = volumeOf(a.symbol.ticker);
      const vb = volumeOf(b.symbol.ticker);
      return va === vb ? 0 : vb - va;
    });
    return hits.map(hit => hit.symbol);
  },
);

/** Names paint from `All(MarketSymbol)` while `ticker` is still undefined. */
export const getMarkets = new Query(
  { symbols: new All(MarketSymbol), watching: WatchList },
  (
    { symbols, watching }: { symbols: MarketSymbol[]; watching?: readonly { symbol: string }[] },
    arg?: MarketArgs,
  ) =>
    // Branch on the flag. Once the collection is loaded, `watching` is a list for every args object.
    arg?.watching === true ? watched(symbols, watching ?? [], arg) : trading(symbols, arg),
);
