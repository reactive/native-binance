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
  /** Sockets open only between `init()` and `cleanup()`. Subscriptions are counted at any time. */
  private active = false;
  /** `init()` has run before, so the next one resumes and has missed frames to refetch. */
  private started = false;

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

  /** Starts or resumes: opens a socket for each subscription counted so far. */
  init() {
    if (this.active) return;
    this.active = true;
    const resumed = this.started;
    this.started = true;
    if (this.count > 0) this.connect(resumed);
  }

  /** Pauses. Subscribers stay counted, so `init()` reconnects them. */
  cleanup() {
    this.active = false;
    this.disconnect();
  }

  private subscribe() {
    this.count += 1;
    if (this.count > 1 || !this.active) return;
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

  /** `resumed` refetches on open, since ticks were missed while paused. */
  private connect(resumed = false) {
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
        if (!reopened && !resumed) return;
        // Quiet symbols are absent from `!miniTicker@arr`, so a recovered socket refetches them.
        void Promise.resolve(this.controller.fetch(getTickers)).catch(() => {});
      },
    });
    this.sockets.set(TICKER_STREAM, socket);
  }

  /** Each message is a change-set. One write merges the batch and keeps every symbol that arrived while that write was in flight. */
  private flush() {
    if (this.writing || this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    this.writing = true;
    void this.controller.set([Ticker], [...batch.values()]).finally(() => {
      this.writing = false;
      if (this.pending.size > 0) this.flush();
    });
  }
}
