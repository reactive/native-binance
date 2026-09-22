import { AsyncBoundary, useLive } from '@data-client/react';
import { Text } from '@reactive/silk-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import OrderBookView from '@/components/OrderBookView';
import { getOrderBook } from '@/resources/OrderBook';

function LiveBook({ symbol }: { symbol: string }) {
  const book = useLive(getOrderBook, { symbol });

  return (
    <OrderBookView
      symbol={book.symbol}
      bids={book.bids}
      asks={book.asks}
      spread={book.spread}
    />
  );
}

export default function BookScreen() {
  const params = useLocalSearchParams<{ symbol: string }>();
  const symbol = (Array.isArray(params.symbol) ? params.symbol[0] : params.symbol ?? '')
    .toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AsyncBoundary
        fallback={
          <Text tone="secondary" testID="book-loading">
            Loading {symbol}
          </Text>
        }
      >
        {symbol ? <LiveBook symbol={symbol} /> : null}
      </AsyncBoundary>
    </SafeAreaView>
  );
}
