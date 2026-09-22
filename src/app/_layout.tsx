import { DataProvider, getDefaultManagers } from '@data-client/react';
import { SilkProvider } from '@reactive/silk-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import OrderBookStream from '@/resources/OrderBookStream';
import TickerStream from '@/resources/TickerStream';
import TradeStream from '@/resources/TradeStream';

const managers = [
  new OrderBookStream(),
  new TickerStream(),
  new TradeStream(),
  ...getDefaultManagers(),
];

export default function RootLayout() {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <DataProvider managers={managers}>
      <SilkProvider colorScheme={colorScheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </SilkProvider>
    </DataProvider>
  );
}
