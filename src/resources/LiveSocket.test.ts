import {
  CONNECT_TIMEOUT_MS,
  LiveSocket,
  PROBE_TIMEOUT_MS,
  QUIET_MS,
} from './LiveSocket';
import { StreamStatus } from './streamStatus';
import { depthStream, klineStream, TICKER_STREAM, tradeStream } from './streams';
import { FakeSocket, installFakeSocket } from './testSocket';

const URL = 'wss://data-stream.binance.vision/ws/btcusdt@aggTrade';

function harness() {
  const status = new StreamStatus();
  const messages: unknown[] = [];
  const opens: boolean[] = [];
  const installed = installFakeSocket();
  const live = new LiveSocket({
    url: URL,
    status,
    onMessage: data => {
      messages.push(data);
    },
    onOpen: reopened => {
      opens.push(reopened);
    },
  });
  return {
    status,
    messages,
    opens,
    sockets: installed.sockets,
    live,
    restore: installed.restore,
  };
}

let session: ReturnType<typeof harness> | undefined;

function start() {
  session = harness();
  return session;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  session?.live.close();
  session?.restore();
  session = undefined;
  jest.useRealTimers();
});

it('builds the four stream urls', () => {
  expect(TICKER_STREAM).toBe('wss://data-stream.binance.vision/ws/!miniTicker@arr');
  expect(depthStream('BTCUSDT')).toBe('wss://data-stream.binance.vision/ws/btcusdt@depth@100ms');
  expect(tradeStream('BTCUSDT')).toBe('wss://data-stream.binance.vision/ws/btcusdt@aggTrade');
  expect(klineStream('BTCUSDT', '15m')).toBe('wss://data-stream.binance.vision/ws/btcusdt@kline_15m');
});

it('probes on open, drops the result, and is not down', () => {
  const { sockets, messages, status } = start();
  expect(sockets.map(socket => socket.url)).toEqual([URL]);
  sockets[0].open();
  expect(sockets[0].sent).toEqual([JSON.stringify({ method: 'LIST_SUBSCRIPTIONS', id: 1 })]);
  sockets[0].frame('{"result":[],"id":1}');
  expect(messages).toEqual([]);
  expect(status.isDown(URL)).toBe(false);
});

it('backs off after a drop until a frame resets the delay', () => {
  const { sockets, opens, status } = start();
  sockets[0].open();
  expect(opens).toEqual([false]);
  const delays = [500, 1000, 2000, 4000, 8000, 10_000, 10_000];
  let current = sockets[0];
  for (const delay of delays) {
    const before = sockets.length;
    current.drop();
    expect(status.isDown(URL)).toBe(true);
    jest.advanceTimersByTime(delay - 1);
    expect(sockets).toHaveLength(before);
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1);
    current = sockets[sockets.length - 1];
  }
  current.open();
  expect(opens[opens.length - 1]).toBe(true);
  current.frame('{"result":[],"id":9}');
  expect(status.isDown(URL)).toBe(false);
  const before = sockets.length;
  current.drop();
  jest.advanceTimersByTime(499);
  expect(sockets).toHaveLength(before);
  jest.advanceTimersByTime(1);
  expect(sockets).toHaveLength(before + 1);
});

it('fails once when onerror is followed by onclose', () => {
  const { sockets } = start();
  const socket = sockets[0];
  socket.open();
  const onerror = socket.onerror;
  const onclose = socket.onclose;
  onerror?.();
  onclose?.();
  jest.advanceTimersByTime(500);
  expect(sockets).toHaveLength(2);
  jest.advanceTimersByTime(499);
  expect(sockets).toHaveLength(2);
});

it('probes a silent socket at 5s and reconnects at 8s, ignoring a late frame', () => {
  const { sockets, messages, status } = start();
  const first = sockets[0];
  first.open();
  first.frame('{"e":"aggTrade","a":1}');
  expect(messages).toHaveLength(1);
  first.stall();
  jest.advanceTimersByTime(QUIET_MS - 1);
  expect(first.sent).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(first.sent).toHaveLength(2);
  expect(first.sent[1]).toContain('LIST_SUBSCRIPTIONS');
  jest.advanceTimersByTime(PROBE_TIMEOUT_MS - 1);
  expect(first.readyState).toBe(FakeSocket.OPEN);
  jest.advanceTimersByTime(1);
  expect(first.readyState).toBe(FakeSocket.CLOSED);
  expect(status.isDown(URL)).toBe(true);
  expect(sockets).toHaveLength(1);
  first.frame('{"e":"aggTrade","a":2}');
  expect(messages).toHaveLength(1);
  expect(status.isDown(URL)).toBe(true);
});

it('does not fail a replacement socket before its own connect timeout', () => {
  const { sockets, status } = start();
  const first = sockets[0];
  first.open();
  first.frame('{"e":"aggTrade","a":1}');
  first.stall();
  jest.advanceTimersByTime(QUIET_MS + PROBE_TIMEOUT_MS);
  expect(status.isDown(URL)).toBe(true);
  jest.advanceTimersByTime(500);
  const replacement = sockets[1];
  expect(replacement.readyState).toBe(FakeSocket.CONNECTING);
  jest.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
  expect(replacement.readyState).toBe(FakeSocket.CONNECTING);
  expect(sockets).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(replacement.readyState).toBe(FakeSocket.CLOSED);
  expect(status.isDown(URL)).toBe(true);
  expect(sockets).toHaveLength(2);
});

it('sends no further probe while frames keep arriving', () => {
  const { sockets } = start();
  const socket = sockets[0];
  socket.open();
  expect(socket.sent).toHaveLength(1);
  for (let elapsed = 0; elapsed < 30_000; elapsed += 100) {
    jest.advanceTimersByTime(100);
    socket.frame(`{"e":"aggTrade","a":${elapsed}}`);
  }
  expect(socket.sent).toHaveLength(1);
});

it('grows the delay when an open never delivers a frame', () => {
  const { sockets, opens } = start();
  const delays = [500, 1000, 2000];
  let current = sockets[0];
  for (const delay of delays) {
    current.open();
    jest.advanceTimersByTime(PROBE_TIMEOUT_MS);
    const before = sockets.length;
    jest.advanceTimersByTime(delay - 1);
    expect(sockets).toHaveLength(before);
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(before + 1);
    current = sockets[sockets.length - 1];
  }
  expect(opens).toEqual([false, true, true]);
});

it('does not reconnect after close, and a late onclose is ignored', () => {
  const { sockets, status, live } = start();
  const first = sockets[0];
  first.open();
  const late = first.onclose;
  first.drop();
  live.close();
  expect(status.isDown(URL)).toBe(false);
  late?.();
  jest.advanceTimersByTime(60_000);
  expect(sockets).toHaveLength(1);
  expect(status.isDown(URL)).toBe(false);
});
