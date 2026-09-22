import { useQuery, useSuspense } from '@data-client/react';
import { Badge, Text, useTheme } from '@reactive/silk-native';
import type { JSX, ReactNode } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';

import { trimDecimal } from '@/components/formatMarket';
import { getExchangeInfo, MarketSymbol } from '@/resources/Symbol';

const ROW_HEIGHT = 48;
const GUTTER = 12;
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

function shown(value: string): string {
  return value === '' ? '—' : value;
}

function InfoRow({
  testID,
  valueTestID,
  label,
  value,
  unit,
  lined,
  line,
  valueNode,
}: {
  testID: string;
  valueTestID: string;
  label: string;
  value: string;
  unit?: string;
  lined: boolean;
  line: string;
  valueNode?: ReactNode;
}): JSX.Element {
  const text = shown(value);
  const withUnit = unit != null && value !== '';
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={withUnit ? `${label}, ${text} ${unit}` : `${label}, ${text}`}
      style={[styles.row, lined ? styles.lined : null, lined ? { borderBottomColor: line } : null]}
    >
      <Text role="label" tone="secondary">
        {label}
      </Text>
      <View style={styles.value}>
        {valueNode ?? (
          <Text role="label" style={TABULAR} numberOfLines={1} testID={valueTestID}>
            {text}
          </Text>
        )}
        {withUnit ?
          <Text role="caption" tone="secondary">
            {unit}
          </Text>
        : null}
      </View>
    </View>
  );
}

export function InstrumentInfo({ symbol }: { symbol: string }): JSX.Element {
  useSuspense(getExchangeInfo);
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const line = theme.semantic.color.borderSubtle;

  if (!instrument) {
    return (
      <Text tone="secondary" testID="info-missing">
        No instrument details for {symbol}
      </Text>
    );
  }

  const status = instrument.status;
  const tick = trimDecimal(instrument.tickSize);
  const step = trimDecimal(instrument.stepSize);
  const minNotional = trimDecimal(instrument.minNotional);
  const statusNode =
    status === 'TRADING' || status === '' ? undefined : (
      <Badge size="sm" testID="info-status-value">
        {status}
      </Badge>
    );

  return (
    <View testID="instrument-info">
      <InfoRow
        testID="info-status"
        valueTestID="info-status-value"
        label="Status"
        value={status}
        lined
        line={line}
        valueNode={statusNode}
      />
      <InfoRow
        testID="info-base"
        valueTestID="info-base-value"
        label="Base"
        value={instrument.baseAsset}
        lined
        line={line}
      />
      <InfoRow
        testID="info-quote"
        valueTestID="info-quote-value"
        label="Quote"
        value={instrument.quoteAsset}
        lined
        line={line}
      />
      <InfoRow
        testID="info-tick"
        valueTestID="info-tick-value"
        label="Tick"
        value={tick}
        unit={instrument.quoteAsset}
        lined
        line={line}
      />
      <InfoRow
        testID="info-step"
        valueTestID="info-step-value"
        label="Step"
        value={step}
        unit={instrument.baseAsset}
        lined
        line={line}
      />
      <InfoRow
        testID="info-min-notional"
        valueTestID="info-min-notional-value"
        label="Minimum notional"
        value={minNotional}
        unit={instrument.quoteAsset}
        lined={false}
        line={line}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
  },
  lined: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  value: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 1,
    marginLeft: GUTTER,
  },
});
