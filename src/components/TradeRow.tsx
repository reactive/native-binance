import { Text } from '@reactive/silk-native';
import { memo, type JSX } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';

import { formatClock, formatPrice, formatSize } from '@/components/formatMarket';
import type { Places } from '@/components/places';
import type { Trade } from '@/resources/Trade';

export const TRADE_ROW_HEIGHT = 44;
const TIME_WIDTH = 72;
const GUTTER = 12;

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export type TradePalette = {
  readonly buy: string;
  readonly sell: string;
};

type TradeRowProps = {
  trade: Trade;
  places: Places;
  palette: TradePalette;
  testID?: string;
};

export const TradeRow = memo(function TradeRow({
  trade,
  places,
  palette,
  testID,
}: TradeRowProps): JSX.Element {
  const timeText = formatClock(trade.time);
  const priceText = formatPrice(trade.price, places.price);
  const sizeText = formatSize(trade.qty, places.size);
  const buy = trade.takerBuy;
  return (
    <View
      style={styles.row}
      testID={testID}
      accessible
      accessibilityLabel={`${buy ? 'Buy' : 'Sell'} ${priceText}, size ${sizeText}, ${timeText}`}
    >
      <Text role="caption" tone="secondary" style={[styles.time, TABULAR]} numberOfLines={1}>
        {timeText}
      </Text>
      <Text
        role="label"
        numberOfLines={1}
        style={[styles.price, TABULAR, { color: buy ? palette.buy : palette.sell }]}
      >
        {priceText}
      </Text>
      <Text role="bodySm" numberOfLines={1} style={[styles.size, TABULAR]}>
        {sizeText}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    height: TRADE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    overflow: 'hidden',
  },
  time: {
    width: TIME_WIDTH,
  },
  price: {
    flex: 1,
  },
  size: {
    flex: 1,
    textAlign: 'right',
  },
});
