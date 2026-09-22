import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { LiveSocket } from './LiveSocket';
import { streamStatus, type StreamStatus } from './streamStatus';
import { TICKER_STREAM } from './streams';
import { getTickers, Ticker } from './Ticker';

/** `!miniTicker@arr` payload, or the `{ data }` wrapper a combined stream uses. */
export function readMiniTickers(data: unknown): object[] | undefined {
  let msg: unknown = data;
  if (typeof data === 'string') {
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
  }
  if (Array.isArray(msg)) return msg;
  if (msg && typeof msg === 'object' && Array.isArray((msg as { data?: unknown }).data)) {
    return (msg as { data: object[] }).data;
  }
  return;
}

function symbolOf(row: object): string | undefined {
  const record = row as { s?: unknown; symbol?: unknown };
  const raw = typeof record.s === 'string' ? record.s : record.symbol;
  return typeof raw === 'string' && raw ? raw.toUpperCase() : undefined;
}

/** Later rows for the same symbol replace earlier ones. Other symbols stay. */
export function mergeTickerRows(pending: Map<string, object>, rows: readonly object[]): void {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const symbol = symbolOf(row);
    if (symbol) pending.set(symbol, row);
  }
}

/** Keeps `Ticker` current from the all-market mini-ticker while Markets is subscribed. */
export default class TickerStream implements Manager {
  protected controller: Controller = new Controller();
  private count = 0;
  private readonly sockets = new Map<string, LiveSocket>();
  private pending = new Map<string, object>();
  private writing = false;

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
      if (action.endpoint !== getTickers) return next(action);
      if (action.type === actionTypes.SUBSCRIBE) this.subscribe();
      else this.unsubscribe();
      return Promise.resolve();
    };
  };

  cleanup() {
    this.count = 0;
    this.disconnect();
  }

  private subscribe() {
    this.count += 1;
    if (this.count > 1) return;
    this.connect();
  }

  private unsubscribe() {
    this.count = Math.max(0, this.count - 1);
    if (this.count > 0) return;
    this.disconnect();
  }

  private disconnect() {
    this.pending = new Map();
    const socket = this.sockets.get(TICKER_STREAM);
    this.sockets.delete(TICKER_STREAM);
    socket?.close();
  }

  private connect() {
    const socket = new LiveSocket({
      url: TICKER_STREAM,
      status: this.status,
      onMessage: data => {
        const rows = readMiniTickers(data);
        if (!rows) return;
        mergeTickerRows(this.pending, rows);
        this.flush();
      },
      onOpen: reopened => {
        if (!reopened) return;
        // Quiet symbols are absent from `!miniTicker@arr`, so a recovered socket refetches them.
        void Promise.resolve(this.controller.fetch(getTickers)).catch(() => {});
      },
    });
    this.sockets.set(TICKER_STREAM, socket);
  }

  /** Each message is a change-set. Writes merge one entity at a time and keep every symbol that arrived while a write was in flight. */
  private flush() {
    if (this.writing || this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    this.writing = true;
    const writes = [...batch].map(([symbol, row]) =>
      this.controller.set(Ticker, { symbol }, row),
    );
    void Promise.all(writes).finally(() => {
      this.writing = false;
      if (this.pending.size > 0) this.flush();
    });
  }
}
