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
    // A fetch that rejects before DataProvider commits never reaches the reducer,
    // and NetworkManager keeps that promise, so a later fetch does not run.
    const timer = setTimeout(() => {
      const current = controllerRef.current;
      const state = current.getState();
      const { data } = current.getResponse(getExchangeInfo, state);
      const symbols =
        data && typeof data === 'object' && 'symbols' in data
          ? ((data as { symbols?: unknown[] }).symbols?.length ?? 0)
          : 0;
      if (symbols > 0 || current.getError(getExchangeInfo, state)) return;
      void Promise.resolve(getExchangeInfo()).then(
        response => current.setResponse(getExchangeInfo, response),
        (err: Error) => current.setError(getExchangeInfo, err),
      );
    }, 1200);
    return () => clearTimeout(timer);
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
