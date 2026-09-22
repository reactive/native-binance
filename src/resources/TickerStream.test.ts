import { actionTypes } from '@data-client/react';
import { act } from 'react';

import { getTickers } from './Ticker';
import TickerStream, { mergeTickerRows } from './TickerStream';

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
  try {
    const stream = new TickerStream();
    const next = stream.middleware(controller as never);
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
    globalThis.WebSocket = Original;
  }
});
