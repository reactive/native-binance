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
  bestBid: number;
  bestAsk: number;
  spread: number;
  midPrice: number;
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
const STRIP_HEIGHT = 60;
const COLUMN_HEADER_HEIGHT = 24;

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
};

const LevelRow = memo(function LevelRow({
  side,
  price,
  qty,
  ratio,
  formats,
  palette,
}: LevelRowProps): JSX.Element {
  const priceText = formatPrice(price, formats.priceDecimals);
  const qtyText = formatQty(qty, formats.qtyDecimals);
  const isBid = side === 'bid';
  return (
    <View
      style={styles.row}
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
  bestBid,
  bestAsk,
  spread,
  midPrice,
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
    ({ item }) => (
      <LevelRow
        side="ask"
        price={item[0]}
        qty={item[1]}
        ratio={Math.min(1, item[1] / barReference)}
        formats={formats}
        palette={palette}
      />
    ),
    [barReference, formats, palette],
  );

  const renderBid = useCallback<ListRenderItem<Level>>(
    ({ item }) => (
      <LevelRow
        side="bid"
        price={item[0]}
        qty={item[1]}
        ratio={Math.min(1, item[1] / barReference)}
        formats={formats}
        palette={palette}
      />
    ),
    [barReference, formats, palette],
  );

  const hairline = { borderColor: color.borderSubtle };

  if (asks.length === 0 && bids.length === 0) {
    return (
      <View style={[styles.root, { backgroundColor: color.surface }]}>
        <View style={styles.header}>
          <Text role="heading" testID="symbol">
            {symbol}
          </Text>
        </View>
        <View style={styles.empty}>
          <Text role="bodySm" tone="secondary" testID="book-depth">
            Waiting for the book
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: color.surface }]}>
      <View style={styles.header}>
        <Text role="heading" testID="symbol">
          {symbol}
        </Text>
      </View>

      <View style={[styles.columnHeader, styles.hairlineBottom, hairline]}>
        <Text role="caption" tone="secondary" style={styles.priceText}>
          Price
        </Text>
        <Text role="caption" tone="secondary" style={styles.qtyText}>
          Size
        </Text>
      </View>

      <View style={styles.book} testID="book-depth">
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

        <View
          testID="spread"
          style={[
            styles.strip,
            styles.hairlineTop,
            styles.hairlineBottom,
            hairline,
            // `surface`, not `surfaceRaised`: the 16px bid/ask values fall to 4.48:1 on raised.
            { backgroundColor: color.surface },
          ]}
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`Best bid ${formatPrice(bestBid, formats.priceDecimals)}, best ask ${formatPrice(bestAsk, formats.priceDecimals)}, mid ${formatPrice(midPrice, formats.priceDecimals)}, spread ${formatPrice(spread, formats.priceDecimals)}`}
        >
          <View style={styles.stripSide}>
            <Text role="caption" tone="secondary">
              Bid
            </Text>
            <Text
              role="headingSm"
              testID="best-bid"
              style={[TABULAR, { color: palette.bidPrice }]}
            >
              {formatPrice(bestBid, formats.priceDecimals)}
            </Text>
          </View>

          <View style={styles.stripCenter}>
            <Text role="heading" style={TABULAR} testID="mid-price">
              {formatPrice(midPrice, formats.priceDecimals)}
            </Text>
            <Text role="caption" tone="secondary" style={TABULAR} testID="spread-value">
              Spread {formatPrice(spread, formats.priceDecimals)}
            </Text>
          </View>

          <View style={[styles.stripSide, styles.stripSideEnd]}>
            <Text role="caption" tone="secondary">
              Ask
            </Text>
            <Text
              role="headingSm"
              testID="best-ask"
              style={[TABULAR, { color: palette.askPrice }]}
            >
              {formatPrice(bestAsk, formats.priceDecimals)}
            </Text>
          </View>
        </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: ROW_GUTTER,
    paddingTop: 8, // space[2]
    paddingBottom: 4, // space[1]
  },
  columnHeader: {
    height: COLUMN_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: ROW_GUTTER,
  },
  book: {
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
  strip: {
    height: STRIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: ROW_GUTTER,
  },
  stripSide: {
    flex: 1,
    alignItems: 'flex-start',
  },
  stripSideEnd: {
    alignItems: 'flex-end',
  },
  stripCenter: {
    flex: 1.4,
    alignItems: 'center',
  },
  hairlineTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hairlineBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default OrderBookView;
