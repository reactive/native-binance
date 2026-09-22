import { actionTypes } from '@data-client/react';
import type { Controller } from '@data-client/react';
import { act } from 'react';

import { getTrades, newTrades } from './Trade';
import TradeStream from './TradeStream';

const BTC_URL = 'wss://data-stream.binance.vision/ws/btcusdt@aggTrade';
const ETH_URL = 'wss://data-stream.binance.vision/ws/ethusdt@aggTrade';

type FakeSocket = {
  url: string;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  closed: boolean;
};

function installSockets() {
  const sockets: FakeSocket[] = [];
  const Original = globalThis.WebSocket;
  class Fake {
    url: string;
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    closed = false;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
    send() {}
  }
  globalThis.WebSocket = Fake as unknown as typeof WebSocket;
  return {
    sockets,
    restore() {
      globalThis.WebSocket = Original;
    },
  };
}

function frame(a: number, symbol = 'BTCUSDT', event = 'aggTrade') {
  return { e: event, E: a, s: symbol, a, p: '1', q: '1', T: a, m: a % 2 === 0 };
}

function subscribe(symbol: string) {
  return { type: actionTypes.SUBSCRIBE, endpoint: getTrades, args: [{ symbol }] };
}

function unsubscribe(symbol: string) {
  return { type: actionTypes.UNSUBSCRIBE, endpoint: getTrades, args: [{ symbol }] };
}

function harness() {
  const sets: { schema: unknown; args: { symbol: string }; value: unknown[] }[] = [];
  let listed = false;
  const fetch = jest.fn(() => Promise.resolve());
  const controller = {
    fetch,
    getState: () => ({}),
    get: () => (listed ? [] : undefined),
    set(schema: unknown, args: { symbol: string }, value: unknown[]) {
      sets.push({ schema, args, value });
      return Promise.resolve();
    },
  };
  const installed = installSockets();
  const stream = new TradeStream();
  const handle = stream.middleware(controller as unknown as Controller)(async action => {
    if (action.type === actionTypes.SET_RESPONSE) listed = true;
  });
  const dispatch = (action: object) => handle(action as never);
  return {
    sets,
    fetch,
    sockets: installed.sockets,
    stream,
    dispatch,
    listed() {
      listed = true;
    },
    restore: installed.restore,
  };
}

it('reference-counts one aggregate-trade socket per symbol', async () => {
  const { sockets, dispatch, stream, restore } = harness();
  try {
    await dispatch(subscribe('BTCUSDT'));
    expect(sockets.map(socket => socket.url)).toEqual([BTC_URL]);
    await dispatch(subscribe('BTCUSDT'));
    await dispatch(unsubscribe('BTCUSDT'));
    expect(sockets[0].closed).toBe(false);
    await dispatch(unsubscribe('BTCUSDT'));
    expect(sockets[0].closed).toBe(true);
  } finally {
    stream.cleanup();
    restore();
  }
});

it('snapshots the tape when the socket opens', async () => {
  const { sockets, dispatch, fetch, stream, restore } = harness();
  try {
    await dispatch(subscribe('BTCUSDT'));
    sockets[0].onopen?.();
    expect(fetch).toHaveBeenCalledWith(getTrades, { symbol: 'BTCUSDT' });
  } finally {
    stream.cleanup();
    restore();
  }
});

it('holds prints that arrive during a snapshot and writes them once', async () => {
  const { sockets, dispatch, sets, stream, restore } = harness();
  try {
    await dispatch(subscribe('BTCUSDT'));
    await dispatch({
      type: actionTypes.FETCH,
      endpoint: getTrades,
      args: [{ symbol: 'BTCUSDT' }],
      meta: { fetchedAt: 5 },
    } as never);
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1)) });
    sockets[0].onmessage?.({ data: JSON.stringify(frame(2)) });
    expect(sets).toHaveLength(0);

    await dispatch({
      type: actionTypes.SET_RESPONSE,
      endpoint: getTrades,
      args: [{ symbol: 'BTCUSDT' }],
      meta: { fetchedAt: 5 },
    } as never);

    expect(sets).toHaveLength(1);
    expect(sets[0].schema).toBe(newTrades);
    expect(sets[0].args).toEqual({ symbol: 'BTCUSDT' });
    expect(sets[0].value.map(row => (row as { a: number }).a)).toEqual([1, 2]);
  } finally {
    stream.cleanup();
    restore();
  }
});

it('ignores another symbol, a non-trade frame, and invalid JSON', async () => {
  const { sockets, dispatch, sets, stream, restore, listed } = harness();
  try {
    await dispatch(subscribe('BTCUSDT'));
    listed();
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1, 'ETHUSDT')) });
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1, 'BTCUSDT', 'depthUpdate')) });
    sockets[0].onmessage?.({ data: '{' });
    expect(sets).toHaveLength(0);
    sockets[0].onmessage?.({ data: JSON.stringify(frame(3)) });
    expect(sets).toHaveLength(1);
    expect(sets[0].value).toHaveLength(1);
  } finally {
    stream.cleanup();
    restore();
  }
});

it('writes a burst as batches of at most 100', async () => {
  const { sockets, dispatch, sets, stream, restore, listed } = harness();
  try {
    await dispatch(subscribe('BTCUSDT'));
    listed();
    for (let id = 1; id <= 250; id++) {
      sockets[0].onmessage?.({ data: JSON.stringify(frame(id)) });
    }
    await act(async () => {
      await Promise.resolve();
    });
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every(write => write.value.length <= 100)).toBe(true);
    const written = sets.reduce((count, write) => count + write.value.length, 0);
    expect(written).toBeLessThanOrEqual(101);
  } finally {
    stream.cleanup();
    restore();
  }
});

it('closes only the symbol that was unsubscribed', async () => {
  const { sockets, dispatch, stream, restore } = harness();
  try {
    await dispatch(subscribe('ETHUSDT'));
    await dispatch(subscribe('BTCUSDT'));
    await dispatch(unsubscribe('BTCUSDT'));
    const btc = sockets.find(socket => socket.url === BTC_URL);
    const eth = sockets.find(socket => socket.url === ETH_URL);
    expect(btc?.closed).toBe(true);
    expect(eth?.closed).toBe(false);
  } finally {
    stream.cleanup();
    restore();
  }
});
