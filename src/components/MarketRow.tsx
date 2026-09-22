import { useQuery } from '@data-client/react';
import { Badge, Skeleton, Text, useTheme } from '@reactive/silk-native';
import { memo, type JSX } from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';

import { formatLast, formatPercent } from '@/components/formatMarket';
import { MarketSymbol } from '@/resources/Symbol';
import { Ticker } from '@/resources/Ticker';

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

export const MARKET_ROW_HEIGHT = 56;
const NAME_WIDTH = 120;
const GUTTER = 12;

type MarketRowProps = {
  symbol: string;
  onPress: (symbol: string) => void;
};

export const MarketRow = memo(function MarketRow({
  symbol,
  onPress,
}: MarketRowProps): JSX.Element {
  const instrument = useQuery(MarketSymbol, { symbol });
  const ticker = useQuery(Ticker, { symbol });
  const { theme } = useTheme();
  const color = theme.semantic.color;
  const up = color.tones.success.solid;
  const down = color.tones.danger.solid;

  if (!instrument) {
    return <View style={[styles.row, { borderBottomColor: color.borderSubtle }]} />;
  }

  const price = ticker ? formatLast(ticker.last, instrument.tickSize) : '';
  const percent = ticker ? formatPercent(ticker.percent) : '';
  const halted = instrument.status !== 'TRADING';
  const direction = !ticker ? 0 : ticker.percent > 0 ? 1 : ticker.percent < 0 ? -1 : 0;
  const pair = `${instrument.baseAsset} ${instrument.quoteAsset}`;

  return (
    <Pressable
      testID={`market-${symbol}`}
      accessibilityRole="button"
      accessibilityLabel={
        halted ?
          `${pair}, ${ticker ? price : 'price loading'}, ${instrument.status}`
        : ticker ? `${pair}, ${price}, ${percent}`
        : `${pair}, price loading`
      }
      onPress={() => onPress(symbol)}
      style={[styles.row, { borderBottomColor: color.borderSubtle }]}
    >
      <View style={styles.name}>
        <Text role="label">{instrument.baseAsset}</Text>
        <Text role="caption" tone="secondary">
          {instrument.quoteAsset}
        </Text>
      </View>
      <View style={styles.price}>
        {ticker ?
          <Text role="label" style={TABULAR}>
            {price}
          </Text>
        : <Skeleton style={styles.priceSkeleton} />}
        {halted ?
          <Badge size="sm" tone="neutral" testID={`status-${symbol}`} style={styles.badge}>
            {instrument.status}
          </Badge>
        : ticker ?
          <Text
            role="caption"
            tone={direction === 0 ? 'secondary' : undefined}
            style={[TABULAR, direction > 0 ? { color: up } : direction < 0 ? { color: down } : null]}
          >
            {percent}
          </Text>
        : <Skeleton style={styles.percentSkeleton} />}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    height: MARKET_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: GUTTER,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: {
    width: NAME_WIDTH,
  },
  price: {
    flex: 1,
    alignItems: 'flex-end',
  },
  priceSkeleton: {
    width: 88,
    height: 14,
  },
  percentSkeleton: {
    width: 56,
    height: 12,
    marginTop: 4,
  },
  badge: {
    alignSelf: 'flex-end',
    marginTop: 2,
  },
});
