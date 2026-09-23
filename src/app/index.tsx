import { AsyncBoundary, ErrorBoundary, useController, useSuspense } from '@data-client/react';
import { Heading, useTheme } from '@reactive/silk-native';
import { Suspense, useEffect, useRef, useState, type JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadError } from '@/components/LoadError';
import { MarketSkeletonRow } from '@/components/MarketRow';
import { MarketList, MarketsChrome } from '@/components/MarketsScreen';
import { TickerFeed } from '@/components/TickerFeed';
import type { MarketSort } from '@/resources/Markets';
import { getExchangeInfo } from '@/resources/Symbol';
import { getWatching } from '@/resources/Watching';

function exchangeInfoReady(controller: ReturnType<typeof useController>): boolean {
  const state = controller.getState();
  const { data } = controller.getResponse(getExchangeInfo, state);
  const symbols =
    data && typeof data === 'object' && 'symbols' in data
      ? ((data as { symbols?: unknown[] }).symbols?.length ?? 0)
      : 0;
  return symbols > 0 || Boolean(controller.getError(getExchangeInfo, state));
}

/** The first `/exchangeInfo` read has produced a resource-timing entry. */
function exchangeInfoReadFinished(): boolean {
  const timing = globalThis.performance;
  if (typeof timing?.getEntriesByType !== 'function') return false;
  return timing.getEntriesByType('resource').some(
    entry =>
      entry.name.includes('/exchangeInfo') &&
      'responseEnd' in entry &&
      (entry as { responseEnd: number }).responseEnd > 0,
  );
}

type ChromeState = {
  quote: string;
  sort: MarketSort;
  query: string;
  watching: boolean;
  showWatching: boolean;
  onQuote: (quote: string) => void;
  onWatching: () => void;
  onSort: (sort: MarketSort) => void;
  onQuery: (query: string) => void;
};

function MarketsReady({
  watchKey,
  quote,
  sort,
  query,
  watching,
}: Pick<ChromeState, 'quote' | 'sort' | 'query' | 'watching'> & {
  watchKey: string;
}): JSX.Element {
  useSuspense(getExchangeInfo);
  return (
    <MarketList
      quote={quote}
      sort={sort}
      query={query}
      watching={watching}
      watchKey={watchKey}
    />
  );
}

function MarketsShell(): JSX.Element {
  const watchList = useSuspense(getWatching);
  const [quote, setQuote] = useState('USDT');
  const [sort, setSort] = useState<MarketSort>('volume');
  const [query, setQuery] = useState('');
  const [watching, setWatching] = useState(false);
  if (watching && watchList.length === 0) setWatching(false);
  const watchKey = watching ? watchList.map(item => item.symbol).join(',') : '';
  const chrome: ChromeState = {
    quote,
    sort,
    query,
    watching,
    showWatching: watchList.length > 0,
    onQuote: next => {
      setWatching(false);
      setQuote(next);
    },
    onWatching: () => setWatching(true),
    onSort: setSort,
    onQuery: setQuery,
  };

  return (
    <View style={styles.body}>
      <TickerFeed />
      <ErrorBoundary fallbackComponent={MarketsError}>
        <MarketsChrome {...chrome} />
        <Suspense fallback={<MarketsSkeleton />}>
          <MarketsReady
            quote={quote}
            sort={sort}
            query={query}
            watching={watching}
            watchKey={watchKey}
          />
        </Suspense>
      </ErrorBoundary>
    </View>
  );
}

function MarketsError({
  resetErrorBoundary,
}: {
  resetErrorBoundary: () => void;
}): JSX.Element {
  return (
    <View style={styles.body}>
      <View style={styles.title}>
        <Heading level="1" size="md">
          Markets
        </Heading>
      </View>
      <LoadError what="the markets" onRetry={resetErrorBoundary} />
    </View>
  );
}

function MarketsSkeleton(): JSX.Element {
  return (
    <View style={styles.list} testID="markets-loading">
      {Array.from({ length: 11 }, (_, index) => (
        <MarketSkeletonRow key={index} />
      ))}
    </View>
  );
}

export default function HomeScreen(): JSX.Element {
  const { theme } = useTheme();
  const controller = useController();
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  useEffect(() => {
    // The symbol route is its own bundle. Load it while this screen is online
    // so opening a market still works after the network drops.
    void import('./symbol/[symbol]');
    // A read that fails before DataProvider commits never reaches the store, and
    // NetworkManager keeps the promise, so the boundary stays on the skeleton.
    // Only replace that read after its HTTP request has finished. An empty cache
    // before then is a slow first load, and a second failure must not cover it.
    let cancelled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (cancelled || exchangeInfoReady(controllerRef.current) || !exchangeInfoReadFinished()) {
        return;
      }
      grace = setTimeout(() => {
        const current = controllerRef.current;
        if (cancelled || exchangeInfoReady(current)) return;
        void Promise.resolve(getExchangeInfo()).then(
          response => {
            if (!cancelled && !exchangeInfoReady(current)) {
              current.setResponse(getExchangeInfo, response);
            }
          },
          (err: Error) => {
            if (!cancelled && !exchangeInfoReady(current)) {
              current.setError(getExchangeInfo, err);
            }
          },
        );
      }, 50);
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(grace);
    };
  }, []);
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.semantic.color.surface }]}>
      <AsyncBoundary fallback={<View style={styles.body} />} errorComponent={MarketsError}>
        <MarketsShell />
      </AsyncBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  title: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
