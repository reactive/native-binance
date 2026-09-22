import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { getCandles, isCandleInterval, upsertCandle, type CandleInterval } from './Candle';
import { LiveSocket } from './LiveSocket';
import { streamStatus, type StreamStatus } from './streamStatus';
import { klineStream } from './streams';

function streamKey(symbol: string, interval: string) {
  return `${symbol}@${interval}`;
}

function argsOf(
  args: readonly unknown[] | undefined,
): { symbol: string; interval: CandleInterval } | undefined {
  const arg = args?.[0];
  if (!arg || typeof arg !== 'object') return;
  const record = arg as { symbol?: unknown; interval?: unknown };
  if (typeof record.symbol !== 'string' || typeof record.interval !== 'string') return;
  if (!isCandleInterval(record.interval)) return;
  const symbol = record.symbol.toUpperCase();
  if (!symbol) return;
  return { symbol, interval: record.interval };
}

/** `k` from a `<symbol>@kline_<interval>` message, when it belongs to this socket. */
function readKline(data: unknown, symbol: string, interval: string): object | undefined {
  let msg: unknown = data;
  if (typeof data === 'string') {
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
  }
  if (!msg || typeof msg !== 'object') return;
  const record = msg as { e?: unknown; k?: unknown };
  if (record.e !== 'kline' || !record.k || typeof record.k !== 'object') return;
  const candle = record.k as { s?: unknown; i?: unknown };
  if (candle.s !== symbol || candle.i !== interval) return;
  return record.k;
}

/** Keeps one `{ symbol, interval }` candle list current from Binance klines. */
export default class CandleStream implements Manager {
  protected controller: Controller = new Controller();
  private readonly counts = new Map<string, number>();
  private readonly sockets = new Map<string, LiveSocket>();

  constructor(private readonly status: StreamStatus = streamStatus) {}

  middleware: Middleware = controller => {
    this.controller = controller;
    return next => async action => {
      if (
        action.type !== actionTypes.SUBSCRIBE &&
        action.type !== actionTypes.UNSUBSCRIBE
      ) {
        return next(action);
      }
      if (action.endpoint !== getCandles) return next(action);
      const args = argsOf(action.args);
      if (args) {
        if (action.type === actionTypes.SUBSCRIBE) this.subscribe(args.symbol, args.interval);
        else this.unsubscribe(args.symbol, args.interval);
      }
      return Promise.resolve();
    };
  };

  cleanup() {
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.counts.clear();
  }

  private subscribe(symbol: string, interval: CandleInterval) {
    const key = streamKey(symbol, interval);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count > 1) return;
    this.connect(symbol, interval);
  }

  private unsubscribe(symbol: string, interval: CandleInterval) {
    const key = streamKey(symbol, interval);
    const count = (this.counts.get(key) ?? 0) - 1;
    if (count > 0) {
      this.counts.set(key, count);
      return;
    }
    this.counts.delete(key);
    this.disconnect(key);
  }

  private disconnect(key: string) {
    const socket = this.sockets.get(key);
    this.sockets.delete(key);
    socket?.close();
  }

  private connect(symbol: string, interval: CandleInterval) {
    const key = streamKey(symbol, interval);
    const socket = new LiveSocket({
      url: klineStream(symbol, interval),
      status: this.status,
      onMessage: data => {
        const candle = readKline(data, symbol, interval);
        if (!candle) return;
        void this.controller.set(upsertCandle, { symbol, interval }, [candle]);
      },
      onOpen: reopened => {
        if (!reopened) return;
        void Promise.resolve(this.controller.fetch(getCandles, { symbol, interval })).catch(
          () => {},
        );
      },
    });
    this.sockets.set(key, socket);
  }
}
