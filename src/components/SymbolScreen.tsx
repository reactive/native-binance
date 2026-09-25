import { AsyncBoundary, useController, useLive, useQuery, useSuspense } from '@data-client/react';
import { Heading, Skeleton, Text, useTheme } from '@reactive/silk-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { PixelRatio, Pressable, StyleSheet, View, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChartBody, { type ScrubQuote } from '@/components/ChartBody';
import { DIRECTION_WORD } from '@/components/candleLayout';
import { InstrumentInfo } from '@/components/InstrumentInfo';
import { LoadError } from '@/components/LoadError';
import OrderBookView from '@/components/OrderBookView';
import { Reconnecting } from '@/components/Reconnecting';
import { useDismissSearchOnBack } from '@/components/searchBack';
import { SymbolSearch } from '@/components/SymbolSearch';
import { TickerFeed } from '@/components/TickerFeed';
import TradeTape from '@/components/TradeTape';
import {
  decimalsOf,
  formatCandleTime,
  formatPercent,
  formatPrice,
  formatQuoteVolume,
} from '@/components/formatMarket';
import type { CandleInterval } from '@/resources/Candle';
import { getOrderBook } from '@/resources/OrderBook';
import { getExchangeInfo, MarketSymbol } from '@/resources/Symbol';
import { Ticker } from '@/resources/Ticker';
import { getWatching, setWatched } from '@/resources/Watching';
import { depthStream, klineStream, TICKER_STREAM, tradeStream } from '@/resources/streams';

const TOP_BAR = 48;
const STRIP = 64;
const SEGMENT = 44;
const HIT = 44;
const GUTTER = 12;
const PAIR_MAX = 296;
const STATUS_MAX = 92;
const INDICATOR_PX = 8;

const SEGMENTS = ['Chart', 'Info', 'Book', 'Trades'] as const;
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
    <Heading level="1" size="sm" numberOfLines={1} testID="symbol-pair" style={styles.pair}>
      {title}
    </Heading>
  );
}

function WatchFallback(): JSX.Element {
  return (
    <Pressable
      testID="watch"
      accessibilityRole="button"
      accessibilityLabel="Watch"
      accessibilityState={{ disabled: true }}
      disabled
      style={styles.hit}
    >
      <Text role="heading">☆</Text>
    </Pressable>
  );
}

function WatchToggle({ symbol }: { symbol: string }): JSX.Element {
  const list = useSuspense(getWatching);
  const instrument = useQuery(MarketSymbol, { symbol });
  const controller = useController();
  const known = instrument != null;
  const watched = list.some(item => item.symbol === symbol);

  function onPress() {
    controller.fetch(setWatched, { symbol, watched: !watched }).catch(error => {
      console.warn(error);
    });
  }

  return (
    <Pressable
      testID="watch"
      accessibilityRole="button"
      accessibilityLabel={watched ? 'Stop watching' : 'Watch'}
      accessibilityState={{ selected: watched, disabled: !known }}
      disabled={!known}
      onPress={onPress}
      style={styles.hit}
    >
      <Text role="heading">{watched ? '★' : '☆'}</Text>
    </Pressable>
  );
}

function WatchControl({ symbol }: { symbol: string }): JSX.Element {
  const [mounted, setMounted] = useState(false);
  // The lazy route's first render is still inside the route promise. A fetch that
  // settles there updates the store before the provider has mounted, and the star
  // stays on this fallback. Wait until this screen has committed.
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <WatchFallback />;
  return (
    <AsyncBoundary fallback={<WatchFallback />}>
      <WatchToggle symbol={symbol} />
    </AsyncBoundary>
  );
}

