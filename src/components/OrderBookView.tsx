import { Text, useTheme } from '@reactive/silk-native';
import { memo, useCallback, useMemo, useRef, type JSX } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type ListRenderItem,
  type TextStyle,
} from 'react-native';

export type Level = readonly [price: number, qty: number];

export type OrderBookViewProps = {
  symbol: string;
  /** Price descending; best bid is bids[0]. */
  bids: readonly Level[];
  /** Price ascending; best ask is asks[0]. */
  asks: readonly Level[];
  spread: number;
};

/** Fixed row height so FlatList can use getItemLayout; bodySm (14px) text sits centered. */
const ROW_HEIGHT = 32;
const ROW_GUTTER = 12; // theme.semantic.space[3]
const BAR_INSET = 3;
/**
 * Depth bars grow from the right edge and stop at 55% of the row, so they stay
 * under the Size column and never sit behind the colored Price text.
 */
const BAR_MAX_FRACTION = 0.55;
/** Bars are scaled to the sizes nearest the spread: full bar = 2x the mean size of these levels per side. */
const BAR_REFERENCE_LEVELS = 20;
const BAR_REFERENCE_MULTIPLIER = 2;
/** The spread axis between the sides: symbol left, spread right. */
const AXIS_HEIGHT = 28;

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

type Side = 'bid' | 'ask';

type RowPalette = {
  readonly bidPrice: string;
  readonly askPrice: string;
  readonly bidBar: string;
  readonly askBar: string;
};

type Formats = {
  readonly priceDecimals: number;
  readonly qtyDecimals: number;
};

function countDecimals(value: number): number {
  // 12 significant digits drops binary float noise (86412.38999999 -> 86412.39).
  const text = String(Number(value.toPrecision(12)));
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  const exp = text.indexOf('e-');
  if (exp !== -1) return Math.min(8, Number(text.slice(exp + 2)) + (exp - dot - 1));
  return text.length - dot - 1;
}

function maxDecimals(levels: readonly Level[], index: 0 | 1, sample: number): number {
  let max = 0;
  const end = Math.min(levels.length, sample);
  for (let i = 0; i < end; i++) {
    const d = countDecimals(levels[i][index]);
    if (d > max) max = d;
  }
  return max;
}

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPrice(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const dot = fixed.indexOf('.');
  if (dot === -1) return groupThousands(fixed);
  return groupThousands(fixed.slice(0, dot)) + fixed.slice(dot);
}

