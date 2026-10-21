import type { JSX } from 'react';
import { View, type ViewProps } from 'react-native';

/**
 * Web insets come from CSS `env(safe-area-inset-*)` in `src/app/+html.tsx`.
 * Expo Router's web provider is zero and ignores `initialMetrics`; another
 * `SafeAreaProvider` would update that context during hydration.
 *
 * `dataSet` is how react-native-web emits `data-*`. It is not on the native View type.
 */
export function SafeScreen({ style, ...props }: ViewProps): JSX.Element {
  return (
    <View
      {...props}
      style={style}
      {...({ dataSet: { safeScreen: 'true' } } as ViewProps)}
    />
  );
}
