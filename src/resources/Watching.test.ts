import { useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';
import { act } from 'react';

import { getWatching, setWatched, WatchedSymbol } from './Watching';
import { readWatched } from './watchStorage';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: memoryStorage(),
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function ids(rows: { symbol: string }[] | undefined) {
  return rows?.map(row => row.symbol);
}

function fetchWatched(
  controller: {
    fetch: (
      endpoint: typeof setWatched,
      body: { symbol: string; watched: boolean },
    ) => Promise<unknown>;
  },
  symbol: string,
  watched: boolean,
) {
  let promise: Promise<unknown> | undefined;
  act(() => {
    promise = controller.fetch(setWatched, { symbol, watched });
  });
  return promise!.then(async value => {
    // The fetch promise resolves before the store commit. One more turn lets the hook paint.
    await act(async () => {
      await Promise.resolve();
    });
    return value;
  });
}

/** `useSuspense(getWatching)` resolves on a microtask after the first render. */
async function paint() {
  await act(async () => {
    await Promise.resolve();
  });
}

function seed(ids: string[]) {
  localStorage.setItem('watching.v1', JSON.stringify(ids));
}

it('rehydrates one WatchedSymbol from storage', async () => {
  seed(['ETHUSDT']);
  const { result } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toBeInstanceOf(WatchedSymbol);
  expect(result.current[0]?.symbol).toBe('ETHUSDT');
});

it('keeps storage and the collection in agreement, without duplicate ids', async () => {
  seed(['ETHUSDT']);
  const { result, controller } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(ids(result.current)).toEqual(['ETHUSDT']);

  await fetchWatched(controller, 'BTCUSDT', true);
  expect(readWatched()).toEqual(['ETHUSDT', 'BTCUSDT']);
  expect(ids(result.current)).toEqual(['ETHUSDT', 'BTCUSDT']);

  await fetchWatched(controller, 'BTCUSDT', true);
  expect(readWatched()).toEqual(['ETHUSDT', 'BTCUSDT']);
  expect(ids(result.current)).toEqual(['ETHUSDT', 'BTCUSDT']);

  await fetchWatched(controller, 'ETHUSDT', false);
  expect(readWatched()).toEqual(['BTCUSDT']);
  expect(ids(result.current)).toEqual(['BTCUSDT']);
});

it('applies true then false issued without awaiting between them', async () => {
  const { result, controller } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  let add: Promise<unknown> | undefined;
  let remove: Promise<unknown> | undefined;
  act(() => {
    add = controller.fetch(setWatched, { symbol: 'ETHUSDT', watched: true });
    remove = controller.fetch(setWatched, { symbol: 'ETHUSDT', watched: false });
  });
  await add;
  await remove;
  await paint();
  expect(readWatched()).toEqual([]);
  expect(result.current).toEqual([]);
});

it('leaves the store unchanged when the write throws', async () => {
  seed(['ETHUSDT']);
  const { result, controller } = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(ids(result.current)).toEqual(['ETHUSDT']);
  localStorage.setItem = () => {
    throw new Error('disk full');
  };
  expect(() => {
    act(() => {
      controller.fetch(setWatched, { symbol: 'BTCUSDT', watched: true });
    });
  }).toThrow(/disk full/);
  expect(readWatched()).toEqual(['ETHUSDT']);
  expect(ids(result.current)).toEqual(['ETHUSDT']);
});

it('reads the list back from storage in a fresh store', async () => {
  const first = renderDataHook(() => useSuspense(getWatching));
  await paint();
  await fetchWatched(first.controller, 'ETHUSDT', true);
  expect(ids(first.result.current)).toEqual(['ETHUSDT']);
  first.unmount();

  const second = renderDataHook(() => useSuspense(getWatching));
  await paint();
  expect(ids(second.result.current)).toEqual(['ETHUSDT']);
  expect(second.result.current[0]).toBeInstanceOf(WatchedSymbol);
});