export function formatQty(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function meanQty(levels: readonly Level[], sample: number): number {
  const end = Math.min(levels.length, sample);
  if (end === 0) return 0;
  let sum = 0;
  for (let i = 0; i < end; i++) sum += levels[i][1];
  return sum / end;
}

type LevelRowProps = {
  readonly side: Side;
  readonly price: number;
  readonly qty: number;
  /** 0..1 share of the bar track. */
  readonly ratio: number;
  readonly formats: Formats;
  readonly palette: RowPalette;
  /** Only the best row of each side carries one (`best-bid` / `best-ask`). */
  readonly testID?: string;
};

const LevelRow = memo(function LevelRow({
  side,
  price,
  qty,
  ratio,
  formats,
  palette,
  testID,
}: LevelRowProps): JSX.Element {
  const priceText = formatPrice(price, formats.priceDecimals);
  const qtyText = formatQty(qty, formats.qtyDecimals);
  const isBid = side === 'bid';
  return (
    <View
      style={styles.row}
      testID={testID}
      accessible
      accessibilityLabel={`${isBid ? 'Bid' : 'Ask'} ${priceText}, size ${qtyText}`}
    >
      <View
        pointerEvents="none"
        style={[
          styles.bar,
          {
            width: `${ratio * BAR_MAX_FRACTION * 100}%`,
            backgroundColor: isBid ? palette.bidBar : palette.askBar,
          },
        ]}
      />
      <Text
        role="label"
        style={[styles.priceText, TABULAR, { color: isBid ? palette.bidPrice : palette.askPrice }]}
      >
        {priceText}
      </Text>
      <Text role="bodySm" style={[styles.qtyText, TABULAR]}>
        {qtyText}
      </Text>
    </View>
  );
});

function getItemLayout(_: ArrayLike<Level> | null | undefined, index: number) {
  return { length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index };
}

function keyExtractor(level: Level): string {
  return String(level[0]);
}

export function OrderBookView({
  symbol,
  bids,
  asks,
  spread,
}: OrderBookViewProps): JSX.Element {
  const { theme } = useTheme();
  const color = theme.semantic.color;

  // tones.*.solid is the one green/red per scheme that is both vivid and >= 4.5:1 on
  // `surface` (step 11 light, step 9 dark). tones.*.text is AA too but step 12 in
  // light reads near-black, which loses the bid/ask read of a book.
  const palette = useMemo<RowPalette>(
    () => ({
      bidPrice: color.tones.success.solid,
      askPrice: color.tones.danger.solid,
      bidBar: color.tones.success.subtleActive,
      askBar: color.tones.danger.subtleActive,
    }),
    [color],
  );

  // Decimal places only ever widen, so columns never jitter as levels come and go.
  const decimalsRef = useRef<Formats>({ priceDecimals: 2, qtyDecimals: 2 });
  const formats = useMemo<Formats>(() => {
    const prev = decimalsRef.current;
    const next: Formats = {
      priceDecimals: Math.min(
        8,
        Math.max(
          prev.priceDecimals,
          maxDecimals(asks, 0, BAR_REFERENCE_LEVELS),
          maxDecimals(bids, 0, BAR_REFERENCE_LEVELS),
        ),
      ),
      qtyDecimals: Math.min(
        8,
        Math.max(
          prev.qtyDecimals,
          maxDecimals(asks, 1, BAR_REFERENCE_LEVELS),
          maxDecimals(bids, 1, BAR_REFERENCE_LEVELS),
        ),
      ),
    };
    if (next.priceDecimals === prev.priceDecimals && next.qtyDecimals === prev.qtyDecimals) {
      return prev;
    }
    decimalsRef.current = next;
    return next;
  }, [asks, bids]);

  const barReference = useMemo(() => {
    const mean =
      (meanQty(asks, BAR_REFERENCE_LEVELS) + meanQty(bids, BAR_REFERENCE_LEVELS)) / 2;
    return mean > 0 ? mean * BAR_REFERENCE_MULTIPLIER : 1;
  }, [asks, bids]);

  const renderAsk = useCallback<ListRenderItem<Level>>(
    ({ item, index }) => (
      <LevelRow
        side="ask"
        price={item[0]}
        qty={item[1]}
        ratio={Math.min(1, item[1] / barReference)}
        formats={formats}
        palette={palette}
        testID={index === 0 ? 'best-ask' : undefined}
      />
    ),
    [barReference, formats, palette],
  );

  const renderBid = useCallback<ListRenderItem<Level>>(
    ({ item, index }) => (
      <LevelRow
        side="bid"
        price={item[0]}
        qty={item[1]}
        ratio={Math.min(1, item[1] / barReference)}
        formats={formats}
        palette={palette}
        testID={index === 0 ? 'best-bid' : undefined}
      />
    ),
    [barReference, formats, palette],
  );

  const hairline = { borderColor: color.borderSubtle };
  const hasAsks = asks.length > 0;
  const hasBids = bids.length > 0;
  const spreadText =
    hasAsks && hasBids
      ? `Spread ${formatPrice(spread, formats.priceDecimals)}`
      : !hasAsks && !hasBids
        ? 'Waiting for the book'
        : '';

  // The only chrome is the axis between the two sides: symbol left, spread right.
  const axis = (
    <View
      testID="spread"
      style={[styles.axis, styles.hairlineTop, styles.hairlineBottom, hairline]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${symbol}, ${spreadText}`}
    >
      <Text role="label" testID="symbol">
        {symbol}
      </Text>
      <Text role="caption" tone="secondary" style={TABULAR} testID="spread-value">
        {spreadText}
      </Text>
    </View>
  );

  if (!hasAsks && !hasBids) {
    return (
      <View style={[styles.root, { backgroundColor: color.surface }]} testID="book-depth">
        <View style={styles.list} />
        {axis}
        <View style={styles.list} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: color.surface }]} testID="book-depth">
      <FlatList
        testID="asks"
        style={styles.list}
        data={asks}
        inverted
        renderItem={renderAsk}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />

      {axis}

      <FlatList
        testID="bids"
        style={styles.list}
        data={bids}
        renderItem={renderBid}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        initialNumToRender={16}
        maxToRenderPerBatch={16}
        windowSize={7}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: ROW_GUTTER,
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    top: BAR_INSET,
    bottom: BAR_INSET,
    right: 0,
    borderTopLeftRadius: 4, // radius.sm
    borderBottomLeftRadius: 4,
  },
  priceText: {
    flex: 1,
    textAlign: 'left',
  },
  qtyText: {
    flex: 1,
    textAlign: 'right',
  },
  axis: {
    height: AXIS_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ROW_GUTTER,
  },
  hairlineTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hairlineBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export default OrderBookView;
