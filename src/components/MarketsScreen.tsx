import { useQuery } from '@data-client/react';
import { Heading, Input, Text, useTheme } from '@reactive/silk-native';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, type JSX } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';

import { holdOrder, idleHold, type HoldEvent } from '@/components/holdOrder';
import { MARKET_ROW_HEIGHT, MarketRow } from '@/components/MarketRow';
import { Pill } from '@/components/Pill';
import { Reconnecting } from '@/components/Reconnecting';
import { getMarkets, type MarketSort } from '@/resources/Markets';
import { TICKER_STREAM } from '@/resources/streams';

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH'] as const;
const SORTS: readonly { id: MarketSort; label: string }[] = [
  { id: 'volume', label: 'Volume' },
  { id: 'change', label: 'Change' },
  { id: 'name', label: 'Name' },
];

const ROW = 44;
const FIELD_WIDTH = 172;
const TICKER_URLS = [TICKER_STREAM];
const GUTTER = 12;

function openBook(symbol: string) {
  router.push(`/symbol/${symbol}` as Href);
}

function getItemLayout(_: ArrayLike<string> | null | undefined, index: number) {
  return { length: MARKET_ROW_HEIGHT, offset: MARKET_ROW_HEIGHT * index, index };
}

export function MarketsChrome({
  quote,
  sort,
  query,
  watching,
  showWatching,
  onQuote,
  onWatching,
  onSort,
  onQuery,
}: {
  quote: string;
  sort: MarketSort;
  query: string;
  watching: boolean;
  showWatching: boolean;
  onQuote: (quote: string) => void;
  onWatching: () => void;
  onSort: (sort: MarketSort) => void;
  onQuery: (query: string) => void;
}): JSX.Element {
  const { theme } = useTheme();
  const line = theme.semantic.color.borderSubtle;
  return (
    <View>
      <View style={styles.title}>
        <Heading level="1" size="md" numberOfLines={1} testID="markets-title" style={styles.brand}>
          Markets
        </Heading>
        <View style={styles.titleGap} />
        <Reconnecting urls={TICKER_URLS} testID="markets-reconnecting" style={styles.reconnect} />
        <Input
          size="sm"
          value={query}
          onChangeText={onQuery}
          placeholder="Find a symbol"
          accessibilityLabel="Find a symbol"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          testID="market-search"
          style={styles.search}
        />
      </View>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.quotes}
        contentContainerStyle={styles.quotesContent}
      >
        {showWatching ?
          <Pill
            label="Watching"
            selected={watching}
            onPress={onWatching}
            testID="quote-watching"
          />
        : null}
        {QUOTES.map(item => (
          <Pill
            key={item}
            label={item}
            selected={!watching && item === quote}
            onPress={() => onQuote(item)}
            testID={`quote-${item}`}
          />
        ))}
      </ScrollView>
      <View style={[styles.sorts, { borderBottomColor: line }]}>
        {SORTS.map(item => (
          <Pill
            key={item.id}
            label={item.label}
            selected={item.id === sort}
            onPress={() => onSort(item.id)}
            testID={`sort-${item.id}`}
          />
        ))}
      </View>
    </View>
  );
}

export function MarketList({
  quote,
  sort,
  query,
  watching,
  watchKey,
}: {
  quote: string;
  sort: MarketSort;
  query: string;
  watching: boolean;
  /** Collection order, and only while Watching is selected. Volume sort must not change it. */
  watchKey: string;
}): JSX.Element {
  const q = query.trim().toLowerCase();
  const args = useMemo(() => ({ quote, sort, q, watching }), [quote, sort, q, watching]);
  const rows = useQuery(getMarkets, args) ?? [];
  const volumesReady =
    rows.length > 0 && rows.every(row => row.ticker != null || row.status !== 'TRADING');
  const liveIds = useMemo(() => rows.map(row => row.symbol), [rows]);
  const liveRef = useRef(liveIds);
  liveRef.current = liveIds;

  const [hold, dispatch] = useReducer(holdOrder, idleHold);
  const argsKey = `${quote}:${sort}:${q}:${watching}`;
  // Collection order, not the sorted row ids. A volume reorder must not fire `args`.
  const membershipKey = `${argsKey}:${watchKey}`;
  const argsSeen = useRef(membershipKey);
  if (argsSeen.current !== membershipKey) {
    argsSeen.current = membershipKey;
    const event: HoldEvent = { type: 'args', ids: liveIds, ready: volumesReady };
    dispatch(event);
  }

  useEffect(() => {
    if (!volumesReady) return;
    dispatch({ type: 'ready', ids: liveRef.current });
  }, [volumesReady, liveIds]);

  const holdFinger = useCallback(() => {
    dispatch({ type: 'down', ids: liveRef.current });
  }, []);
  const releaseFinger = useCallback(() => {
    dispatch({ type: 'up', ids: liveRef.current });
  }, []);

  const ids = hold.committed ?? liveIds;
  const renderItem = useCallback<ListRenderItem<string>>(
    ({ item }) => <MarketRow symbol={item} onPress={openBook} />,
    [],
  );

  return (
    <View
      style={styles.list}
      onTouchStart={holdFinger}
      onTouchEnd={releaseFinger}
      onTouchCancel={releaseFinger}
      onPointerDown={holdFinger}
      onPointerUp={releaseFinger}
      onPointerCancel={releaseFinger}
    >
      {ids.length === 0 ?
        <Text tone="secondary" testID="markets-empty" style={styles.empty}>
          No markets match
        </Text>
      : <FlatList
          // Quote, query, and sort start at the top. This key stays put while a symbol is open, so the offset is still here on the way back.
          key={argsKey}
          testID="markets"
          data={ids}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          showsVerticalScrollIndicator={false}
        />
      }
    </View>
  );
}

function keyExtractor(symbol: string): string {
  return symbol;
}

const styles = StyleSheet.create({
  title: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
  },
  brand: {
    flexShrink: 0,
  },
  titleGap: {
    flex: 1,
  },
  reconnect: {
    marginRight: 8,
  },
  search: {
    width: FIELD_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  empty: {
    paddingHorizontal: GUTTER,
    paddingTop: 12,
  },
  quotes: {
    height: ROW,
    flexGrow: 0,
  },
  quotesContent: {
    height: ROW,
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    gap: 8,
  },
  sorts: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: {
    flex: 1,
  },
});
