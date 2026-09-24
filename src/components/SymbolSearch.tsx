import { useQuery } from '@data-client/react';
import { Input, Text, useTheme } from '@reactive/silk-native';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';

import { holdOrder, idleHold, type HoldEvent } from '@/components/holdOrder';
import { MARKET_ROW_HEIGHT, MarketRow } from '@/components/MarketRow';
import { getMarkets } from '@/resources/Markets';

const TOP_BAR = 48;
const FIELD_WIDTH = 172;
const GUTTER = 12;
const HIT = 44;

function getItemLayout(_: ArrayLike<string> | null | undefined, index: number) {
  return { length: MARKET_ROW_HEIGHT, offset: MARKET_ROW_HEIGHT * index, index };
}

function keyExtractor(symbol: string): string {
  return symbol;
}

/** The markets field and rows, opened from a pair title. Empty and no-match stay blank. */
export function SymbolSearch({
  onDismiss,
  onSelect,
}: {
  onDismiss: () => void;
  onSelect: (symbol: string) => void;
}): JSX.Element {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const args = useMemo(() => ({ allQuotes: true, sort: 'volume' as const, q }), [q]);
  const rows = useQuery(getMarkets, args) ?? [];
  const volumesReady =
    rows.length > 0 && rows.every(row => row.ticker != null || row.status !== 'TRADING');
  const liveIds = useMemo(() => rows.map(row => row.symbol), [rows]);
  const liveRef = useRef(liveIds);
  liveRef.current = liveIds;

  const [hold, dispatch] = useReducer(holdOrder, idleHold);
  const argsSeen = useRef(q);
  if (argsSeen.current !== q) {
    argsSeen.current = q;
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
    ({ item }) => <MarketRow symbol={item} onPress={onSelect} />,
    [onSelect],
  );

  return (
    <View
      testID="symbol-search"
      style={[styles.fill, { backgroundColor: theme.semantic.color.surface }]}
    >
      <View style={styles.topBar}>
        <Pressable
          testID="symbol-search-dismiss"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onDismiss}
          style={styles.hit}
        >
          <Text role="heading">←</Text>
        </Pressable>
        <View style={styles.gap} />
        <Input
          size="sm"
          value={query}
          onChangeText={setQuery}
          placeholder="Find a symbol"
          accessibilityLabel="Find a symbol"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          testID="symbol-search-field"
          style={styles.search}
        />
      </View>
      {ids.length === 0 ?
        null
      : <View
          style={styles.list}
          onTouchStart={holdFinger}
          onTouchEnd={releaseFinger}
          onTouchCancel={releaseFinger}
          onPointerDown={holdFinger}
          onPointerUp={releaseFinger}
          onPointerCancel={releaseFinger}
        >
          <FlatList
            key={q}
            testID="symbol-search-results"
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
        </View>
      }
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  topBar: {
    height: TOP_BAR,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  hit: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: {
    flex: 1,
  },
  search: {
    width: FIELD_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
    marginRight: GUTTER,
  },
  list: {
    flex: 1,
  },
});
