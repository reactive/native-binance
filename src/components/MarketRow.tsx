import { useQuery } from '@data-client/react';
import { Badge, Skeleton, Text, useTheme } from '@reactive/silk-native';
import { memo, type JSX } from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';

import { decimalsOf, formatPercent, formatPrice, formatQuoteVolume } from '@/components/formatMarket';
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

function rowStack(type: {
  label: { size: number; lineHeight: number };
  caption: { size: number; lineHeight: number };
}): { labelLine: number; captionLine: number; rowTop: number } {
  const labelLine = type.label.size * type.label.lineHeight;
  const captionLine = type.caption.size * type.caption.lineHeight;
  return {
    labelLine,
    captionLine,
    rowTop: (MARKET_ROW_HEIGHT - labelLine - captionLine) / 2,
  };
}

export function MarketSkeletonRow(): JSX.Element {
  const { theme } = useTheme();
  const { labelLine, captionLine, rowTop } = rowStack(theme.semantic.typography);
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: theme.semantic.color.borderSubtle, paddingTop: rowTop },
      ]}
    >
      <View style={styles.name}>
        <View style={[styles.slot, { height: labelLine }]}>
          <Skeleton style={styles.baseSkeleton} />
        </View>
        <View style={[styles.slot, { height: captionLine }]}>
          <Skeleton style={styles.volumeSkeleton} />
        </View>
      </View>
      <View style={styles.price}>
        <View style={[styles.slot, { height: labelLine }]}>
          <Skeleton style={styles.priceSkeleton} />
        </View>
        <View style={[styles.slot, { height: captionLine }]}>
          <Skeleton style={styles.percentSkeleton} />
        </View>
      </View>
    </View>
  );
}

export const MarketRow = memo(function MarketRow({
  symbol,
  onPress,
}: MarketRowProps): JSX.Element {
  const instrument = useQuery(MarketSymbol, { symbol });
  const ticker = useQuery(Ticker, { symbol });
  const { theme } = useTheme();
  const color = theme.semantic.color;
  const { labelLine, captionLine, rowTop } = rowStack(theme.semantic.typography);
  const up = color.tones.success.solid;
  const down = color.tones.danger.solid;

  if (!instrument) {
    return (
      <View
        style={[styles.row, { borderBottomColor: color.borderSubtle, paddingTop: rowTop }]}
      />
    );
  }

  const price =
    ticker ? formatPrice(ticker.last, instrument.pricePlaces ?? decimalsOf(ticker.last)) : '';
  const percent = ticker ? formatPercent(ticker.percent) : '';
  const volume = ticker ? formatQuoteVolume(ticker.quoteVolume) : '';
  const halted = instrument.status !== 'TRADING';
  const direction = !ticker ? 0 : ticker.percent > 0 ? 1 : ticker.percent < 0 ? -1 : 0;
  const pair = `${instrument.baseAsset} ${instrument.quoteAsset}`;
  const volumeClause = volume ? `, volume ${volume}` : '';

  return (
    <Pressable
      testID={`market-${symbol}`}
      accessibilityRole="button"
      accessibilityLabel={
        halted ?
          `${pair}, ${ticker ? price : 'price loading'}, ${instrument.status}${volumeClause}`
        : ticker ? `${pair}, ${price}, ${percent}${volumeClause}`
        : `${pair}, price loading`
      }
      onPress={() => onPress(symbol)}
      style={[styles.row, { borderBottomColor: color.borderSubtle, paddingTop: rowTop }]}
    >
      <View style={styles.name}>
        <Text role="label">{instrument.baseAsset}</Text>
        <Text role="caption" tone="secondary">
          {volume ? `${volume} ${instrument.quoteAsset}` : instrument.quoteAsset}
        </Text>
      </View>
      <View style={styles.price}>
        {ticker ?
          <Text role="label" style={TABULAR}>
            {price}
          </Text>
        : <View style={[styles.slot, { height: labelLine }]}>
            <Skeleton style={styles.priceSkeleton} />
          </View>
        }
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
        : <View style={[styles.slot, { height: captionLine }]}>
            <Skeleton style={styles.percentSkeleton} />
          </View>
        }
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    height: MARKET_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  slot: {
    justifyContent: 'center',
  },
  baseSkeleton: {
    width: 48,
    height: 14,
  },
  volumeSkeleton: {
    width: 64,
    height: 12,
  },
  priceSkeleton: {
    width: 88,
    height: 14,
  },
  percentSkeleton: {
    width: 56,
    height: 12,
  },
  badge: {
    alignSelf: 'flex-end',
  },
});
