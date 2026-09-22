import { readWatched, writeWatched } from './watchStorage';

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

it('returns [] for a missing, corrupt, or non-array value', () => {
  expect(readWatched()).toEqual([]);

  localStorage.setItem('watching.v1', '{');
  expect(readWatched()).toEqual([]);

  localStorage.setItem('watching.v1', JSON.stringify({ symbol: 'ETHUSDT' }));
  expect(readWatched()).toEqual([]);

  localStorage.setItem('watching.v1', JSON.stringify('ETHUSDT'));
  expect(readWatched()).toEqual([]);
});

it('uppercases, drops invalid entries, and keeps the first of a duplicate', () => {
  localStorage.setItem(
    'watching.v1',
    JSON.stringify(['ethusdt', 'ETHUSDT', 'x', 'BAD-ID', 1, null, 'BTCUSDT', 'ethusdt']),
  );
  expect(readWatched()).toEqual(['ETHUSDT', 'BTCUSDT']);
});

it('returns [] and throws when localStorage is missing', () => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  expect(readWatched()).toEqual([]);
  expect(() => writeWatched(['ETHUSDT'])).toThrow(/localStorage/);
});

it('round-trips a list and lets setItem errors escape', () => {
  writeWatched(['ETHUSDT', 'BTCUSDT']);
  expect(readWatched()).toEqual(['ETHUSDT', 'BTCUSDT']);
  expect(localStorage.getItem('watching.v1')).toBe('["ETHUSDT","BTCUSDT"]');

  localStorage.setItem = () => {
    throw new Error('disk full');
  };
  expect(() => writeWatched(['ETHUSDT'])).toThrow(/disk full/);
});
