import { AsyncBoundary, useLive } from '@data-client/react';
import { Text } from '@reactive/silk-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import OrderBookView from '@/components/OrderBookView';
import { getOrderBook } from '@/resources/OrderBook';

const SYMBOL = 'BTCUSDT';

function LiveBook() {
  const book = useLive(getOrderBook, { symbol: SYMBOL });

  return (
    <OrderBookView
      symbol={book.symbol}
      bids={book.bids}
      asks={book.asks}
      bestBid={book.bestBid}
      bestAsk={book.bestAsk}
      spread={book.spread}
      midPrice={book.midPrice}
    />
  );
}

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <AsyncBoundary
        fallback={
          <Text tone="secondary" testID="book-loading">
            Loading {SYMBOL}
          </Text>
        }
      >
        <LiveBook />
      </AsyncBoundary>
    </SafeAreaView>
  );
}
