import { useLive, useQuery, useSuspense } from '@data-client/react';
import { Text, useTheme } from '@reactive/silk-native';
import { useCallback, useMemo, useReducer, useRef, type JSX } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { hasNewTrades, holdTape } from '@/components/holdTape';
import { usePlaces } from '@/components/places';
import { TRADE_ROW_HEIGHT, TradeRow, type TradePalette } from '@/components/TradeRow';
import { getTrades, type Trade } from '@/resources/Trade';
import { getExchangeInfo, MarketSymbol } from '@/resources/Symbol';

type TradeTapeProps = {
  symbol: string;
};

function getItemLayout(_: ArrayLike<Trade> | null | undefined, index: number) {
  return { length: TRADE_ROW_HEIGHT, offset: TRADE_ROW_HEIGHT * index, index };
}

function keyExtractor(trade: Trade): string {
  return String(trade.a);
}

export default function TradeTape({ symbol }: TradeTapeProps): JSX.Element {
  const key = symbol.toUpperCase();
  const trades = useLive(getTrades, { symbol: key });
  useSuspense(getExchangeInfo);
  const instrument = useQuery(MarketSymbol, { symbol: key });
  const { theme } = useTheme();
  const color = theme.semantic.color;

  const palette = useMemo<TradePalette>(
    () => ({
      buy: color.tones.success.solid,
      sell: color.tones.danger.solid,
    }),
    [color],
  );

  const liveRef = useRef(trades);
  liveRef.current = trades;

  const [hold, dispatch] = useReducer(holdTape<Trade>, { held: null });
  const shown = hold.held ?? trades;
  const hasNew = hasNewTrades(hold.held, trades);
  const priceSample: number[] = [];
  const sizeSample: number[] = [];
  const sampleCount = Math.min(shown.length, 16);
  for (let i = 0; i < sampleCount; i++) {
    priceSample.push(shown[i].price);
    sizeSample.push(shown[i].qty);
  }
  const places = usePlaces(
    { price: instrument?.pricePlaces, size: instrument?.sizePlaces },
    priceSample,
    sizeSample,
  );
  const listRef = useRef<FlatList<Trade>>(null);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    dispatch({
      type: 'scroll',
      offset: event.nativeEvent.contentOffset.y,
      live: liveRef.current,
    });
  }, []);

  const jumpToLatest = useCallback(() => {
    dispatch({ type: 'latest' });
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const renderItem = useCallback<ListRenderItem<Trade>>(
    ({ item, index }) => (
      <TradeRow
        trade={item}
        places={places}
        palette={palette}
        testID={index === 0 ? 'latest-trade' : undefined}
      />
    ),
    [palette, places],
  );

  return (
    <View style={styles.root}>
      {trades.length === 0 ?
        <Text tone="secondary" testID="trades-empty" style={styles.empty}>
          No trades yet
        </Text>
      : <FlatList
          ref={listRef}
          testID="trades"
          style={styles.list}
          data={shown}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          initialNumToRender={16}
          windowSize={7}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        />
      }
      {hasNew ?
        <View pointerEvents="box-none" style={styles.chipDock}>
          <Pressable
            testID="new-trades"
            accessibilityRole="button"
            accessibilityLabel="New trades"
            onPress={jumpToLatest}
            style={styles.chipHit}
          >
            <View
              style={[
                styles.pill,
                {
                  backgroundColor: color.tones.neutral.subtleActive,
                  borderRadius: theme.semantic.radius.full,
                },
              ]}
            >
              <Text role="label">New trades</Text>
            </View>
          </Pressable>
        </View>
      : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: 1,
  },
  empty: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  chipDock: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  chipHit: {
    height: 44,
    justifyContent: 'center',
  },
  pill: {
    height: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
