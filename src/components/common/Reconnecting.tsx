import { Text } from '@reactive/silk-native';
import { useSyncExternalStore, type JSX } from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { streamStatus } from '@/resources/streamStatus';

function readDown(urls: readonly string[]): boolean {
  return urls.some(url => streamStatus.isDown(url));
}

/** True when any listed stream is owned and has had no current frame since it connected. */
export function useStreamsDown(urls: readonly string[]): boolean {
  return useSyncExternalStore(
    streamStatus.subscribe,
    () => readDown(urls),
    () => readDown(urls),
  );
}

export function Reconnecting({
  urls,
  testID,
  style,
}: {
  urls: readonly string[];
  testID: string;
  style?: StyleProp<TextStyle>;
}): JSX.Element | null {
  const down = useStreamsDown(urls);
  if (!down) return null;
  return (
    <Text
      role="caption"
      tone="secondary"
      numberOfLines={1}
      accessibilityLiveRegion="polite"
      aria-live="polite"
      testID={testID}
      style={[styles.caption, style]}
    >
      Reconnecting
    </Text>
  );
}

const styles = StyleSheet.create({
  caption: {
    flexShrink: 0,
  },
});
