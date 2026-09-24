import { useQuery } from '@data-client/react';
import { Input, Text, useTheme } from '@reactive/silk-native';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';

import { holdOrder, idleHold, type HoldEvent } from '@/components/holdOrder';
import { MARKET_ROW_HEIGHT, MarketRow } from '@/components/MarketRow';
import { findSymbols, searchKey } from '@/resources/Markets';

const TOP_BAR = 48;
const HIT = 44;
const GUTTER = 12;

function getItemLayout(_: ArrayLike<string> | null | undefined, index: number) {
  return { length: MARKET_ROW_HEIGHT, offset: MARKET_ROW_HEIGHT * index, index };
}

function keyExtractor(symbol: string): string {
  return symbol;
}

function SymbolResults({
  query,
  onChoose,
}: {
  query: string;
  onChoose: (symbol: string) => void;
}): JSX.Element | null {
  const q = searchKey(query);
  const args = useMemo(() => ({ q }), [q]);
  const rows = useQuery(findSymbols, args);
  const volumesReady =
    !!rows &&
    rows.length > 0 &&
    rows.every(row => row.ticker != null || row.status !== 'TRADING');
  const liveIds = useMemo(() => (rows ?? []).map(row => row.symbol), [rows]);
  const liveRef = useRef(liveIds);
  liveRef.current = liveIds;

  const [hold, dispatch] = useReducer(holdOrder, idleHold);
  const querySeen = useRef(q);
  if (querySeen.current !== q) {
    querySeen.current = q;
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

  // The first volume sort commits. Later ticks stay put, including under a finger.
  const ids = hold.committed ?? liveIds;
  const renderItem = useCallback<ListRenderItem<string>>(
    ({ item }) => <MarketRow symbol={item} onPress={onChoose} />,
    [onChoose],
  );

  if (!q || rows === undefined) return null;
  if (ids.length === 0) {
    return (
      <Text tone="secondary" testID="symbol-search-empty" style={styles.empty}>
        No markets match
      </Text>
    );
  }
  return (
    <View
      testID="symbol-search-list"
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
        initialNumToRender={13}
        maxToRenderPerBatch={13}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

/** Covers the symbol screen and leaves it mounted, so dismissing returns to the same reading. */
export function SymbolSearch({
  onChoose,
  onDismiss,
}: {
  onChoose: (symbol: string) => void;
  onDismiss: () => void;
}): JSX.Element {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => subscription.remove();
  }, [onDismiss]);

  return (
    <View
      testID="symbol-search"
      style={[styles.sheet, { backgroundColor: theme.semantic.color.surface }]}
    >
      <View style={styles.bar}>
        <Input
          size="sm"
          value={query}
          onChangeText={setQuery}
          onKeyPress={event => {
            if (event.nativeEvent.key === 'Escape') onDismiss();
          }}
          placeholder="Find a symbol"
          accessibilityLabel="Find a symbol"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          testID="symbol-search-field"
          style={styles.field}
        />
        <Pressable
          testID="symbol-search-cancel"
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.cancel}
        >
          <Text role="label">Cancel</Text>
        </Pressable>
      </View>
      <View style={styles.list}>
        <SymbolResults query={query} onChoose={onChoose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  bar: {
    height: TOP_BAR,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: GUTTER,
  },
  field: {
    flex: 1,
    minWidth: 0,
  },
  cancel: {
    height: HIT,
    justifyContent: 'center',
    paddingLeft: 8,
    paddingRight: GUTTER,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  empty: {
    paddingHorizontal: GUTTER,
    paddingTop: GUTTER,
  },
});
