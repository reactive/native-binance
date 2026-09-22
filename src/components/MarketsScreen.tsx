import { useQuery } from '@data-client/react';
import { Heading, Input, Text, useTheme } from '@reactive/silk-native';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, type JSX } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';

import { holdOrder, idleHold, type HoldEvent } from '@/components/holdOrder';
import { MARKET_ROW_HEIGHT, MarketRow } from '@/components/MarketRow';
import { Reconnecting } from '@/components/Reconnecting';
import { getMarkets, type MarketSort } from '@/resources/Markets';
import { TICKER_STREAM } from '@/resources/streams';

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH'] as const;
const SORTS: readonly { id: MarketSort; label: string }[] = [
  { id: 'volume', label: 'Volume' },
  { id: 'change', label: 'Change' },
  { id: 'name', label: 'Name' },
];

const TITLE_HEIGHT = 48;
const TICKER_URLS = [TICKER_STREAM];
const QUOTE_HEIGHT = 40;
const SORT_HEIGHT = 36;
const GUTTER = 12;

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
};

function Chip({ label, selected, onPress, testID }: ChipProps): JSX.Element {
  const { theme } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[
        styles.chip,
        selected ?
          { backgroundColor: theme.semantic.color.tones.neutral.subtleActive }
        : null,
      ]}
    >
      <Text role="label" tone={selected ? 'primary' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

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
        <Heading level="1" size="md" numberOfLines={1} testID="markets-title">
          Markets
        </Heading>
        <Reconnecting urls={TICKER_URLS} testID="markets-reconnecting" />
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
          <Chip
            label="Watching"
            selected={watching}
            onPress={onWatching}
            testID="quote-watching"
          />
        : null}
        {QUOTES.map(item => (
          <Chip
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
          <Chip
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
    height: TITLE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    gap: 12,
  },
  search: {
    flex: 1,
  },
  empty: {
    paddingHorizontal: GUTTER,
    paddingTop: 12,
  },
  quotes: {
    height: QUOTE_HEIGHT,
    flexGrow: 0,
  },
  quotesContent: {
    height: QUOTE_HEIGHT,
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    gap: 8,
  },
  sorts: {
    height: SORT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
});
