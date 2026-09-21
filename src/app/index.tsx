import { AsyncBoundary, useLive } from '@data-client/react';
import { Box, Stack, Text } from '@reactive/silk-native';
import { useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getOrderBook } from '@/resources/OrderBook';

const SYMBOL = 'BTCUSDT';

function BookSnapshot() {
  const book = useLive(getOrderBook, { symbol: SYMBOL });

  return (
    <Stack gap="2">
      <Text role="headingLg" testID="symbol">
        {book.symbol}
      </Text>
      <Text testID="best-bid">Bid {book.bestBid}</Text>
      <Text testID="best-ask">Ask {book.bestAsk}</Text>
      <Text tone="secondary" testID="book-depth">
        {book.bids.length} bids · {book.asks.length} asks
      </Text>
    </Stack>
  );
}

export default function HomeScreen() {
  const scheme = useColorScheme();

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Box padding="4" style={{ flex: 1 }}>
        <AsyncBoundary
          fallback={
            <Text tone="secondary" testID="book-loading">
              Loading {SYMBOL}
            </Text>
          }
        >
          <BookSnapshot />
        </AsyncBoundary>
        <Text role="caption" tone="secondary">
          {scheme === 'dark' ? 'Dark' : 'Light'} · Silk · Data Client
        </Text>
      </Box>
    </SafeAreaView>
  );
}
