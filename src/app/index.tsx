import { AsyncBoundary, useController, useSuspense } from '@data-client/react';
import { Heading, Skeleton, useTheme } from '@reactive/silk-native';
import { useEffect, useRef, useState, type JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadError } from '@/components/LoadError';
import { MARKET_ROW_HEIGHT } from '@/components/MarketRow';
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

function Markets(): JSX.Element {
  useSuspense(getExchangeInfo);
  const watchList = useSuspense(getWatching);
  const [quote, setQuote] = useState('USDT');
  const [sort, setSort] = useState<MarketSort>('volume');
  const [query, setQuery] = useState('');
  const [watching, setWatching] = useState(false);
  if (watching && watchList.length === 0) setWatching(false);
  const watchKey = watching ? watchList.map(item => item.symbol).join(',') : '';

  return (
    <View style={styles.body}>
      <TickerFeed />
      <MarketsChrome
        quote={quote}
        sort={sort}
        query={query}
        watching={watching}
        showWatching={watchList.length > 0}
        onQuote={next => {
          setWatching(false);
          setQuote(next);
        }}
        onWatching={() => setWatching(true)}
        onSort={setSort}
        onQuery={setQuery}
      />
      <MarketList quote={quote} sort={sort} query={query} watching={watching} watchKey={watchKey} />
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

function MarketsLoading(): JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={styles.body} testID="markets-loading">
      <View style={styles.title}>
        <Heading level="1" size="md">
          Markets
        </Heading>
      </View>
      {Array.from({ length: 11 }, (_, index) => (
        <View
          key={index}
          style={[styles.skeletonRow, { borderBottomColor: theme.semantic.color.borderSubtle }]}
        >
          <Skeleton style={styles.skeletonName} />
          <Skeleton style={styles.skeletonPrice} />
        </View>
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
      <AsyncBoundary fallback={<MarketsLoading />} errorComponent={MarketsError}>
        <Markets />
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
  title: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  skeletonRow: {
    height: MARKET_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  skeletonName: {
    width: 72,
    height: 14,
  },
  skeletonPrice: {
    width: 88,
    height: 14,
  },
});
