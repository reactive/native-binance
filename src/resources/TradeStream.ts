import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { BINANCE_STREAM } from './hosts';
import { getTrades, newTrades, TAPE_LIMIT } from './Trade';

function streamUrl(symbol: string) {
  return `${BINANCE_STREAM}/${symbol.toLowerCase()}@aggTrade`;
}

function symbolFrom(args: readonly unknown[] | undefined): string {
  const arg = args?.[0];
  if (!arg || typeof arg !== 'object' || !('symbol' in arg)) return '';
  const symbol = (arg as { symbol?: unknown }).symbol;
  return typeof symbol === 'string' ? symbol.toUpperCase() : '';
}

/** Aggregate-trade frame, or undefined when the payload is not one for this socket. */
function readAggTrade(data: unknown): Record<string, unknown> | undefined {
  let msg: unknown = data;
  if (typeof data === 'string') {
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
  }
  if (!msg || typeof msg !== 'object') return;
  const record = msg as Record<string, unknown>;
  if (record.e !== 'aggTrade' || typeof record.s !== 'string' || !Number.isFinite(Number(record.a))) {
    return;
  }
  return record;
}

/**
 * Keeps the `Trade` tape current from `<symbol>@aggTrade`.
 * Writes wait until every in-flight `getTrades` snapshot has landed, because an
 * older snapshot would otherwise be discarded by the stream's later `set`.
 */
export default class TradeStream implements Manager {
  protected controller: Controller = new Controller();
  private readonly counts = new Map<string, number>();
  private readonly pending = new Map<string, Record<string, unknown>[]>();
  private readonly sockets = new Map<string, WebSocket>();
  private readonly generation = new Map<string, number>();
  private readonly attempts = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** `fetchedAt` of each `getTrades` fetch still in flight for that symbol. */
  private readonly inflight = new Map<string, Set<number>>();
  private readonly writing = new Set<string>();

  middleware: Middleware = controller => {
    this.controller = controller;
    return next => async action => {
      if (
        action.type === actionTypes.SUBSCRIBE ||
        action.type === actionTypes.UNSUBSCRIBE
      ) {
        if (action.endpoint !== getTrades) return next(action);
        const symbol = symbolFrom(action.args);
        if (symbol) {
          if (action.type === actionTypes.SUBSCRIBE) this.subscribe(symbol);
          else this.unsubscribe(symbol);
        }
        return Promise.resolve();
      }

      if (action.type === actionTypes.FETCH && action.endpoint === getTrades) {
        const symbol = symbolFrom(action.args);
        if (symbol) this.noteFetch(symbol, action.meta.fetchedAt);
        return next(action);
      }

      if (action.type === actionTypes.SET_RESPONSE && action.endpoint === getTrades) {
        const symbol = symbolFrom(action.args);
        const fetchedAt = action.meta.fetchedAt;
        const result = await next(action);
        if (symbol) this.noteResponse(symbol, fetchedAt);
        return result;
      }

      return next(action);
    };
  };

  cleanup() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const symbol of this.sockets.keys()) this.bump(symbol);
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.counts.clear();
    this.pending.clear();
    this.inflight.clear();
    this.writing.clear();
  }

  private subscribe(symbol: string) {
    const count = (this.counts.get(symbol) ?? 0) + 1;
    this.counts.set(symbol, count);
    if (count > 1) return;
    this.pending.set(symbol, []);
    this.attempts.set(symbol, 0);
    this.connect(symbol);
  }

  private unsubscribe(symbol: string) {
    const count = (this.counts.get(symbol) ?? 0) - 1;
    if (count > 0) {
      this.counts.set(symbol, count);
      return;
    }
    this.counts.delete(symbol);
    this.pending.delete(symbol);
    this.inflight.delete(symbol);
    this.writing.delete(symbol);
    this.disconnect(symbol);
  }

  private disconnect(symbol: string) {
    this.bump(symbol);
    const timer = this.timers.get(symbol);
    if (timer) clearTimeout(timer);
    this.timers.delete(symbol);
    const socket = this.sockets.get(symbol);
    this.sockets.delete(symbol);
    socket?.close();
  }

  private bump(symbol: string) {
    this.generation.set(symbol, (this.generation.get(symbol) ?? 0) + 1);
  }

  private connect(symbol: string) {
    const gen = (this.generation.get(symbol) ?? 0) + 1;
    this.generation.set(symbol, gen);
    const socket = new WebSocket(streamUrl(symbol));
    this.sockets.set(symbol, socket);
    socket.onmessage = event => {
      if (this.generation.get(symbol) !== gen) return;
      this.onMessage(symbol, event.data);
    };
    socket.onopen = () => {
      if (this.generation.get(symbol) !== gen) return;
      this.attempts.set(symbol, 0);
      void Promise.resolve(this.controller.fetch(getTrades, { symbol })).catch(() => {});
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onclose = () => {
      if (this.generation.get(symbol) !== gen) return;
      if (!this.counts.has(symbol)) return;
      this.scheduleReconnect(symbol);
    };
  }

  private scheduleReconnect(symbol: string) {
    const attempt = this.attempts.get(symbol) ?? 0;
    this.attempts.set(symbol, attempt + 1);
    const delay = Math.min(10_000, 2 ** attempt * 500);
    const timer = setTimeout(() => {
      this.timers.delete(symbol);
      if (!this.counts.has(symbol)) return;
      this.connect(symbol);
    }, delay);
    this.timers.set(symbol, timer);
  }

  private onMessage(symbol: string, data: unknown) {
    const trade = readAggTrade(data);
    if (!trade || String(trade.s).toUpperCase() !== symbol) return;
    const buffer = this.pending.get(symbol);
    if (!buffer) return;
    buffer.push(trade);
    if (buffer.length > TAPE_LIMIT) buffer.splice(0, buffer.length - TAPE_LIMIT);
    this.flush(symbol);
  }

  private noteFetch(symbol: string, fetchedAt: number) {
    let stamps = this.inflight.get(symbol);
    if (!stamps) {
      stamps = new Set();
      this.inflight.set(symbol, stamps);
    }
    stamps.add(fetchedAt);
  }

  private noteResponse(symbol: string, fetchedAt: number) {
    const stamps = this.inflight.get(symbol);
    if (stamps?.delete(fetchedAt) && stamps.size === 0) this.inflight.delete(symbol);
    this.flush(symbol);
  }

  private flush(symbol: string) {
    if (this.writing.has(symbol) || this.inflight.has(symbol)) return;
    const buffer = this.pending.get(symbol);
    if (!buffer?.length) return;
    if (
      this.controller.get(getTrades.schema, { symbol }, this.controller.getState()) ===
      undefined
    ) {
      return;
    }
    const batch = buffer.splice(0, buffer.length);
    this.writing.add(symbol);
    void Promise.resolve(this.controller.set(newTrades, { symbol }, batch)).finally(() => {
      this.writing.delete(symbol);
      this.flush(symbol);
    });
  }
}
