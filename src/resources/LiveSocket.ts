import { StreamStatus } from './streamStatus';

export const QUIET_MS = 5_000;
export const PROBE_TIMEOUT_MS = 3_000;
export const CONNECT_TIMEOUT_MS = 10_000;
const WATCH_MS = 1_000;

type LiveSocketOptions = {
  url: string;
  status: StreamStatus;
  onMessage(data: unknown): void;
  /** `reopened` is true when this open follows a failure. */
  onOpen(reopened: boolean): void;
};

/**
 * One Binance socket. A `LIST_SUBSCRIPTIONS` probe proves a quiet stream is alive.
 * Timing fields belong to the current connection, so a stale probe cannot fail the next one.
 */
export class LiveSocket {
  private socket: WebSocket | undefined;
  private generation = 0;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private startedAt = 0;
  private openedAt = 0;
  private lastFrameAt = 0;
  private probeSentAt = 0;
  private probeId = 0;

  constructor(private readonly options: LiveSocketOptions) {
    this.connect();
    this.watchdog = setInterval(() => this.tick(), WATCH_MS);
  }

  /** Owner release: no reconnect, and the stream is not down. */
  close(): void {
    this.closed = true;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.clearDeadlines();
    this.detachAndClose();
    this.options.status.setDown(this.options.url, false);
  }

  private connect() {
    this.clearDeadlines();
    this.generation += 1;
    const gen = this.generation;
    const now = Date.now();
    this.startedAt = now;
    this.openedAt = 0;
    this.lastFrameAt = 0;
    this.probeSentAt = 0;
    this.arm(now + CONNECT_TIMEOUT_MS, 'connect');
    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.generation !== gen) return;
      this.openedAt = Date.now();
      this.clearKind('connect');
      this.sendProbe();
      this.options.onOpen(this.attempts > 0);
    };
    socket.onmessage = event => {
      if (this.generation !== gen) return;
      this.onFrame(event.data);
    };
    socket.onerror = () => {
      if (this.generation !== gen) return;
      this.fail();
    };
    socket.onclose = () => {
      if (this.generation !== gen) return;
      this.fail();
    };
  }

  private onFrame(data: unknown) {
    this.lastFrameAt = Date.now();
    this.probeSentAt = 0;
    this.clearKind('probe');
    this.attempts = 0;
    this.options.status.setDown(this.options.url, false);
    this.arm(this.lastFrameAt + QUIET_MS, 'quiet');
    if (typeof data === 'string' && data.startsWith('{"result"')) return;
    this.options.onMessage(data);
  }

  private sendProbe() {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.probeId += 1;
    this.probeSentAt = Date.now();
    socket.send(JSON.stringify({ method: 'LIST_SUBSCRIPTIONS', id: this.probeId }));
    this.arm(this.probeSentAt + PROBE_TIMEOUT_MS, 'probe');
  }

  private tick() {
    if (this.closed || this.reconnectTimer) return;
    const now = Date.now();
    if (!this.openedAt && now - this.startedAt >= CONNECT_TIMEOUT_MS) {
      this.fail();
      return;
    }
    if (this.probeSentAt && now - this.probeSentAt >= PROBE_TIMEOUT_MS) {
      this.fail();
      return;
    }
    if (
      this.openedAt &&
      !this.probeSentAt &&
      now - Math.max(this.openedAt, this.lastFrameAt) >= QUIET_MS
    ) {
      this.sendProbe();
    }
  }

  /** Bump the generation, detach, then close. `close()` on a silent socket may never fire `onclose`. */
  private fail() {
    if (this.closed || this.reconnectTimer) return;
    this.generation += 1;
    this.clearDeadlines();
    this.detachAndClose();
    this.options.status.setDown(this.options.url, true);
    const delay = Math.min(10_000, 2 ** this.attempts * 500);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closed) return;
      this.connect();
    }, delay);
  }

  private detachAndClose() {
    const socket = this.socket;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  }

  private arm(at: number, kind: 'connect' | 'probe' | 'quiet') {
    this.clearKind(kind);
    const delay = Math.max(0, at - Date.now());
    const timer = setTimeout(() => {
      this.clearKind(kind);
      this.tick();
    }, delay);
    if (kind === 'connect') this.connectTimer = timer;
    else if (kind === 'probe') this.probeTimer = timer;
    else this.quietTimer = timer;
  }

  private clearKind(kind: 'connect' | 'probe' | 'quiet') {
    const timer =
      kind === 'connect' ? this.connectTimer
      : kind === 'probe' ? this.probeTimer
      : this.quietTimer;
    if (timer) clearTimeout(timer);
    if (kind === 'connect') this.connectTimer = undefined;
    else if (kind === 'probe') this.probeTimer = undefined;
    else this.quietTimer = undefined;
  }

  private clearDeadlines() {
    this.clearKind('connect');
    this.clearKind('probe');
    this.clearKind('quiet');
  }
}
