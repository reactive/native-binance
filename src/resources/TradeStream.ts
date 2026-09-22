import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { LiveSocket } from './LiveSocket';
import { streamStatus, type StreamStatus } from './streamStatus';
import { tradeStream } from './streams';
import { getTrades, newTrades, TAPE_LIMIT } from './Trade';

function symbolFrom(args: readonly unknown[] | undefined): string {
  const arg = args?.[0];
  if (!arg || typeof arg !== 'object' || !('symbol' in arg)) return '';
  const symbol = (arg as { symbol?: unknown }).symbol;
  return typeof symbol === 'string' ? symbol.toUpperCase() : '';
}

type AggFrame = Record<string, unknown> & { s: string };

function readAggTrade(data: unknown): AggFrame | undefined {
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
  return record as AggFrame;
}

function scheduleFrame(run: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 0);
}

/**
 * Keeps the `Trade` tape current from `<symbol>@aggTrade`.
 * Writes wait until the in-flight `getTrades` snapshot has landed. A refetch
 * also replays prints already on the tape, so the snapshot cannot drop them.
 */
export default class TradeStream implements Manager {
  protected controller: Controller = new Controller();
  private readonly counts = new Map<string, number>();
  private readonly pending = new Map<string, AggFrame[]>();
  private readonly sockets = new Map<string, LiveSocket>();
  /**
   * Symbols whose `getTrades` snapshot has not landed.
   * One `SET_RESPONSE` clears the symbol: NetworkManager throttles a second
   * fetch of the same key onto the first, so that fetch never gets its own response.
   */
  private readonly syncing = new Set<string>();
  private readonly writing = new Set<string>();
  /** A flush is already queued for this frame. */
  private readonly scheduled = new Set<string>();
  /** The tape collection has been seen, so later frames skip `controller.get`. */
  private readonly ready = new Set<string>();

  constructor(private readonly status: StreamStatus = streamStatus) {}

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
        if (symbol) {
          this.holdMerged(symbol);
          this.syncing.add(symbol);
          this.ready.delete(symbol);
        }
        return next(action);
      }

      if (action.type === actionTypes.SET_RESPONSE && action.endpoint === getTrades) {
        const symbol = symbolFrom(action.args);
        const result = await next(action);
        if (symbol) {
          this.syncing.delete(symbol);
          this.flush(symbol);
        }
        return result;
      }

      return next(action);
    };
  };

  cleanup() {
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.counts.clear();
    this.pending.clear();
    this.syncing.clear();
    this.writing.clear();
    this.scheduled.clear();
    this.ready.clear();
  }

  private subscribe(symbol: string) {
    const count = (this.counts.get(symbol) ?? 0) + 1;
    this.counts.set(symbol, count);
    if (count > 1) return;
    this.pending.set(symbol, []);
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
    this.syncing.delete(symbol);
    this.writing.delete(symbol);
    this.scheduled.delete(symbol);
    this.ready.delete(symbol);
    this.disconnect(symbol);
  }

  private disconnect(symbol: string) {
    const socket = this.sockets.get(symbol);
    this.sockets.delete(symbol);
    socket?.close();
  }

  private connect(symbol: string) {
    const socket = new LiveSocket({
      url: tradeStream(symbol),
      status: this.status,
      onMessage: data => this.onMessage(symbol, data),
      onOpen: () => {
        void Promise.resolve(this.controller.fetch(getTrades, { symbol })).catch(() => {});
      },
    });
    this.sockets.set(symbol, socket);
  }

  /** Prints already merged keep their old `fetchedAt`, so a refetch would drop them. */
  private holdMerged(symbol: string) {
    const buffer = this.pending.get(symbol);
    if (!buffer) return;
    const live = this.controller.get(getTrades.schema, { symbol }, this.controller.getState());
    if (!Array.isArray(live) || live.length === 0) return;
    const seen = new Set(buffer.map(row => Number(row.a)));
    const older: AggFrame[] = [];
    for (let i = live.length - 1; i >= 0; i--) {
      const trade = live[i];
      if (seen.has(trade.a)) continue;
      older.push({
        e: 'aggTrade',
        s: symbol,
        a: trade.a,
        p: trade.p,
        q: trade.q,
        T: trade.T,
        m: trade.m,
      });
    }
    const incoming = buffer.splice(0, buffer.length);
    const combined = [...older, ...incoming];
    const start = Math.max(0, combined.length - TAPE_LIMIT);
    for (let i = start; i < combined.length; i++) buffer.push(combined[i]);
  }

  private onMessage(symbol: string, data: unknown) {
    const trade = readAggTrade(data);
    if (!trade || trade.s.toUpperCase() !== symbol) return;
    const buffer = this.pending.get(symbol);
    if (!buffer) return;
    buffer.push(trade);
    if (buffer.length > TAPE_LIMIT) buffer.splice(0, buffer.length - TAPE_LIMIT);
    this.scheduleFlush(symbol);
  }

  private scheduleFlush(symbol: string) {
    if (this.scheduled.has(symbol)) return;
    this.scheduled.add(symbol);
    scheduleFrame(() => {
      if (!this.scheduled.delete(symbol)) return;
      this.flush(symbol);
    });
  }

  private flush(symbol: string) {
    if (this.writing.has(symbol) || this.syncing.has(symbol)) return;
    const buffer = this.pending.get(symbol);
    if (!buffer?.length) return;
    if (!this.ready.has(symbol)) {
      if (
        this.controller.get(getTrades.schema, { symbol }, this.controller.getState()) ===
        undefined
      ) {
        return;
      }
      this.ready.add(symbol);
    }
    const batch = buffer.splice(0, buffer.length);
    this.writing.add(symbol);
    void Promise.resolve(this.controller.set(newTrades, { symbol }, batch)).finally(() => {
      this.writing.delete(symbol);
      if (this.pending.get(symbol)?.length) this.scheduleFlush(symbol);
    });
  }
}
