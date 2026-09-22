import { BINANCE_STREAM } from './hosts';

export const TICKER_STREAM = `${BINANCE_STREAM}/!miniTicker@arr`;

export function depthStream(symbol: string): string {
  return `${BINANCE_STREAM}/${symbol.toLowerCase()}@depth@100ms`;
}

export function tradeStream(symbol: string): string {
  return `${BINANCE_STREAM}/${symbol.toLowerCase()}@aggTrade`;
}

export function klineStream(symbol: string, interval: string): string {
  return `${BINANCE_STREAM}/${symbol.toLowerCase()}@kline_${interval}`;
}
