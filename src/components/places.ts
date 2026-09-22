import { useRef } from 'react';

import { decimalsOf } from '@/components/formatMarket';

export type Places = { readonly price: number; readonly size: number };
export type PlacesLock = { readonly price?: number; readonly size?: number };

const START = 2;
const CAP = 8;

function fieldPlaces(prev: number, samples: readonly number[], lock: number | undefined): number {
  if (lock !== undefined) return lock;
  let next = prev;
  for (let i = 0; i < samples.length; i++) {
    const places = decimalsOf(samples[i]);
    if (places > next) next = places;
  }
  return next > CAP ? CAP : next;
}

/** Locked fields take the instrument's places. Unlocked fields only widen (start 2, cap 8). */
export function nextPlaces(
  prev: Places,
  prices: readonly number[],
  sizes: readonly number[],
  lock: PlacesLock,
): Places {
  const price = fieldPlaces(prev.price, prices, lock.price);
  const size = fieldPlaces(prev.size, sizes, lock.size);
  if (price === prev.price && size === prev.size) return prev;
  return { price, size };
}

/** Holds `prev` in a ref; returns the same object when nothing changed so memoized rows skip. */
export function usePlaces(
  lock: PlacesLock,
  prices: readonly number[],
  sizes: readonly number[],
): Places {
  const ref = useRef<Places>({ price: START, size: START });
  const next = nextPlaces(ref.current, prices, sizes, lock);
  ref.current = next;
  return next;
}
