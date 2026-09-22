import { All, Query } from '@data-client/rest';

import { MarketSymbol } from './Symbol';
import { Ticker } from './Ticker';

export type MarketSort = 'volume' | 'change' | 'name';

export type MarketArgs = {
  quote?: string;
  /** Case-insensitive match against base, quote, or the concatenated symbol. */
  q?: string;
  sort?: MarketSort;
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

/** Names paint from `All(MarketSymbol)` while `ticker` is still undefined. */
export const getMarkets = new Query(new All(MarketSymbol), (symbols: MarketSymbol[], arg?: MarketArgs) =>
  trading(symbols, arg),
);
