import { AsyncBoundary, useLive, useQuery, useSuspense } from '@data-client/react';
import { Badge, Heading, Skeleton, Text, useTheme } from '@reactive/silk-native';
import { router } from 'expo-router';
import { useState, type JSX } from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChartBody from '@/components/ChartBody';
import { InstrumentInfo } from '@/components/InstrumentInfo';
import OrderBookView from '@/components/OrderBookView';
import { decimalsOf, formatPercent, formatPrice, formatQuoteVolume } from '@/components/formatMarket';
import type { CandleInterval } from '@/resources/Candle';
import { getOrderBook } from '@/resources/OrderBook';
import { getExchangeInfo, MarketSymbol } from '@/resources/Symbol';
import { getTickers, Ticker } from '@/resources/Ticker';

const TOP_BAR = 48;
const STRIP = 64;
const SEGMENT = 44;
const HIT = 44;
const GUTTER = 12;

const SEGMENTS = ['Book', 'Trades', 'Chart', 'Info'] as const;
type Segment = (typeof SEGMENTS)[number];

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function PairTitle({ symbol }: { symbol: string }): JSX.Element {
  useSuspense(getExchangeInfo);
  const instrument = useQuery(MarketSymbol, { symbol });
  const title =
    instrument?.baseAsset && instrument.quoteAsset ?
      `${instrument.baseAsset} / ${instrument.quoteAsset}`
    : symbol;
  return (
    <Heading level="1" size="sm" numberOfLines={1} testID="symbol-pair">
      {title}
    </Heading>
  );
}

function TopBar({ symbol }: { symbol: string }): JSX.Element {
  return (
    <View style={styles.topBar}>
      <Pressable
        testID="back"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={goBack}
        style={styles.hit}
      >
        <Text role="headingSm">←</Text>
      </Pressable>
      <View style={styles.title}>
        <AsyncBoundary
          fallback={
            <Heading level="1" size="sm" numberOfLines={1} testID="symbol-pair">
              {symbol}
            </Heading>
          }
        >
          <PairTitle symbol={symbol} />
        </AsyncBoundary>
      </View>
      <Pressable
        testID="watch"
        accessibilityRole="button"
        accessibilityLabel="Watch"
        style={styles.hit}
      >
        <Text role="headingSm">☆</Text>
      </Pressable>
    </View>
  );
}

function PriceStripFallback(): JSX.Element {
  return (
    <View style={styles.strip}>
      <Skeleton style={styles.priceSkeleton} />
      <Skeleton style={styles.statSkeleton} />
    </View>
  );
}

function Stat({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID: string;
}): JSX.Element {
  return (
    <View style={styles.stat}>
      <Text role="caption" tone="secondary">
        {label}
      </Text>
      <Text role="caption" style={TABULAR} numberOfLines={1} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function TickerFeed(): null {
  useLive(getTickers);
  return null;
}

function PriceStrip({ symbol }: { symbol: string }): JSX.Element {
  useSuspense(getExchangeInfo);
  const ticker = useQuery(Ticker, { symbol });
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  if (!ticker) return <PriceStripFallback />;

  const places = instrument?.pricePlaces ?? decimalsOf(ticker.last);
  const last = formatPrice(ticker.last, places);
  const direction = ticker.percent > 0 ? 1 : ticker.percent < 0 ? -1 : 0;
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;

  return (
    <View style={styles.strip} testID="price-strip">
      <View style={styles.stripLine}>
        <Text role="headingLg" style={TABULAR} numberOfLines={1} testID="symbol-last">
          {last}
        </Text>
        {instrument && instrument.status !== '' && instrument.status !== 'TRADING' ?
          <Badge size="sm" testID="symbol-status">
            {instrument.status}
          </Badge>
        : <Text
            role="label"
            tone={direction === 0 ? 'secondary' : undefined}
            style={[TABULAR, direction > 0 ? { color: up } : direction < 0 ? { color: down } : null]}
            testID="symbol-percent"
          >
            {formatPercent(ticker.percent)}
          </Text>
        }
      </View>
      <View style={styles.stats}>
        <Stat label="High" value={formatPrice(ticker.high, places)} testID="symbol-high" />
        <Stat label="Low" value={formatPrice(ticker.low, places)} testID="symbol-low" />
        <Stat
          label="Volume"
          value={formatQuoteVolume(ticker.quoteVolume)}
          testID="symbol-volume"
        />
      </View>
    </View>
  );
}

function Segments({
  segment,
  onSelect,
}: {
  segment: Segment;
  onSelect: (segment: Segment) => void;
}): JSX.Element {
  return (
    <View style={styles.segments}>
      {SEGMENTS.map(item => (
        <Pressable
          key={item}
          testID={`segment-${item.toLowerCase()}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: item === segment }}
          onPress={() => onSelect(item)}
          style={styles.segment}
        >
          <Text role="label" tone={item === segment ? 'primary' : 'secondary'}>
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function LiveBook({ symbol }: { symbol: string }): JSX.Element {
  const book = useLive(getOrderBook, { symbol });
  // useQuery, not useSuspense: the book must not wait on exchange info.
  const instrument = useQuery(MarketSymbol, { symbol });
  return (
    <OrderBookView
      symbol={book.symbol}
      bids={book.bids}
      asks={book.asks}
      spread={book.spread}
      pricePlaces={instrument?.pricePlaces}
      sizePlaces={instrument?.sizePlaces}
    />
  );
}

export default function SymbolScreen({ symbol }: { symbol: string }): JSX.Element {
  const { theme } = useTheme();
  const [segment, setSegment] = useState<Segment>('Book');
  const [chartInterval, setChartInterval] = useState<CandleInterval>('15m');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.semantic.color.surface }]}>
      <TopBar symbol={symbol} />
      <AsyncBoundary fallback={null}>
        <TickerFeed />
      </AsyncBoundary>
      <AsyncBoundary fallback={<PriceStripFallback />}>
        <PriceStrip symbol={symbol} />
      </AsyncBoundary>
      <Segments segment={segment} onSelect={setSegment} />
      <View style={styles.body}>
        {segment === 'Book' ?
          <AsyncBoundary
            fallback={
              <Text tone="secondary" testID="book-loading">
                Loading {symbol}
              </Text>
            }
          >
            <LiveBook symbol={symbol} />
          </AsyncBoundary>
        : segment === 'Chart' ?
          <ChartBody
            symbol={symbol}
            interval={chartInterval}
            onInterval={setChartInterval}
          />
        : segment === 'Info' ?
          <AsyncBoundary
            fallback={
              <Text tone="secondary" testID="info-loading">
                Loading {symbol}
              </Text>
            }
          >
            <InstrumentInfo symbol={symbol} />
          </AsyncBoundary>
        : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  topBar: {
    height: TOP_BAR,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  hit: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  strip: {
    height: STRIP,
    flexShrink: 0,
    justifyContent: 'center',
    paddingHorizontal: GUTTER,
    gap: 2,
    overflow: 'hidden',
  },
  stripLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    minWidth: 0,
  },
  priceSkeleton: {
    width: 140,
    height: 28,
  },
  statSkeleton: {
    width: 220,
    height: 12,
  },
  segments: {
    height: SEGMENT,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    flex: 1,
    height: SEGMENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
});
