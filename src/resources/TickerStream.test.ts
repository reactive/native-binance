import { actionTypes, useQuery } from '@data-client/react';
import type { Controller } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getTickers, Ticker } from './Ticker';
import TickerStream, { mergeTickerRows } from './TickerStream';
import { FakeSocket, installFakeSocket } from './testSocket';

function mini(symbol: string, last: string, eventTime: number) {
  return {
    e: '24hrMiniTicker',
    E: eventTime,
    s: symbol,
    c: last,
    o: '100',
    h: last,
    l: '1',
    v: '1',
    q: '9',
  };
}

it('keeps every symbol when a later batch arrives before the first is flushed', () => {
  const pending = new Map<string, object>();
  mergeTickerRows(pending, [mini('BTCUSDT', '1', 1)]);
  mergeTickerRows(pending, [mini('ETHUSDT', '2', 2)]);
  mergeTickerRows(pending, [mini('ADAUSDT', '3', 3), mini('BTCUSDT', '4', 4)]);
  expect([...pending.keys()]).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  expect(pending.get('BTCUSDT')).toMatchObject({ c: '4' });
});

it('writes symbols from a batch that arrived while the previous write was in flight', async () => {
  const written: string[] = [];
  let release: (() => void) | undefined;
  const controller = {
    set(_schema: unknown, args: { symbol: string }) {
      written.push(args.symbol);
      if (!release) {
        return new Promise<void>(resolve => {
          release = resolve;
        });
      }
      return Promise.resolve();
    },
  };
  const sockets: { onmessage: ((event: { data: string }) => void) | null }[] = [];
  const Original = globalThis.WebSocket;
  class FakeSocket {
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(_url: string) {
      sockets.push(this);
    }
    close() {
      this.onclose?.();
    }
    send() {}
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const stream = new TickerStream();
  try {
    const next = stream.middleware(controller as unknown as Controller);
    await next(() => Promise.resolve())({
      type: actionTypes.SUBSCRIBE,
      endpoint: getTickers,
    } as never);
    sockets[0].onmessage?.({ data: JSON.stringify([mini('BTCUSDT', '1', 1)]) });
    sockets[0].onmessage?.({ data: JSON.stringify([mini('ETHUSDT', '2', 2)]) });
    sockets[0].onmessage?.({ data: JSON.stringify([mini('ADAUSDT', '3', 3)]) });
    expect(written).toEqual(['BTCUSDT']);
    release?.();
    await act(async () => {
      await Promise.resolve();
    });
    expect(written).toEqual(['BTCUSDT', 'ETHUSDT', 'ADAUSDT']);
  } finally {
    stream.cleanup();
    globalThis.WebSocket = Original;
  }
});

describe('reopen', () => {
  let restore = () => {};

  beforeEach(() => {
    jest.useFakeTimers();
    restore = installFakeSocket().restore;
  });

  afterEach(() => {
    jest.useRealTimers();
    restore();
  });

  it('fetches tickers only when a socket opens after a failure', async () => {
    const fetch = jest.fn(() => Promise.reject(new Error('offline')));
    const stream = new TickerStream();
    try {
      const handle = stream.middleware({ fetch } as unknown as Controller);
      await handle(() => Promise.resolve())({
        type: actionTypes.SUBSCRIBE,
        endpoint: getTickers,
      } as never);
      FakeSocket.instances[0].open();
      expect(fetch).not.toHaveBeenCalled();
      FakeSocket.instances[0].drop();
      jest.advanceTimersByTime(500);
      FakeSocket.instances[1].open();
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(getTickers);
    } finally {
      stream.cleanup();
    }
  });

  it('opens nothing when the subscriber leaves during the reconnect wait', async () => {
    const stream = new TickerStream();
    try {
      const handle = stream.middleware({ fetch: jest.fn() } as unknown as Controller);
      await handle(() => Promise.resolve())({
        type: actionTypes.SUBSCRIBE,
        endpoint: getTickers,
      } as never);
      FakeSocket.instances[0].drop();
      await handle(() => Promise.resolve())({
        type: actionTypes.UNSUBSCRIBE,
        endpoint: getTickers,
      } as never);
      jest.advanceTimersByTime(60_000);
      expect(FakeSocket.instances).toHaveLength(1);
    } finally {
      stream.cleanup();
    }
  });
});

it('keeps a newer last price when an older ticker snapshot arrives', async () => {
  const { result, controller } = renderDataHook(() =>
    useQuery(Ticker, { symbol: 'BTCUSDT' }),
  );
  let promise: Promise<void> | undefined;
  act(() => {
    promise = controller.set(Ticker, { symbol: 'BTCUSDT' }, mini('BTCUSDT', '50', 200));
  });
  await promise;
  expect(result.current?.last).toBe(50);

  const row = {
    symbol: 'BTCUSDT',
    lastPrice: '10',
    openPrice: '100',
    highPrice: '10',
    lowPrice: '1',
    volume: '1',
    quoteVolume: '9',
    closeTime: 100,
  };
  act(() => {
    promise = controller.resolve(getTickers, {
      args: [],
      response: [row],
      fetchedAt: 1,
    });
  });
  await promise;
  expect(result.current?.last).toBe(50);

  act(() => {
    promise = controller.resolve(getTickers, {
      args: [],
      response: [{ ...row, lastPrice: '80', closeTime: 300 }],
      fetchedAt: 2,
    });
  });
  await promise;
  expect(result.current?.last).toBe(80);
});
