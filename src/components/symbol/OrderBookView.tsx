import { Text, useTheme } from '@reactive/silk-native';
import { memo, useCallback, useMemo, useState, type JSX } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type TextStyle } from 'react-native';

import { formatPrice, formatSize } from '@/components/common/formatMarket';
import { ListSkeleton } from '@/components/common/ListSkeleton';
import { usePlaces, type Places } from '@/components/symbol/places';

export type Level = readonly [price: number, qty: number];

export type OrderBookViewProps = {
  symbol: string;
  /** Price descending; best bid is bids[0]. */
  bids: readonly Level[];
  /** Price ascending; best ask is asks[0]. */
  asks: readonly Level[];
  spread: number;
  /** Instrument tick places. Omitted until Symbol has loaded, so prices only widen. */
  pricePlaces?: number;
  /** Instrument step places. Omitted until Symbol has loaded, so sizes only widen. */
  sizePlaces?: number;
};

/** Fixed row height, so a side's height says how many levels it shows; bodySm (14px) text sits centered. */
const BOOK_ROW_HEIGHT = 32;
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
/** Rows per side before the first layout: a phone-sized side, so the first frame is not empty. */
const INITIAL_ROWS = 12;

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

type Side = 'bid' | 'ask';

type RowPalette = {
  readonly bidPrice: string;
  readonly askPrice: string;
  readonly bidBar: string;
  readonly askBar: string;
};

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
  readonly places: Places;
  readonly palette: RowPalette;
  /** Only the best row of each side carries one (`best-bid` / `best-ask`). */
  readonly testID?: string;
};

const LevelRow = memo(function LevelRow({
  side,
  price,
  qty,
  ratio,
  places,
  palette,
  testID,
}: LevelRowProps): JSX.Element {
  const priceText = formatPrice(price, places.price);
  const qtyText = formatSize(qty, places.size);
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

type SideProps = {
  readonly side: Side;
  /** Best first. */
  readonly levels: readonly Level[];
  readonly rows: number;
  readonly barReference: number;
  readonly places: Places;
  readonly palette: RowPalette;
};

/** The levels nearest the spread that fit; asks stack upward from the axis, bids downward. */
function BookSide({ side, levels, rows, barReference, places, palette }: SideProps): JSX.Element {
  const count = Math.min(rows, levels.length);
  const children: JSX.Element[] = [];
  for (let i = 0; i < count; i++) {
    const [price, qty] = levels[i];
    children.push(
      <LevelRow
        key={price}
        side={side}
        price={price}
        qty={qty}
        ratio={Math.min(1, qty / barReference)}
        places={places}
        palette={palette}
        testID={i === 0 ? `best-${side}` : undefined}
      />,
    );
  }
  const isAsk = side === 'ask';
  return (
    <View testID={isAsk ? 'asks' : 'bids'} style={[styles.list, isAsk ? styles.asks : null]}>
      {children}
    </View>
  );
}

export function OrderBookView({
  symbol,
  bids,
  asks,
  spread,
  pricePlaces,
  sizePlaces,
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

  const priceSample: number[] = [];
  const sizeSample: number[] = [];
  const askCount = Math.min(asks.length, BAR_REFERENCE_LEVELS);
  const bidCount = Math.min(bids.length, BAR_REFERENCE_LEVELS);
  for (let i = 0; i < askCount; i++) {
    priceSample.push(asks[i][0]);
    sizeSample.push(asks[i][1]);
  }
  for (let i = 0; i < bidCount; i++) {
    priceSample.push(bids[i][0]);
    sizeSample.push(bids[i][1]);
  }
  const places = usePlaces({ price: pricePlaces, size: sizePlaces }, priceSample, sizeSample);

  const barReference = useMemo(() => {
    const mean =
      (meanQty(asks, BAR_REFERENCE_LEVELS) + meanQty(bids, BAR_REFERENCE_LEVELS)) / 2;
    return mean > 0 ? mean * BAR_REFERENCE_MULTIPLIER : 1;
  }, [asks, bids]);

  // Both sides share the height left by the axis. A partial row still shows, clipped at the edge.
  const [rows, setRows] = useState(INITIAL_ROWS);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const side = (event.nativeEvent.layout.height - AXIS_HEIGHT) / 2;
    setRows(Math.max(0, Math.ceil(side / BOOK_ROW_HEIGHT)));
  }, []);

  const hasAsks = asks.length > 0;
  const hasBids = bids.length > 0;
  const spreadText =
    hasAsks && hasBids
      ? `Spread ${formatPrice(spread, places.price)}`
      : !hasAsks && !hasBids
        ? 'Waiting for the book'
        : '';

  // The only chrome is the axis between the two sides: symbol left, spread right.
  const axis = (
    <View
      testID="spread"
      style={[styles.axis, { backgroundColor: color.tones.neutral.subtle }]}
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

  const sideProps = { rows, barReference, places, palette };
  return (
    <View
      style={[styles.root, { backgroundColor: color.surface }]}
      testID="book-depth"
      onLayout={onLayout}
    >
      <BookSide side="ask" levels={asks} {...sideProps} />
      {axis}
      <BookSide side="bid" levels={bids} {...sideProps} />
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
    minHeight: 0,
    overflow: 'hidden',
  },
  asks: {
    flexDirection: 'column-reverse',
  },
  row: {
    height: BOOK_ROW_HEIGHT,
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
});

export function BookLoading(): JSX.Element {
  return <ListSkeleton rowHeight={BOOK_ROW_HEIGHT} testID="book-loading" />;
}

export default OrderBookView;
