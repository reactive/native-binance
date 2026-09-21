import { DataProvider } from '@data-client/react';
import { SilkProvider } from '@reactive/silk-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function RootLayout() {
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <DataProvider>
      <SilkProvider colorScheme={colorScheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </SilkProvider>
    </DataProvider>
  );
}
