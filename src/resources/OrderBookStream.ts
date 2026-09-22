import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { getOrderBook, OrderBook } from './OrderBook';
import { LiveSocket } from './LiveSocket';
import { streamStatus, type StreamStatus } from './streamStatus';
import { depthStream } from './streams';

type DepthUpdate = {
  s: string;
  U: number;
  u: number;
  b: unknown;
  a: unknown;
};

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
  private readonly sockets = new Map<string, LiveSocket>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly resyncing = new Set<string>();
  private readonly resyncFailures = new Map<string, number>();
  private readonly resyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Last id applied. `getState()` lags the reducer, so the gap check cannot re-read the book. */
  private readonly heads = new Map<string, number>();

  constructor(private readonly status: StreamStatus = streamStatus) {}

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
        if (symbol) {
          const raw = (action as { response?: { lastUpdateId?: unknown } }).response
            ?.lastUpdateId;
          const id = Number(raw);
          if (Number.isFinite(id)) {
            // shouldUpdate keeps the live book when this snapshot is older.
            const tracked = this.heads.get(symbol) ?? 0;
            const stored = this.book(symbol)?.lastUpdateId ?? 0;
            this.heads.set(symbol, Math.max(id, tracked, stored));
          }
          this.enqueue(symbol, () => this.flush(symbol));
        }
        return;
      }

      return next(action);
    };
  };

  cleanup() {
    for (const timer of this.resyncTimers.values()) clearTimeout(timer);
    this.resyncTimers.clear();
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.counts.clear();
    this.buffers.clear();
    this.heads.clear();
    this.resyncing.clear();
    this.resyncFailures.clear();
  }

  private subscribe(symbol: string) {
    const count = (this.counts.get(symbol) ?? 0) + 1;
    this.counts.set(symbol, count);
    if (count > 1) return;
    this.buffers.set(symbol, []);
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
    this.heads.delete(symbol);
    this.disconnect(symbol);
  }

  private disconnect(symbol: string) {
    const timer = this.resyncTimers.get(symbol);
    if (timer) clearTimeout(timer);
    this.resyncTimers.delete(symbol);
    this.resyncFailures.delete(symbol);
    this.resyncing.delete(symbol);
    const socket = this.sockets.get(symbol);
    this.sockets.delete(symbol);
    socket?.close();
  }

  private connect(symbol: string) {
    const socket = new LiveSocket({
      url: depthStream(symbol),
      status: this.status,
      onMessage: data => this.onMessage(symbol, data),
      onOpen: () => {},
    });
    this.sockets.set(symbol, socket);
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

  /** Hand each diff to the entity. An id past the last applied update is a gap. */
  private async flush(symbol: string) {
    const buffer = this.buffers.get(symbol);
    if (!buffer?.length) return;
    let head = this.heads.get(symbol);
    if (head == null) {
      const book = this.book(symbol);
      if (!book) return;
      head = book.lastUpdateId;
      this.heads.set(symbol, head);
    }

    const pending = buffer.splice(0, buffer.length);
    for (let i = 0; i < pending.length; i++) {
      const event = pending[i];
      if (event.u <= head) continue;
      if (event.U > head + 1) {
        buffer.unshift(...pending.slice(i));
        this.resync(symbol);
        return;
      }
      await this.controller.set(OrderBook, { symbol }, event);
      const latest = this.heads.get(symbol);
      if (latest != null && latest > event.u) {
        head = latest;
        continue;
      }
      head = event.u;
      this.heads.set(symbol, head);
    }
  }

  /** Snapshot again so buffered diffs can bridge `lastUpdateId`. */
  private resync(symbol: string) {
    if (
      this.resyncing.has(symbol) ||
      this.resyncTimers.has(symbol) ||
      !this.counts.has(symbol)
    ) {
      return;
    }
    this.resyncing.add(symbol);
    const failures = this.resyncFailures.get(symbol) ?? 0;
    void Promise.resolve(this.controller.fetch(getOrderBook, { symbol }))
      .then(() => {
        this.resyncFailures.set(symbol, 0);
      })
      .catch(() => {
        const delay = Math.min(10_000, 2 ** failures * 500);
        this.resyncFailures.set(symbol, failures + 1);
        const timer = setTimeout(() => {
          this.resyncTimers.delete(symbol);
          if (!this.counts.has(symbol)) return;
          this.enqueue(symbol, () => this.flush(symbol));
        }, delay);
        this.resyncTimers.set(symbol, timer);
      })
      .finally(() => {
        this.resyncing.delete(symbol);
      });
  }
}
