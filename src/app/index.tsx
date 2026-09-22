import { AsyncBoundary, useLive, useSuspense } from '@data-client/react';
import { Heading, Skeleton, useTheme } from '@reactive/silk-native';
import { useState, type JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MARKET_ROW_HEIGHT } from '@/components/MarketRow';
import { MarketList, MarketsChrome } from '@/components/MarketsScreen';
import { getExchangeInfo } from '@/resources/Symbol';
import { getTickers } from '@/resources/Ticker';
import type { MarketSort } from '@/resources/Markets';

function TickerFeed(): null {
  useLive(getTickers);
  return null;
}

function Markets(): JSX.Element {
  useSuspense(getExchangeInfo);
  const [quote, setQuote] = useState('USDT');
  const [sort, setSort] = useState<MarketSort>('volume');

  return (
    <View style={styles.body}>
      <AsyncBoundary fallback={null}>
        <TickerFeed />
      </AsyncBoundary>
      <MarketsChrome quote={quote} sort={sort} onQuote={setQuote} onSort={setSort} />
      <MarketList quote={quote} sort={sort} />
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
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.semantic.color.surface }]}>
      <AsyncBoundary fallback={<MarketsLoading />}>
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
