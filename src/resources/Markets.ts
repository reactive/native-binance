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
  /**
   * Search every quote and ignore `quote`. An empty query returns no rows,
   * because this path has no chip to list.
   */
  allQuotes?: boolean;
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
  const everyQuote = arg?.allQuotes === true;
  if (everyQuote && !q) return [];
  const rows: MarketSymbol[] = [];
  for (const symbol of symbols) {
    if (!matchesQuery(symbol, q)) continue;
    if (!everyQuote && symbol.quoteAsset !== quote) continue;
    // Halted and paused symbols stay out of the default list. A search that hits one includes it.
    if (!q && symbol.status !== 'TRADING') continue;
    rows.push(symbol);
  }
  rows.sort((a, b) => compareMarket(a, b, sort));
  return rows;
}

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
