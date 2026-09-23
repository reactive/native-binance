import 'expo-sqlite/localStorage/install';

import { DataProvider, getDefaultManagers } from '@data-client/react';
import { SilkProvider } from '@reactive/silk-native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import { interFonts } from '@/fonts';

import CandleStream from '@/resources/CandleStream';
import OrderBookStream from '@/resources/OrderBookStream';
import TickerStream from '@/resources/TickerStream';
import TradeStream from '@/resources/TradeStream';

const managers = [
  new OrderBookStream(),
  new TickerStream(),
  new CandleStream(),
  new TradeStream(),
  ...getDefaultManagers(),
];

export default function RootLayout() {
  useFonts(interFonts);
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <DataProvider managers={managers}>
      <SilkProvider colorScheme={colorScheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </SilkProvider>
    </DataProvider>
  );
}
