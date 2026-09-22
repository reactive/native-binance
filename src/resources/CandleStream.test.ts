import { actionTypes } from '@data-client/react';
import type { Controller } from '@data-client/react';

import { getCandles, upsertCandle } from './Candle';
import CandleStream from './CandleStream';
import { FakeSocket, installFakeSocket } from './testSocket';

let restoreSocket = () => {};
const streams: CandleStream[] = [];

function candleMessage(symbol: string, interval: string, openTime = 1) {
  return {
    e: 'kline',
    s: symbol,
    k: { t: openTime, s: symbol, i: interval, o: '1', h: '2', l: '1', c: '2', v: '1', n: 1 },
  };
}

function controller() {
  return {
    set: jest.fn(() => Promise.resolve()),
    fetch: jest.fn(() => Promise.resolve()),
  };
}

async function dispatch(
  stream: CandleStream,
  ctrl: ReturnType<typeof controller>,
  type: typeof actionTypes.SUBSCRIBE | typeof actionTypes.UNSUBSCRIBE,
  args: { symbol: string; interval: string },
) {
  const next = stream.middleware(ctrl as unknown as Controller);
  await next(() => Promise.resolve())({
    type,
    endpoint: getCandles,
    args: [args],
  } as never);
}

beforeEach(() => {
  const installed = installFakeSocket();
  restoreSocket = installed.restore;
  jest.useFakeTimers();
});

afterEach(() => {
  for (const stream of streams) stream.cleanup();
  streams.length = 0;
  jest.useRealTimers();
  restoreSocket();
});

function createStream() {
  const stream = new CandleStream();
  streams.push(stream);
  return stream;
}

it('reference-counts one kline socket per symbol and interval', async () => {
  const stream = createStream();
  const ctrl = controller();
  const args = { symbol: 'BTCUSDT', interval: '15m' };

  await dispatch(stream, ctrl, actionTypes.SUBSCRIBE, args);
  await dispatch(stream, ctrl, actionTypes.SUBSCRIBE, args);
  expect(FakeSocket.instances.map(socket => socket.url)).toEqual([
    'wss://data-stream.binance.vision/ws/btcusdt@kline_15m',
  ]);

  await dispatch(stream, ctrl, actionTypes.UNSUBSCRIBE, args);
  expect(FakeSocket.instances[0].closed).toBe(false);

  await dispatch(stream, ctrl, actionTypes.UNSUBSCRIBE, args);
  expect(FakeSocket.instances[0].closed).toBe(true);
  jest.advanceTimersByTime(10_000);
  expect(FakeSocket.instances).toHaveLength(1);
});

it('leaves the other interval open when one interval unsubscribes', async () => {
  const stream = createStream();
  const ctrl = controller();
  await dispatch(stream, ctrl, actionTypes.SUBSCRIBE, { symbol: 'BTCUSDT', interval: '15m' });
  await dispatch(stream, ctrl, actionTypes.SUBSCRIBE, { symbol: 'BTCUSDT', interval: '1h' });
  await dispatch(stream, ctrl, actionTypes.UNSUBSCRIBE, { symbol: 'BTCUSDT', interval: '15m' });

  expect(FakeSocket.instances.map(socket => [socket.url, socket.closed])).toEqual([
    ['wss://data-stream.binance.vision/ws/btcusdt@kline_15m', true],
    ['wss://data-stream.binance.vision/ws/btcusdt@kline_1h', false],
  ]);
});

it('ignores messages for another symbol, interval, or event', async () => {
  const stream = createStream();
  const ctrl = controller();
  await dispatch(stream, ctrl, actionTypes.SUBSCRIBE, { symbol: 'BTCUSDT', interval: '15m' });
  const socket = FakeSocket.instances[0];

  socket.onmessage?.({ data: JSON.stringify(candleMessage('ETHUSDT', '15m')) });
  socket.onmessage?.({ data: JSON.stringify(candleMessage('BTCUSDT', '1h')) });
  socket.onmessage?.({ data: JSON.stringify({ e: 'trade', k: candleMessage('BTCUSDT', '15m').k }) });
  socket.onmessage?.({ data: 'not-json' });
  expect(ctrl.set).not.toHaveBeenCalled();

  socket.onmessage?.({ data: JSON.stringify(candleMessage('BTCUSDT', '15m', 5_000)) });
  expect(ctrl.set).toHaveBeenCalledTimes(1);
  expect(ctrl.set).toHaveBeenCalledWith(upsertCandle, { symbol: 'BTCUSDT', interval: '15m' }, [
    candleMessage('BTCUSDT', '15m', 5_000).k,
  ]);
});

it('reconnects with backoff and refetches klines after the socket opens', async () => {
  const stream = createStream();
  const ctrl = controller();
  await dispatch(stream, ctrl, actionTypes.SUBSCRIBE, { symbol: 'BTCUSDT', interval: '15m' });
  const first = FakeSocket.instances[0];
  first.onopen?.();
  expect(ctrl.fetch).not.toHaveBeenCalled();

  first.close();
  jest.advanceTimersByTime(499);
  expect(FakeSocket.instances).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(FakeSocket.instances).toHaveLength(2);
  expect(FakeSocket.instances[1].url).toBe(first.url);

  FakeSocket.instances[1].onopen?.();
  expect(ctrl.fetch).toHaveBeenCalledTimes(1);
  expect(ctrl.fetch).toHaveBeenCalledWith(getCandles, { symbol: 'BTCUSDT', interval: '15m' });
});
