import { useFetch, useSubscription } from '@data-client/react';

import { getTickers } from '@/resources/Ticker';

/** Subscribes to the ticker socket without suspending or throwing on a failed read. */
export function TickerFeed(): null {
  useSubscription(getTickers);
  useFetch(getTickers);
  return null;
}
