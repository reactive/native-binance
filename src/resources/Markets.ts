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

export type MarketQuote = {
  symbol: MarketSymbol;
  ticker: Ticker | undefined;
};

const schema = {
  symbols: new All(MarketSymbol),
  tickers: new All(Ticker),
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

function compareMarket(a: MarketQuote, b: MarketQuote, sort: MarketSort): number {
  if (sort === 'name') {
    const byBase = a.symbol.baseAsset.localeCompare(b.symbol.baseAsset);
    if (byBase !== 0) return byBase;
    return a.symbol.quoteAsset.localeCompare(b.symbol.quoteAsset);
  }
  if (sort === 'change') return changeOf(b.ticker) - changeOf(a.ticker);
  return volumeOf(b.ticker) - volumeOf(a.ticker);
}

function trading(
  symbols: readonly MarketSymbol[],
  tickers: readonly Ticker[],
  arg: MarketArgs | undefined,
): MarketQuote[] {
  const { quote, sort, q } = readArgs(arg);
  const byMarketSymbol = new Map<string, Ticker>();
  for (const ticker of tickers) byMarketSymbol.set(ticker.symbol, ticker);
  const rows: MarketQuote[] = [];
  for (const symbol of symbols) {
    if (symbol.quoteAsset !== quote || !matchesQuery(symbol, q)) continue;
    // Halted and paused symbols stay out of the default list. A search that hits one includes it.
    if (!q && symbol.status !== 'TRADING') continue;
    rows.push({ symbol, ticker: byMarketSymbol.get(symbol.symbol) });
  }
  rows.sort((a, b) => compareMarket(a, b, sort));
  return rows;
}

/** `All` is invalid until that entity table exists. Names use symbols alone so the list can paint before the first ticker write. */
export const getMarkets = new Query(
  schema,
  (input: { symbols: MarketSymbol[]; tickers: Ticker[] }, arg?: MarketArgs) =>
    trading(input.symbols, input.tickers, arg),
);

export const getMarketNames = new Query(new All(MarketSymbol), (symbols: MarketSymbol[], arg?: MarketArgs) =>
  trading(symbols, [], arg),
);
