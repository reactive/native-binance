import { AsyncBoundary, useLive, useQuery, useSuspense } from '@data-client/react';
import { Text, useTheme } from '@reactive/silk-native';
import { Fragment, type JSX } from 'react';
import {
  PixelRatio,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  candleLayout,
  candleMetrics,
  INTERVAL_ROW,
  PLOT_MARGIN,
  plotDeviceShift,
  plotSize,
  READOUT,
} from '@/components/candleLayout';
import { decimalsOf, formatPrice } from '@/components/formatMarket';
import {
  getCandles,
  INTERVALS,
  type Candle,
  type CandleInterval,
} from '@/resources/Candle';
import { getExchangeInfo, MarketSymbol } from '@/resources/Symbol';

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

function intervalLabel(interval: CandleInterval): string {
  return INTERVALS.find(item => item.value === interval)?.label ?? interval;
}

function IntervalChips({
  value,
  onSelect,
}: {
  value: CandleInterval;
  onSelect: (interval: CandleInterval) => void;
}): JSX.Element {
  return (
    <View style={styles.chips}>
      {INTERVALS.map(item => {
        const selected = item.value === value;
        return (
          <Pressable
            key={item.value}
            testID={`interval-${item.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(item.value)}
            style={styles.chip}
          >
            <Text role="label" tone={selected ? 'primary' : 'secondary'}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CandleReadout({
  symbol,
  candle,
}: {
  symbol: string;
  candle: Candle;
}): JSX.Element {
  useSuspense(getExchangeInfo);
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const places = instrument?.pricePlaces ?? decimalsOf(candle.close);
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;
  const closeColor = candle.close > candle.open ? up : candle.close < candle.open ? down : undefined;

  return (
    <View style={styles.readout}>
      <ReadoutItem label="Open" value={formatPrice(candle.open, places)} testID="candle-open" />
      <ReadoutItem label="High" value={formatPrice(candle.high, places)} testID="candle-high" />
      <ReadoutItem label="Low" value={formatPrice(candle.low, places)} testID="candle-low" />
      <ReadoutItem
        label="Close"
        value={formatPrice(candle.close, places)}
        testID="candle-close"
        color={closeColor}
      />
    </View>
  );
}

function ReadoutItem({
  label,
  value,
  testID,
  color,
}: {
  label: string;
  value: string;
  testID: string;
  color?: string;
}): JSX.Element {
  return (
    <View style={styles.readoutItem}>
      <Text role="caption" tone="secondary">
        {label}
      </Text>
      <Text
        role="caption"
        numberOfLines={1}
        style={[TABULAR, color ? { color } : null]}
        testID={testID}
      >
        {value}
      </Text>
    </View>
  );
}

function CandlePlot({
  symbol,
  interval,
  candles,
  width,
  height,
  insetTop,
  insetLeft,
}: {
  symbol: string;
  interval: CandleInterval;
  candles: readonly Candle[];
  width: number;
  height: number;
  insetTop: number;
  insetLeft: number;
}): JSX.Element {
  useSuspense(getExchangeInfo);
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const ratio = PixelRatio.get();
  const metrics = candleMetrics(width, ratio);
  const placed = candleLayout(candles, { width, height, ratio });
  const shift = plotDeviceShift(insetTop, insetLeft, ratio);
  const last = candles[candles.length - 1];
  const places = instrument?.pricePlaces ?? decimalsOf(last.close);
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;
  const flat = theme.semantic.color.textSecondary;
  const wickOffset = (metrics.body - metrics.wick) / 2;

  return (
    <View
      testID="candles"
      accessible
      accessibilityLabel={`${symbol} ${intervalLabel(interval)} candles. Open ${formatPrice(last.open, places)}, high ${formatPrice(last.high, places)}, low ${formatPrice(last.low, places)}, close ${formatPrice(last.close, places)}`}
      style={[styles.plot, { width, height }]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: width * ratio,
          height: height * ratio,
          transformOrigin: 'left top',
          // Translate in device pixels, then scale back to CSS px. CSS lengths snap to 1/64px,
          // which cannot land an 18-device-px body on the pixel grid at ratio 3.75.
          transform: [{ scale: 1 / ratio }, { translateX: -shift.x }, { translateY: -shift.y }],
        }}
      >
        {placed.map((item, index) => {
          const candle = candles[index];
          const color = item.direction === 'up' ? up : item.direction === 'down' ? down : flat;
          const newest = index === placed.length - 1;
          const x = Math.round(item.x * ratio);
          return (
            <Fragment key={candle.openTime}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: x + wickOffset,
                  top: Math.round(item.wickTop * ratio),
                  width: metrics.wick,
                  height: Math.round(item.wickHeight * ratio),
                  backgroundColor: color,
                }}
              />
              <View
                testID={newest ? 'candle-last' : undefined}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: x,
                  top: Math.round(item.bodyTop * ratio),
                  width: metrics.body,
                  height: Math.round(item.bodyHeight * ratio),
                  backgroundColor: color,
                }}
              />
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}

function LiveCandles({
  symbol,
  interval,
  width,
  height,
  insetTop,
  insetLeft,
}: {
  symbol: string;
  interval: CandleInterval;
  width: number;
  height: number;
  insetTop: number;
  insetLeft: number;
}): JSX.Element {
  const candles = useLive(getCandles, { symbol, interval });
  if (candles.length === 0) {
    return (
      <Text tone="secondary" testID="chart-empty">
        No candles yet
      </Text>
    );
  }
  const last = candles[candles.length - 1];
  return (
    <View>
      <CandlePlot
        symbol={symbol}
        interval={interval}
        candles={candles}
        width={width}
        height={height}
        insetTop={insetTop}
        insetLeft={insetLeft}
      />
      <CandleReadout symbol={symbol} candle={last} />
    </View>
  );
}

export default function ChartBody({
  symbol,
  interval,
  onInterval,
}: {
  symbol: string;
  interval: CandleInterval;
  onInterval: (interval: CandleInterval) => void;
}): JSX.Element {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const plot = plotSize(width, height, insets.top, insets.bottom);

  return (
    <View style={styles.body}>
      <IntervalChips value={interval} onSelect={onInterval} />
      <AsyncBoundary
        fallback={
          <Text tone="secondary" testID="chart-loading">
            Loading {symbol}
          </Text>
        }
      >
        <LiveCandles
          symbol={symbol}
          interval={interval}
          width={plot.width}
          height={plot.height}
          insetTop={insets.top}
          insetLeft={insets.left}
        />
      </AsyncBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  chips: {
    height: INTERVAL_ROW,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PLOT_MARGIN,
  },
  chip: {
    flex: 1,
    height: INTERVAL_ROW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plot: {
    marginHorizontal: PLOT_MARGIN,
    position: 'relative',
    overflow: 'hidden',
  },
  readout: {
    height: READOUT,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PLOT_MARGIN,
  },
  readoutItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
});
