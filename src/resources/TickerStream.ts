import { actionTypes, Controller } from '@data-client/react';
import type { Manager, Middleware } from '@data-client/react';

import { BINANCE_STREAM } from './hosts';
import { getTickers } from './Ticker';

const STREAM_URL = `${BINANCE_STREAM}/!miniTicker@arr`;

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

/** Keeps `Ticker` current from the all-market mini-ticker while Markets is subscribed. */
export default class TickerStream implements Manager {
  protected controller: Controller = new Controller();
  private count = 0;
  private socket: WebSocket | undefined;
  private generation = 0;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: object[] | undefined;
  private writing = false;

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
    this.attempts = 0;
    this.connect();
  }

  private unsubscribe() {
    this.count = Math.max(0, this.count - 1);
    if (this.count > 0) return;
    this.disconnect();
  }

  private disconnect() {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private connect() {
    const gen = ++this.generation;
    const socket = new WebSocket(STREAM_URL);
    this.socket = socket;
    socket.onmessage = event => {
      if (this.generation !== gen) return;
      const rows = readMiniTickers(event.data);
      if (!rows) return;
      this.pending = rows;
      this.flush();
    };
    socket.onopen = () => {
      if (this.generation !== gen) return;
      this.attempts = 0;
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onclose = () => {
      if (this.generation !== gen) return;
      if (this.count < 1) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    const attempt = this.attempts;
    this.attempts += 1;
    const delay = Math.min(10_000, 2 ** attempt * 500);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.count < 1) return;
      this.connect();
    }, delay);
  }

  /** Keep the newest array if a write is still in flight. The stream is a full snapshot. */
  private flush() {
    if (this.writing || !this.pending) return;
    const rows = this.pending;
    this.pending = undefined;
    this.writing = true;
    void Promise.resolve(this.controller.setResponse(getTickers, rows)).finally(() => {
      this.writing = false;
      if (this.pending) this.flush();
    });
  }
}
