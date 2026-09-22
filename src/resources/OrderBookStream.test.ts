import { actionTypes } from '@data-client/react';
import type { Controller } from '@data-client/react';
import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getOrderBook } from './OrderBook';
import OrderBookStream from './OrderBookStream';

const URL = 'wss://data-stream.binance.vision/ws/btcusdt@depth@100ms';

type Handler = ((event?: { data: string }) => void) | null;

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  onmessage: Handler = null;
  onopen: Handler = null;
  onerror: Handler = null;
  onclose: Handler = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

const Original = globalThis.WebSocket;

function diff(U: number, u: number, bids: [string, string][] = [], asks: [string, string][] = []) {
  return JSON.stringify({ e: 'depthUpdate', s: 'BTCUSDT', U, u, b: bids, a: asks });
}

function bookFixture(lastUpdateId: number, bid = '100', ask = '101') {
  return {
    endpoint: getOrderBook,
    args: [{ symbol: 'BTCUSDT' }] as [{ symbol: string }],
    response: {
      lastUpdateId,
      bids: [[bid, '1']],
      asks: [[ask, '1']],
    },
  };
}

async function mount(snapshotId = 100) {
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  let releaseSnapshot: (value: {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
  }) => void = () => {};
  const snapshot = new Promise<{
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
  }>(resolve => {
    releaseSnapshot = resolve;
  });
  let fetches = 0;

  const { result, controller } = renderDataHook(
    () => useSuspense(getOrderBook, { symbol: 'BTCUSDT' }),
    {
      initialFixtures: [bookFixture(snapshotId)],
      resolverFixtures: [
        {
          endpoint: getOrderBook,
          response() {
            fetches += 1;
            return snapshot;
          },
        },
      ],
    },
  );

  const stream = new OrderBookStream();
  const handle = stream.middleware(controller)(async () => {});
  const set = controller.set.bind(controller);
  controller.set = ((...args: Parameters<Controller['set']>) => {
    let promise: Promise<void> | undefined;
    act(() => {
      promise = set(...args);
    });
    return promise ?? Promise.resolve();
  }) as Controller['set'];
  const resolve = controller.resolve.bind(controller);
  controller.resolve = ((endpoint, meta) => {
    const promise = resolve(endpoint, meta);
    return promise.then(() =>
      handle({
        type: actionTypes.SET_RESPONSE,
        endpoint,
        args: meta.args,
        error: Boolean(meta.error),
        response: meta.response,
      } as never),
    );
  }) as Controller['resolve'];

  await handle({
    type: actionTypes.SUBSCRIBE,
    endpoint: getOrderBook,
    args: [{ symbol: 'BTCUSDT' }],
  } as never);

  async function frame(data: string) {
    FakeSocket.instances.at(-1)?.onmessage?.({ data });
    await act(async () => {
      await Promise.resolve();
    });
  }

  return {
    result,
    controller,
    stream,
    frame,
    fetches: () => fetches,
    releaseSnapshot,
    socket: () => FakeSocket.instances.at(-1),
    sockets: () => FakeSocket.instances.length,
  };
}

afterEach(() => {
  globalThis.WebSocket = Original;
  FakeSocket.instances = [];
});

it('applies a diff that continues the snapshot', async () => {
  const { result, frame, stream } = await mount(100);
  try {
    await frame(diff(101, 105, [['100', '2']]));
    expect(result.current.lastUpdateId).toBe(105);
    expect(result.current.bids).toEqual([[100, 2]]);
    expect(result.current.asks).toEqual([[101, 1]]);
  } finally {
    stream.cleanup();
  }
});

it('refetches once on a gap, then applies the diffs that arrived during the snapshot', async () => {
  const { result, frame, stream, fetches, releaseSnapshot } = await mount(100);
  try {
    await frame(diff(120, 124, [['99', '3']]));
    expect(fetches()).toBe(1);
    expect(result.current.lastUpdateId).toBe(100);

    await frame(diff(131, 132, [['100', '4']]));
    await frame(diff(90, 95, [['1', '1']]));
    expect(fetches()).toBe(1);

    releaseSnapshot({
      lastUpdateId: 130,
      bids: [['100', '1']],
      asks: [['101', '1']],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetches()).toBe(1);
    expect(result.current.lastUpdateId).toBe(132);
    expect(result.current.bestBid).toBe(100);
    expect(result.current.bids[0]).toEqual([100, 4]);
    expect(result.current.asks).toEqual([[101, 1]]);
  } finally {
    stream.cleanup();
  }
});

it('resyncs the first diff after reconnect without emptying the book', async () => {
  const { result, frame, stream, fetches, releaseSnapshot, socket, sockets } = await mount(100);
  const seen: number[] = [];
  const note = () => {
    const book = result.current;
    expect(book).toBeDefined();
    expect(book.bids.length).toBeGreaterThan(0);
    expect(book.asks.length).toBeGreaterThan(0);
    seen.push(book.lastUpdateId);
  };
  try {
    note();
    await frame(diff(101, 105, [['100', '2']]));
    note();
    expect(result.current.lastUpdateId).toBe(105);

    socket()?.close();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 520));
    });
    expect(sockets()).toBe(2);
    expect(FakeSocket.instances[1].url).toBe(URL);
    note();

    await frame(diff(200, 205, [['90', '1']]));
    note();
    expect(fetches()).toBe(1);
    expect(result.current.lastUpdateId).toBe(105);

    releaseSnapshot({
      lastUpdateId: 210,
      bids: [['110', '2']],
      asks: [['111', '2']],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    note();
    expect(result.current.lastUpdateId).toBe(210);
    expect(result.current.bestBid).toBe(110);
    expect(seen.every(id => id > 0)).toBe(true);
  } finally {
    stream.cleanup();
  }
});
