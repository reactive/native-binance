import { All, Query } from '@data-client/rest';

import { MarketSymbol } from './Symbol';
import { Ticker } from './Ticker';

export type MarketSort = 'volume' | 'change' | 'name';

export type MarketArgs = {
  quote?: string;
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

function readArgs(arg: MarketArgs | undefined): { quote: string; sort: MarketSort } {
  return {
    quote: arg?.quote ?? 'USDT',
    sort: arg?.sort ?? 'volume',
  };
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
  const { quote, sort } = readArgs(arg);
  const byMarketSymbol = new Map<string, Ticker>();
  for (const ticker of tickers) byMarketSymbol.set(ticker.symbol, ticker);
  const rows: MarketQuote[] = [];
  for (const symbol of symbols) {
    if (symbol.status !== 'TRADING' || symbol.quoteAsset !== quote) continue;
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
  trading(symbols, [], { quote: arg?.quote }),
);
