/** Shared stand-in for Binance sockets. `stall` leaves the socket open and silent. */
export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState: number = FakeSocket.CONNECTING;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(String(data));
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  frame(data: unknown) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: payload });
  }

  /** Fires `onerror` then `onclose`, the pair a failed socket produces. */
  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onerror?.();
    this.onclose?.();
  }

  stall() {}

  get closed(): boolean {
    return this.readyState === FakeSocket.CLOSED;
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

export function installFakeSocket() {
  FakeSocket.instances = [];
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  return {
    sockets: FakeSocket.instances,
    restore() {
      globalThis.WebSocket = original;
      FakeSocket.instances = [];
    },
  };
}
