import 'expo-sqlite/localStorage/install';

import { DataProvider, getDefaultManagers } from '@data-client/react';
import { SilkProvider, useTheme } from '@reactive/silk-native';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { useEffect, type JSX } from 'react';
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
        <ThemedStack />
      </SilkProvider>
    </DataProvider>
  );
}

/** Paints the navigator and native root with Silk's surface, so nothing white shows between screens during transitions. */
function ThemedStack(): JSX.Element {
  const { theme } = useTheme();
  const { color } = theme.semantic;
  const base = theme.colorScheme === 'dark' ? DarkTheme : DefaultTheme;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(color.surface);
  }, [color.surface]);

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          background: color.surface,
          card: color.surfaceRaised,
          text: color.textPrimary,
          border: color.borderSubtle,
        },
      }}
    >
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.surface } }}>
        <Stack.Screen name="index" activityEnabled={1} />
      </Stack>
    </ThemeProvider>
  );
}