function TopBar({
  symbol,
  retry,
  committed,
  onSearch,
}: {
  symbol: string;
  retry: number;
  committed: boolean;
  onSearch: () => void;
}): JSX.Element {
  const pair = (
    <Heading level="1" size="sm" numberOfLines={1} testID="symbol-pair" style={styles.pair}>
      {symbol}
    </Heading>
  );
  return (
    <View style={styles.topBar}>
      <Pressable
        testID="back"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={goBack}
        style={styles.hit}
      >
        <Text role="heading">←</Text>
      </Pressable>
      <Pressable
        testID="symbol-search-open"
        accessibilityRole="button"
        accessibilityHint="Find another symbol"
        onPress={onSearch}
        style={styles.title}
      >
        {committed ?
          <AsyncBoundary
            key={retry}
            fallback={pair}
            errorComponent={() => pair}
          >
            <PairTitle symbol={symbol} />
          </AsyncBoundary>
        : pair}
      </Pressable>
      <WatchControl symbol={symbol} />
    </View>
  );
}

function PriceStripFallback({ streams }: { streams: readonly string[] }): JSX.Element {
  return (
    <View style={styles.strip}>
      <View style={styles.stripLine}>
        <Skeleton style={styles.priceSkeleton} />
        <Reconnecting urls={streams} testID="symbol-reconnecting" style={styles.reconnect} />
      </View>
      <Skeleton style={styles.statSkeleton} />
    </View>
  );
}

function Stat({
  label,
  value,
  testID,
  grow,
}: {
  label: string;
  value: string;
  testID: string;
  grow?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.stat, grow ? styles.statGrow : null]}>
      <Text role="caption" tone="secondary" numberOfLines={1} style={styles.statLabel}>
        {label}
      </Text>
      <Text
        role="caption"
        style={[TABULAR, styles.statValue]}
        numberOfLines={1}
        testID={testID}
      >
        {value}
      </Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const { theme } = useTheme();
  const tone = theme.semantic.color.tones.neutral;
  const space = theme.semantic.space;
  return (
    <View
      testID="symbol-status"
      accessibilityLabel={status}
      style={[
        styles.statusBadge,
        {
          borderRadius: theme.semantic.radius.full,
          borderColor: tone.border,
          backgroundColor: tone.subtle,
          minHeight: space[4] + space[1],
          paddingLeft: space[1],
          paddingRight: space[1],
        },
      ]}
    >
      <Text role="caption" numberOfLines={1} style={{ color: tone.text, flexShrink: 1 }}>
        {status}
      </Text>
    </View>
  );
}

function PriceStrip({
  symbol,
  streams,
  scrub,
}: {
  symbol: string;
  streams: readonly string[];
  scrub: ScrubQuote | null;
}): JSX.Element {
  useSuspense(getExchangeInfo);
  const ticker = useQuery(Ticker, { symbol });
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  if (!ticker) return <PriceStripFallback streams={streams} />;

  const places = instrument?.pricePlaces ?? decimalsOf(ticker.last);
  const last = formatPrice(scrub ? scrub.close : ticker.last, places);
  const direction = ticker.percent > 0 ? 1 : ticker.percent < 0 ? -1 : 0;
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;

  return (
    <View style={styles.strip} testID="price-strip">
      <View style={[styles.stripLine, styles.baseline]}>
        <Text
          role="headingLg"
          style={[TABULAR, styles.last]}
          numberOfLines={1}
          testID="symbol-last"
        >
          {last}
        </Text>
        {instrument && instrument.status !== '' && instrument.status !== 'TRADING' ?
          <StatusBadge status={instrument.status} />
        : scrub ?
          <Text role="label" tone="secondary" style={[TABULAR, styles.percent]} testID="symbol-scrub-time">
            {DIRECTION_WORD[scrub.direction]} {formatCandleTime(scrub.openTime, scrub.interval)}
          </Text>
        : <Text
            role="label"
            tone={direction === 0 ? 'secondary' : undefined}
            style={[TABULAR, styles.percent, direction > 0 ? { color: up } : direction < 0 ? { color: down } : null]}
            testID="symbol-percent"
          >
            {formatPercent(ticker.percent)}
          </Text>
        }
        <Reconnecting urls={streams} testID="symbol-reconnecting" style={styles.reconnect} />
      </View>
      <View style={styles.stats}>
        <Stat label="24h high" value={formatPrice(ticker.high, places)} testID="symbol-high" grow />
        <Stat label="24h low" value={formatPrice(ticker.low, places)} testID="symbol-low" grow />
        <Stat
          label="24h vol"
          value={formatQuoteVolume(ticker.quoteVolume)}
          testID="symbol-volume"
        />
      </View>
    </View>
  );
}

