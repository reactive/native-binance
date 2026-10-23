import type { JSX } from 'react';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';

export function SafeScreen(props: SafeAreaViewProps): JSX.Element {
  return <SafeAreaView {...props} />;
}
