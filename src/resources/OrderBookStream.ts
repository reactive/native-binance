import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { BINANCE_STREAM } from './hosts';
import { getOrderBook, OrderBook } from './OrderBook';

type DepthUpdate = {
  s: string;
  U: number;
  u: number;
  b: unknown;
  a: unknown;
};

function streamUrl(symbol: string) {
  return `${BINANCE_STREAM}/${symbol.toLowerCase()}@depth@100ms`;
}

function symbolFrom(args: readonly unknown[] | undefined): string {
  const arg = args?.[0];
  if (!arg || typeof arg !== 'object' || !('symbol' in arg)) return '';
  const symbol = (arg as { symbol?: unknown }).symbol;
  return typeof symbol === 'string' ? symbol.toUpperCase() : '';
}

function isOrderBookEndpoint(endpoint: { schema?: unknown } | undefined) {
  const schema = endpoint?.schema as { key?: string } | undefined;
  return schema?.key === OrderBook.key;
}

function readDepthUpdate(data: unknown): (DepthUpdate & { s: string }) | undefined {
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
  const U = Number(record.U);
  const u = Number(record.u);
  if (
    record.e !== 'depthUpdate' ||
    typeof record.s !== 'string' ||
    !Number.isFinite(U) ||
    !Number.isFinite(u)
  ) {
    return;
  }
  return { s: record.s, U, u, b: record.b, a: record.a };
}

/** Keeps `OrderBook` current from Binance's full-book diff stream. */
export default class OrderBookStream implements Manager {
  protected controller: Controller = new Controller();
  private readonly counts = new Map<string, number>();
  private readonly buffers = new Map<string, DepthUpdate[]>();
  private readonly sockets = new Map<string, WebSocket>();
  private readonly generation = new Map<string, number>();
  private readonly attempts = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly resyncing = new Set<string>();

  middleware: Middleware = controller => {
    this.controller = controller;
    return next => async action => {
      if (
        action.type === actionTypes.SUBSCRIBE ||
        action.type === actionTypes.UNSUBSCRIBE
      ) {
        if (!isOrderBookEndpoint(action.endpoint)) return next(action);
        const symbol = symbolFrom(action.args);
        if (symbol) {
          if (action.type === actionTypes.SUBSCRIBE) this.subscribe(symbol);
          else this.unsubscribe(symbol);
        }
        return Promise.resolve();
      }

      if (
        action.type === actionTypes.SET_RESPONSE &&
        isOrderBookEndpoint(action.endpoint) &&
        !action.error
      ) {
        await next(action);
        const symbol = symbolFrom(action.args);
        if (symbol) this.enqueue(symbol, () => this.flush(symbol));
        return;
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
    this.buffers.clear();
    this.resyncing.clear();
  }

  private subscribe(symbol: string) {
    const count = (this.counts.get(symbol) ?? 0) + 1;
    this.counts.set(symbol, count);
    if (count > 1) return;
    this.buffers.set(symbol, []);
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
    this.buffers.delete(symbol);
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
    const update = readDepthUpdate(data);
    if (!update || update.s.toUpperCase() !== symbol) return;
    const buffer = this.buffers.get(symbol);
    if (!buffer) return;
    buffer.push(update);
    if (buffer.length > 1000) buffer.splice(0, buffer.length - 1000);
    this.enqueue(symbol, () => this.flush(symbol));
  }

  private enqueue(symbol: string, task: () => Promise<void>) {
    const prev = this.tails.get(symbol) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.tails.set(symbol, next);
  }

  private book(symbol: string) {
    return this.controller.get(
      OrderBook,
      { symbol },
      this.controller.getState(),
    );
  }

  /** Hand each diff to the entity. Merge applies it; a refused newer id is a gap. */
  private async flush(symbol: string) {
    const buffer = this.buffers.get(symbol);
    if (!buffer?.length || !this.book(symbol)) return;

    const pending = buffer.splice(0, buffer.length);
    for (let i = 0; i < pending.length; i++) {
      const event = pending[i];
      const before = this.book(symbol);
      if (!before) {
        buffer.unshift(...pending.slice(i));
        return;
      }
      await this.controller.set(OrderBook, { symbol }, event);
      const after = this.book(symbol);
      if (
        after &&
        event.u > before.lastUpdateId &&
        after.lastUpdateId === before.lastUpdateId
      ) {
        buffer.unshift(...pending.slice(i));
        this.resync(symbol);
        return;
      }
    }
  }

  /** Snapshot again so buffered diffs can bridge `lastUpdateId`. */
  private resync(symbol: string) {
    if (this.resyncing.has(symbol) || !this.counts.has(symbol)) return;
    this.resyncing.add(symbol);
    void Promise.resolve(this.controller.fetch(getOrderBook, { symbol })).finally(
      () => {
        this.resyncing.delete(symbol);
      },
    );
  }
}
