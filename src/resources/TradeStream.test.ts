import { actionTypes } from '@data-client/react';
import type { Controller } from '@data-client/react';
import { act } from 'react';

import { tradeStream } from './streams';
import { getTrades, newTrades } from './Trade';
import TradeStream from './TradeStream';
import { installFakeSocket } from './testSocket';

const BTC_URL = tradeStream('BTCUSDT');
const ETH_URL = tradeStream('ETHUSDT');

function frame(a: number, symbol = 'BTCUSDT', event = 'aggTrade') {
  return { e: event, E: a, s: symbol, a, p: '1', q: '1', T: a, m: a % 2 === 0 };
}

function subscribe(symbol: string) {
  return { type: actionTypes.SUBSCRIBE, endpoint: getTrades, args: [{ symbol }] };
}

function unsubscribe(symbol: string) {
  return { type: actionTypes.UNSUBSCRIBE, endpoint: getTrades, args: [{ symbol }] };
}

function nextFrame() {
  return act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
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
  const installed = installFakeSocket();
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

async function withTrade(run: (h: ReturnType<typeof harness>) => Promise<void>) {
  const h = harness();
  try {
    await run(h);
  } finally {
    h.stream.cleanup();
    h.restore();
  }
}

function fetched(fetchedAt: number) {
  return {
    type: actionTypes.FETCH,
    endpoint: getTrades,
    args: [{ symbol: 'BTCUSDT' }],
    meta: { fetchedAt },
  };
}

function landed(fetchedAt: number) {
  return {
    type: actionTypes.SET_RESPONSE,
    endpoint: getTrades,
    args: [{ symbol: 'BTCUSDT' }],
    meta: { fetchedAt },
  };
}

it('reference-counts one aggregate-trade socket per symbol', async () => {
  await withTrade(async ({ sockets, dispatch }) => {
    await dispatch(subscribe('BTCUSDT'));
    expect(sockets.map(socket => socket.url)).toEqual([BTC_URL]);
    await dispatch(subscribe('BTCUSDT'));
    await dispatch(unsubscribe('BTCUSDT'));
    expect(sockets[0].closed).toBe(false);
    await dispatch(unsubscribe('BTCUSDT'));
    expect(sockets[0].closed).toBe(true);
  });
});

it('snapshots the tape when the socket opens', async () => {
  await withTrade(async ({ sockets, dispatch, fetch }) => {
    await dispatch(subscribe('BTCUSDT'));
    sockets[0].onopen?.();
    expect(fetch).toHaveBeenCalledWith(getTrades, { symbol: 'BTCUSDT' });
  });
});

it('holds prints that arrive during a snapshot and writes them once', async () => {
  await withTrade(async ({ sockets, dispatch, sets }) => {
    await dispatch(subscribe('BTCUSDT'));
    await dispatch(fetched(5));
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1)) });
    sockets[0].onmessage?.({ data: JSON.stringify(frame(2)) });
    expect(sets).toHaveLength(0);

    await dispatch(landed(5));

    expect(sets).toHaveLength(1);
    expect(sets[0].schema).toBe(newTrades);
    expect(sets[0].args).toEqual({ symbol: 'BTCUSDT' });
    expect(sets[0].value.map(row => (row as { a: number }).a)).toEqual([1, 2]);
  });
});

it('releases the buffer when a second fetch is throttled onto the first response', async () => {
  await withTrade(async ({ sockets, dispatch, sets }) => {
    await dispatch(subscribe('BTCUSDT'));
    await dispatch(fetched(5));
    await dispatch(fetched(9));
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1)) });
    expect(sets).toHaveLength(0);

    await dispatch(landed(5));

    expect(sets).toHaveLength(1);
    expect(sets[0].value.map(row => (row as { a: number }).a)).toEqual([1]);
  });
});

it('ignores another symbol, a non-trade frame, and invalid JSON', async () => {
  await withTrade(async ({ sockets, dispatch, sets, listed }) => {
    await dispatch(subscribe('BTCUSDT'));
    listed();
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1, 'ETHUSDT')) });
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1, 'BTCUSDT', 'depthUpdate')) });
    sockets[0].onmessage?.({ data: '{' });
    await nextFrame();
    expect(sets).toHaveLength(0);
    sockets[0].onmessage?.({ data: JSON.stringify(frame(3)) });
    await nextFrame();
    expect(sets).toHaveLength(1);
    expect(sets[0].value).toHaveLength(1);
  });
});

it('writes a burst as batches of at most 100', async () => {
  await withTrade(async ({ sockets, dispatch, sets, listed }) => {
    await dispatch(subscribe('BTCUSDT'));
    listed();
    for (let id = 1; id <= 250; id++) {
      sockets[0].onmessage?.({ data: JSON.stringify(frame(id)) });
    }
    await nextFrame();
    expect(sets).toHaveLength(1);
    expect(sets[0].value).toHaveLength(100);
    expect((sets[0].value[0] as { a: number }).a).toBe(151);
    expect((sets[0].value[99] as { a: number }).a).toBe(250);
  });
});

it('drops a scheduled flush after unsubscribe', async () => {
  await withTrade(async ({ sockets, dispatch, sets, listed }) => {
    await dispatch(subscribe('BTCUSDT'));
    listed();
    sockets[0].onmessage?.({ data: JSON.stringify(frame(1)) });
    await dispatch(unsubscribe('BTCUSDT'));
    await nextFrame();
    expect(sets).toHaveLength(0);
  });
});

it('catches a rejected tape snapshot', async () => {
  await withTrade(async ({ sockets, dispatch, fetch }) => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    await dispatch(subscribe('BTCUSDT'));
    sockets[0].onopen?.();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(getTrades, { symbol: 'BTCUSDT' });
  });
});

it('closes only the symbol that was unsubscribed', async () => {
  await withTrade(async ({ sockets, dispatch }) => {
    await dispatch(subscribe('ETHUSDT'));
    await dispatch(subscribe('BTCUSDT'));
    await dispatch(unsubscribe('BTCUSDT'));
    const btc = sockets.find(socket => socket.url === BTC_URL);
    const eth = sockets.find(socket => socket.url === ETH_URL);
    expect(btc?.closed).toBe(true);
    expect(eth?.closed).toBe(false);
  });
});