function SegmentTab({
  label,
  selected,
  onPress,
  indicator,
}: {
  label: Segment;
  selected: boolean;
  onPress: () => void;
  indicator: string;
}): JSX.Element {
  const [labelWidth, setLabelWidth] = useState(0);
  const mark = INDICATOR_PX / PixelRatio.get();
  return (
    <Pressable
      testID={`segment-${label.toLowerCase()}`}
      accessibilityRole="tab"
      aria-selected={selected}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.segment}
    >
      <Text
        role="label"
        tone={selected ? 'primary' : 'secondary'}
        onLayout={event => {
          const next = event.nativeEvent.layout.width;
          setLabelWidth(current => (current === next ? current : next));
        }}
      >
        {label}
      </Text>
      {selected && labelWidth > 0 ?
        <View pointerEvents="none" style={styles.indicatorSlot}>
          <View
            style={{ width: labelWidth + 16, height: mark, backgroundColor: indicator }}
          />
        </View>
      : null}
    </Pressable>
  );
}

function Segments({
  segment,
  onSelect,
}: {
  segment: Segment;
  onSelect: (segment: Segment) => void;
}): JSX.Element {
  const { theme } = useTheme();
  const color = theme.semantic.color;
  return (
    <View style={[styles.segments, { borderBottomColor: color.borderSubtle }]}>
      {SEGMENTS.map(item => (
        <SegmentTab
          key={item}
          label={item}
          selected={item === segment}
          onPress={() => onSelect(item)}
          indicator={color.textPrimary}
        />
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

function streamUrls(
  symbol: string,
  segment: Segment,
  interval: CandleInterval,
  held: CandleInterval | null,
): string[] {
  const urls = [TICKER_STREAM];
  if (segment === 'Book') urls.push(depthStream(symbol));
  else if (segment === 'Trades') urls.push(tradeStream(symbol));
  else if (segment === 'Chart') {
    urls.push(klineStream(symbol, interval));
    if (held && held !== interval) urls.push(klineStream(symbol, held));
  }
  return urls;
}

export default function SymbolScreen({ symbol }: { symbol: string }): JSX.Element {
  const { theme } = useTheme();
  const [segment, setSegment] = useState<Segment>('Chart');
  const [chartInterval, setChartInterval] = useState<CandleInterval>('15m');
  const [chartHold, setChartHold] = useState<CandleInterval | null>(null);
  const [scrub, setScrub] = useState<ScrubQuote | null>(null);
  const onScrub = useCallback((quote: ScrubQuote | null) => {
    setScrub(current => {
      if (quote == null) return current == null ? current : null;
      if (
        current &&
        current.open === quote.open &&
        current.close === quote.close &&
        current.openTime === quote.openTime &&
        current.interval === quote.interval &&
        current.direction === quote.direction
      ) {
        return current;
      }
      return quote;
    });
  }, []);
  const [retry, setRetry] = useState(0);
  const [committed, setCommitted] = useState(false);
  const [searching, setSearching] = useState(false);
  const streams = useMemo(
    () => streamUrls(symbol, segment, chartInterval, chartHold),
    [symbol, segment, chartInterval, chartHold],
  );
  const retryLoad = useCallback(() => setRetry(count => count + 1), []);
  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  useDismissSearchOnBack(searching, closeSearch);
  // setParams keeps this route. Prevention only blocks removal, so the choice
  // is not swallowed, and prevention does not have to be cleared first.
  const chooseSymbol = useCallback(
    (next: string) => {
      if (next === symbol) setSearching(false);
      else router.setParams({ symbol: next });
    },
    [symbol],
  );
  // The lazy route's first render is still inside the route promise. A fetch that
  // settles there updates the store before DataProvider has committed. React drops
  // that update, retries the read, and the log box turns the warning into an
  // update-depth loop. Wait until this screen has committed before suspending.
  useEffect(() => {
    setCommitted(true);
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.semantic.color.surface }]}>
      <View
        pointerEvents={searching ? 'none' : 'auto'}
        accessibilityElementsHidden={searching}
        importantForAccessibility={searching ? 'no-hide-descendants' : 'auto'}
        style={styles.screen}
      >
        <TopBar symbol={symbol} retry={retry} committed={committed} onSearch={openSearch} />
        {committed ? <TickerFeed /> : null}
        {committed ?
          <AsyncBoundary
            key={retry}
            fallback={<PriceStripFallback streams={streams} />}
            errorComponent={() => <PriceStripFallback streams={streams} />}
          >
            <PriceStrip symbol={symbol} streams={streams} scrub={scrub} />
          </AsyncBoundary>
        : <PriceStripFallback streams={streams} />}
        <Segments segment={segment} onSelect={setSegment} />
        <View style={styles.body} testID="symbol-body">
          {!committed ?
            <Text tone="secondary" testID="chart-loading" style={styles.message}>
              Loading {symbol}
            </Text>
          : segment === 'Book' ?
            <AsyncBoundary
              key={retry}
              fallback={
                <Text tone="secondary" testID="book-loading" style={styles.message}>
                  Loading {symbol}
                </Text>
              }
              errorComponent={() => (
                <LoadError what={`the ${symbol} book`} onRetry={retryLoad} />
              )}
            >
              <LiveBook symbol={symbol} />
            </AsyncBoundary>
          : segment === 'Trades' ?
            <AsyncBoundary
              key={retry}
              fallback={
                <Text tone="secondary" testID="trades-loading" style={styles.message}>
                  Loading {symbol}
                </Text>
              }
              errorComponent={() => <LoadError what={`${symbol} trades`} onRetry={retryLoad} />}
            >
              <TradeTape symbol={symbol} />
            </AsyncBoundary>
          : segment === 'Chart' ?
            <ChartBody
              symbol={symbol}
              interval={chartInterval}
              onInterval={setChartInterval}
              onRetry={retryLoad}
              retry={retry}
              onHold={setChartHold}
              onScrub={onScrub}
            />
          : segment === 'Info' ?
            <AsyncBoundary
              key={retry}
              fallback={
                <Text tone="secondary" testID="info-loading" style={styles.message}>
                  Loading {symbol}
                </Text>
              }
              errorComponent={() => <LoadError what={`${symbol} details`} onRetry={retryLoad} />}
            >
              <InstrumentInfo symbol={symbol} />
            </AsyncBoundary>
          : null}
        </View>
      </View>
      {searching ? <SymbolSearch onChoose={chooseSymbol} onDismiss={closeSearch} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  topBar: {
    height: TOP_BAR,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pair: {
    maxWidth: PAIR_MAX,
  },
  hit: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    height: HIT,
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
  baseline: {
    alignItems: 'baseline',
  },
  last: {
    flexShrink: 0,
  },
  statusBadge: {
    alignSelf: 'center',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: STATUS_MAX,
    borderWidth: 1,
  },
  percent: {
    flexShrink: 0,
  },
  reconnect: {
    marginLeft: 'auto',
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    flexShrink: 0,
  },
  statGrow: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  statLabel: {
    flexShrink: 0,
  },
  statValue: {
    flexShrink: 1,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    flex: 1,
    height: SEGMENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  message: {
    paddingHorizontal: GUTTER,
    paddingTop: GUTTER,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
});
