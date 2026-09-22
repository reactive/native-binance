import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { getCandles, isCandleInterval, upsertCandle, type CandleInterval } from './Candle';
import { BINANCE_STREAM } from './hosts';

function streamKey(symbol: string, interval: string) {
  return `${symbol}@${interval}`;
}

function streamUrl(symbol: string, interval: string) {
  return `${BINANCE_STREAM}/${symbol.toLowerCase()}@kline_${interval}`;
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
  private readonly sockets = new Map<string, WebSocket>();
  private readonly generation = new Map<string, number>();
  private readonly attempts = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

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
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const key of this.sockets.keys()) this.bump(key);
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.counts.clear();
  }

  private subscribe(symbol: string, interval: CandleInterval) {
    const key = streamKey(symbol, interval);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count > 1) return;
    this.attempts.set(key, 0);
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
    this.bump(key);
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const socket = this.sockets.get(key);
    this.sockets.delete(key);
    socket?.close();
  }

  private bump(key: string) {
    this.generation.set(key, (this.generation.get(key) ?? 0) + 1);
  }

  private connect(symbol: string, interval: CandleInterval) {
    const key = streamKey(symbol, interval);
    const gen = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, gen);
    const socket = new WebSocket(streamUrl(symbol, interval));
    this.sockets.set(key, socket);
    socket.onmessage = event => {
      if (this.generation.get(key) !== gen) return;
      const candle = readKline(event.data, symbol, interval);
      if (!candle) return;
      void this.controller.set(upsertCandle, { symbol, interval }, [candle]);
    };
    socket.onopen = () => {
      if (this.generation.get(key) !== gen) return;
      const failed = (this.attempts.get(key) ?? 0) > 0;
      this.attempts.set(key, 0);
      if (!failed) return;
      void this.controller.fetch(getCandles, { symbol, interval });
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onclose = () => {
      if (this.generation.get(key) !== gen) return;
      if (!this.counts.has(key)) return;
      this.scheduleReconnect(symbol, interval);
    };
  }

  private scheduleReconnect(symbol: string, interval: CandleInterval) {
    const key = streamKey(symbol, interval);
    const attempt = this.attempts.get(key) ?? 0;
    this.attempts.set(key, attempt + 1);
    const delay = Math.min(10_000, 2 ** attempt * 500);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (!this.counts.has(key)) return;
      this.connect(symbol, interval);
    }, delay);
    this.timers.set(key, timer);
  }
}
