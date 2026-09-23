import { act } from 'react';

export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? (map.get(key) ?? null) : null;
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

/** A controller write notifies React. `act` flushes that update before the assertion. */
export function actWrite<T>(run: () => T): T {
  let value!: T;
  act(() => {
    value = run();
  });
  return value;
}
